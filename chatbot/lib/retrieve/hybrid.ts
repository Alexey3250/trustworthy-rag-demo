/**
 * Hybrid retrieval: BM25 + dense embeddings, fused with Reciprocal Rank
 * Fusion (RRF). RRF is robust to the two scoring scales being totally
 * different, which is why it's the de-facto default for hybrid search.
 *
 *   rrf(d) = sum_over_methods( 1 / (k + rank_in_method(d)) )
 *
 * We then run a confidence gate: if the *raw* top BM25 score is tiny AND
 * the *raw* top cosine is below a threshold, the chatbot will refuse.
 * That's the "I don't know" path.
 */
import type {
  CorpusDoc,
  EmbeddingsFile,
  IndexEntry,
  Mode,
  RetrievalHit,
} from "../types";
import { embedQuery } from "../llm";
import { pickMode } from "../prompts";
import { buildBm25, searchBm25, type BM25Index } from "./bm25";

let bm25Cache: BM25Index | null = null;

function ensureBm25(entries: IndexEntry[], docs: Map<string, CorpusDoc>): BM25Index {
  if (!bm25Cache || bm25Cache.entries !== entries) {
    bm25Cache = buildBm25(entries, docs);
  }
  return bm25Cache;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

const RRF_K = 60;

export type HybridResult = {
  hits: RetrievalHit[];
  mode: Mode;
  topBm25: number;
  topDense: number;
  denseMargin: number;
  fusedTop: number;
  bm25Ms: number;
  denseMs: number;
  embedTokens: number;
  embedSource: "cache" | "live" | "none";
};

export async function hybridRetrieve(opts: {
  query: string;
  index: { docs: IndexEntry[] };
  docs: Map<string, CorpusDoc>;
  embeddings?: EmbeddingsFile;
  topK: number;
  answerAt: number;
  clarifyAt: number;
  minMargin?: number;
  shortQueryWords?: number;
}): Promise<HybridResult> {
  const {
    query,
    index,
    docs,
    embeddings,
    topK,
    answerAt,
    clarifyAt,
    minMargin,
    shortQueryWords,
  } = opts;
  const entries = index.docs;

  // BM25
  const t0 = performance.now();
  const bm25 = ensureBm25(entries, docs);
  const bmList = searchBm25(bm25, query);
  const bmRanks = new Map<number, number>();
  bmList.forEach((x, r) => bmRanks.set(x.idx, r + 1));
  const bmScoreByIdx = new Map<number, number>();
  bmList.forEach((x) => bmScoreByIdx.set(x.idx, x.score));
  const bm25Ms = performance.now() - t0;

  // Dense — optional. Skipped when no embed endpoint is configured
  // (e.g. Vercel + Cerebras-only) or no embeddings file exists. We log
  // and continue with BM25 only.
  const t1 = performance.now();
  const denseList: { idx: number; score: number }[] = [];
  let embedTokens = 0;
  let denseUsed = false;
  let embedSource: "cache" | "live" | "none" = "none";
  if (embeddings && embeddings.vectors.length === entries.length) {
    try {
      const er = await embedQuery(query);
      if (er) {
        denseUsed = true;
        embedTokens = er.totalTokens || er.promptTokens;
        embedSource = er.source;
        for (let i = 0; i < entries.length; i++) {
          denseList.push({
            idx: i,
            score: cosine(er.vector, embeddings.vectors[i].vec),
          });
        }
        denseList.sort((a, b) => b.score - a.score);
      }
    } catch (err) {
      console.warn(
        `[retrieve] dense skipped: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  const denseRanks = new Map<number, number>();
  denseList.forEach((x, r) => denseRanks.set(x.idx, r + 1));
  const denseScoreByIdx = new Map<number, number>();
  denseList.forEach((x) => denseScoreByIdx.set(x.idx, x.score));
  const denseMs = performance.now() - t1;

  // RRF fusion
  const fused = new Map<number, number>();
  for (let i = 0; i < entries.length; i++) {
    const r1 = bmRanks.get(i);
    const r2 = denseRanks.get(i);
    let score = 0;
    if (r1 !== undefined) score += 1 / (RRF_K + r1);
    if (r2 !== undefined) score += 1 / (RRF_K + r2);
    if (score > 0) fused.set(i, score);
  }
  const ranked = Array.from(fused.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK);

  const hits: RetrievalHit[] = ranked.map(([idx, fusedScore]) => {
    const entry = entries[idx];
    return {
      entry,
      doc: docs.get(entry.path)!,
      bm25Score: bmScoreByIdx.get(idx) ?? 0,
      denseScore: denseScoreByIdx.get(idx) ?? 0,
      fusedScore,
      bm25Rank: bmRanks.get(idx) ?? -1,
      denseRank: denseRanks.get(idx) ?? -1,
    };
  });

  const topBm25 = bmList[0]?.score ?? 0;
  const topDense = denseList[0]?.score ?? 0;
  const top2Dense = denseList[1]?.score ?? 0;
  const denseMargin = topDense - top2Dense;
  const fusedTop = ranked[0]?.[1] ?? 0;

  // Mode picking. When dense is available we use the top cosine + margin
  // (high signal). When BM25-only, we use the top BM25 score (which is
  // normalised to [0,1] in our impl) and the BM25 top1-top2 margin.
  // BM25 thresholds are slightly lower because it tops out near 1.0
  // for any reasonable lexical hit.
  const top2Bm25 = bmList[1]?.score ?? 0;
  const mode = pickMode(denseUsed ? topDense : topBm25, {
    answerAt,
    clarifyAt,
    margin: denseUsed ? denseMargin : topBm25 - top2Bm25,
    minMargin,
    query,
    shortQueryWords,
  });

  return {
    hits,
    mode,
    topBm25,
    topDense,
    denseMargin,
    fusedTop,
    bm25Ms,
    denseMs,
    embedTokens,
    embedSource,
  };
}
