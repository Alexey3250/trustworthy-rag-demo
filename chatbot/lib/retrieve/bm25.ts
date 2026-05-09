/**
 * Tiny in-memory BM25 over corpus docs. Built once on cold start.
 *
 * Documents are represented as the catenation of their highest-signal
 * fields: title, summary, topics, intro, FAQ questions and answers.
 * That gives sparse retrieval the best chance of catching exact-match
 * tokens like "WWCC", "P1 licence", or scheme names.
 */
import type { CorpusDoc, IndexEntry } from "../types";

const STOPWORDS = new Set([
  "a","an","and","are","as","at","be","by","for","from","has","have","i","in","is","it","of","on","or","that","the","to","was","were","will","with","you","your","my","this","these","those","do","does","did","how","what","when","where","who","why","can","could","should","would",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function docText(entry: IndexEntry, doc?: CorpusDoc): string {
  const parts: string[] = [
    entry.title,
    entry.summary ?? "",
    (entry.topics ?? []).join(" "),
  ];
  if (doc) {
    parts.push(doc.intro ?? "");
    parts.push((doc.faqs ?? []).map((f) => `${f.q} ${f.a}`).join(" "));
    parts.push((doc.who_can_apply ?? []).join(" "));
    parts.push((doc.what_you_need ?? []).join(" "));
  }
  return parts.join(" ");
}

export type BM25Index = {
  entries: IndexEntry[];
  docFreq: Map<string, number>;
  docLengths: number[];
  termFreqs: Map<string, number>[];
  avgLen: number;
  N: number;
};

export function buildBm25(
  entries: IndexEntry[],
  docs: Map<string, CorpusDoc>,
): BM25Index {
  const termFreqs: Map<string, number>[] = [];
  const docLengths: number[] = [];
  const docFreq = new Map<string, number>();

  for (const e of entries) {
    const tokens = tokenize(docText(e, docs.get(e.path)));
    docLengths.push(tokens.length);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    termFreqs.push(tf);
    for (const t of tf.keys()) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  }

  const N = entries.length;
  const avgLen = docLengths.reduce((a, b) => a + b, 0) / Math.max(1, N);
  return { entries, docFreq, docLengths, termFreqs, avgLen, N };
}

const k1 = 1.5;
const b = 0.75;

export function searchBm25(
  index: BM25Index,
  query: string,
): { idx: number; score: number }[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  const scores = new Array(index.N).fill(0);
  for (const t of qTokens) {
    const df = index.docFreq.get(t);
    if (!df) continue;
    const idf = Math.log(1 + (index.N - df + 0.5) / (df + 0.5));
    for (let i = 0; i < index.N; i++) {
      const tf = index.termFreqs[i].get(t);
      if (!tf) continue;
      const norm = 1 - b + b * (index.docLengths[i] / index.avgLen);
      scores[i] += idf * ((tf * (k1 + 1)) / (tf + k1 * norm));
    }
  }

  const max = Math.max(...scores, 1e-9);
  return scores
    .map((s, idx) => ({ idx, score: s / max }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}
