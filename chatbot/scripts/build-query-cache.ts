/**
 * Pre-computes query embeddings for the showcase suggestions so hybrid
 * retrieval works on Vercel + Cerebras-only deployments (no runtime
 * embeddings endpoint configured).
 *
 *     npm run build-query-cache
 *
 * Reads texts from `lib/suggestions.ts`, embeds each with the same model
 * as the corpus (defaults to nomic-embed-text via local Ollama), writes
 * `corpus/.query-cache.json`. Commit that file so Vercel bundles it.
 */
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { SUGGESTIONS } from "../lib/suggestions";

const ROOT = process.cwd();
const CACHE_PATH = path.join(ROOT, "corpus", ".query-cache.json");
const CORPUS_EMB_PATH = path.join(ROOT, "corpus", ".embeddings.json");

function readEnvFromLocal() {
  const candidates = [path.join(ROOT, ".env.local"), path.join(ROOT, "..", ".env.local")];
  for (const c of candidates) {
    try {
      const raw = readFileSync(c, "utf-8");
      raw.split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m) return;
        const [, k, v] = m;
        if (process.env[k]) return;
        process.env[k] = v.replace(/^"|"$/g, "");
      });
    } catch {
      /* ignore */
    }
  }
}
readEnvFromLocal();

const EMBED_BASE = process.env.EMBED_BASE_URL ?? "http://127.0.0.1:11434/v1";
const EMBED_KEY = process.env.EMBED_API_KEY ?? "ollama";
const EMBED_MODEL = process.env.EMBED_MODEL ?? "nomic-embed-text";

const client = new OpenAI({ baseURL: EMBED_BASE, apiKey: EMBED_KEY });

async function detectCorpusModel(): Promise<string | null> {
  try {
    const raw = await fs.readFile(CORPUS_EMB_PATH, "utf-8");
    const head = raw.slice(0, 200);
    const m = head.match(/"model"\s*:\s*"([^"]+)"/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const corpusModel = await detectCorpusModel();
  if (corpusModel && corpusModel !== EMBED_MODEL) {
    console.warn(
      `⚠  EMBED_MODEL (${EMBED_MODEL}) does not match corpus model (${corpusModel}).`,
    );
    console.warn(`   Cached query vectors would be useless. Aborting.`);
    process.exit(1);
  }

  const queries = SUGGESTIONS.map((s) => s.text);
  console.log(`Embedding ${queries.length} showcase queries with "${EMBED_MODEL}" @ ${EMBED_BASE}`);

  const vectors: Record<string, number[]> = {};
  let dim = 0;
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    process.stdout.write(`  [${i + 1}/${queries.length}] ${q.slice(0, 60)}… `);
    const r = await client.embeddings.create({ model: EMBED_MODEL, input: q });
    const vec = r.data[0].embedding;
    dim = vec.length;
    vectors[q] = vec;
    console.log(`(dim=${vec.length})`);
  }

  const out = {
    model: EMBED_MODEL,
    dim,
    generated_at: new Date().toISOString(),
    queries: vectors,
  };
  await fs.writeFile(CACHE_PATH, JSON.stringify(out), "utf-8");
  console.log(`\n✓ Wrote ${queries.length} cached query vectors to ${CACHE_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
