/**
 * Pre-computed query embeddings for the showcase suggestions.
 *
 * On Vercel + Cerebras (no embeddings endpoint), live `embedOne()` returns
 * null and dense retrieval is skipped. By caching the embeddings for the
 * preset suggestion texts at build time (with the same model used for the
 * corpus), we keep hybrid retrieval alive for those exact queries without
 * needing an OpenAI key in production.
 *
 * Cache file: `chatbot/corpus/.query-cache.json`
 *   {
 *     "model": "nomic-embed-text",
 *     "dim": 768,
 *     "generated_at": "2026-05-11T...",
 *     "queries": { "<exact query>": [<vector>], ... }
 *   }
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type QueryCacheFile = {
  model: string;
  dim: number;
  generated_at: string;
  queries: Record<string, number[]>;
};

let cached: { map: Map<string, number[]>; model: string | null } | null = null;

function resolveCachePath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "corpus", ".query-cache.json"),
    path.resolve(process.cwd(), "..", "corpus", ".query-cache.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function loadCache(): { map: Map<string, number[]>; model: string | null } {
  if (cached) return cached;
  const p = resolveCachePath();
  if (!p) {
    cached = { map: new Map(), model: null };
    return cached;
  }
  try {
    const parsed = JSON.parse(readFileSync(p, "utf-8")) as QueryCacheFile;
    const map = new Map<string, number[]>();
    for (const [k, v] of Object.entries(parsed.queries)) {
      map.set(k.trim().toLowerCase(), v);
    }
    cached = { map, model: parsed.model };
  } catch (err) {
    console.warn(
      `[queryCache] failed to read ${p}: ${err instanceof Error ? err.message : err}`,
    );
    cached = { map: new Map(), model: null };
  }
  return cached;
}

/**
 * Look up a cached query embedding by exact (case-insensitive, trimmed)
 * match. Returns null if no cache exists, the query isn't cached, or the
 * cache model doesn't match the expected runtime EMBED_MODEL (when set).
 */
export function lookupQueryEmbedding(text: string): number[] | null {
  const { map, model } = loadCache();
  if (map.size === 0) return null;
  const expected = process.env.EMBED_MODEL?.trim();
  if (expected && model && expected !== model) {
    return null;
  }
  return map.get(text.trim().toLowerCase()) ?? null;
}

export function cacheStats(): { size: number; model: string | null } {
  const { map, model } = loadCache();
  return { size: map.size, model };
}
