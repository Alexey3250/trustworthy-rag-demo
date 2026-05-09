import { NextRequest } from "next/server";
import { hybridRetrieve } from "@/lib/retrieve/hybrid";
import { loadCorpus } from "@/lib/retrieve/corpus";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/** Debug retrieval-only endpoint:
 *
 *     curl "http://localhost:3000/api/search?q=renew+drivers+licence"
 *
 * Returns the top-k hits with both raw and fused scores. No LLM call.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q) return new Response(JSON.stringify({ error: "Missing q" }), { status: 400 });

  const { index, docs, embeddings } = await loadCorpus();
  const result = await hybridRetrieve({
    query: q,
    index,
    docs,
    embeddings,
    topK: env.retrieval.topK,
    answerAt: env.retrieval.answerAt,
    clarifyAt: env.retrieval.clarifyAt,
    minMargin: env.retrieval.minMargin,
    shortQueryWords: env.retrieval.shortQueryWords,
  });

  return Response.json({
    query: q,
    mode: result.mode,
    topBm25: result.topBm25,
    topDense: result.topDense,
    denseMargin: result.denseMargin,
    fusedTop: result.fusedTop,
    bm25Ms: result.bm25Ms,
    denseMs: result.denseMs,
    hits: result.hits.map((h) => ({
      title: h.entry.title,
      url: h.entry.url,
      category: h.entry.category,
      summary: h.entry.summary,
      bm25Score: h.bm25Score,
      bm25Rank: h.bm25Rank,
      denseScore: h.denseScore,
      denseRank: h.denseRank,
      fusedScore: h.fusedScore,
    })),
  });
}
