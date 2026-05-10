/**
 * Builds `corpus/.embeddings.json` for hybrid retrieval:
 * embeds each document's chunked text → one dense vector aligned with index.json rows.
 *
 *     npm run build-index
 *     npm run build-index -- --force              # rebuild all vectors
 *
 * Prefers `chatbot/corpus/`; falls back to `../corpus`.
 *
 * Batching:
 *   OpenAI-compatible providers accept `input` as string[] → one HTTP call per chunk.
 *   Ollama is detected (port 11434 or env EMBED_BATCH_SIZE=1) → sequential single-vector calls.
 */
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";

type IndexEntry = {
  url: string;
  category: string;
  slug: string;
  title: string;
  summary: string | null;
  topics: string[];
  path: string;
};
type CorpusDoc = {
  url: string;
  title: string;
  summary: string | null;
  intro: string | null;
  topics?: string[];
  faqs?: { q: string; a: string }[];
  who_can_apply?: string[];
  what_you_need?: string[];
};

const ROOT = path.resolve(process.cwd(), "..");

function resolveCorpus(): string {
  const candidates = [
    path.join(process.cwd(), "corpus"),
    path.join(ROOT, "corpus"),
  ];
  for (const c of candidates) {
    try {
      readFileSync(path.join(c, "index.json"), "utf-8");
      return c;
    } catch {
      /* try next */
    }
  }
  return candidates[0];
}
const CORPUS_DIR = resolveCorpus();
const INDEX_PATH = path.join(CORPUS_DIR, "index.json");
const EMB_PATH = path.join(CORPUS_DIR, ".embeddings.json");

function readEnvFromLocal() {
  const candidates = [
    path.join(process.cwd(), ".env.local"),
    path.join(ROOT, ".env.local"),
  ];
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
const FORCE = process.argv.includes("--force");

const client = new OpenAI({ baseURL: EMBED_BASE, apiKey: EMBED_KEY });

/** Ollama's OpenAI shim typically wants one string per request. */
const OLLAMA_LIKE =
  /11434|ollama\.local|localhost.*11434/i.test(EMBED_BASE) ||
  (process.env.EMBED_BATCH_SIZE ?? "").trim() === "1";
const BATCH_SIZE = OLLAMA_LIKE
  ? 1
  : Math.max(1, Math.min(256, Number(process.env.EMBED_BATCH_SIZE ?? "48")));

function chunkText(entry: IndexEntry, doc: CorpusDoc): string {
  const parts: string[] = [];
  parts.push(`Title: ${entry.title}`);
  if (entry.summary) parts.push(`Summary: ${entry.summary}`);
  if (entry.topics?.length) parts.push(`Topics: ${entry.topics.join(", ")}`);
  if (doc.intro) parts.push(`Intro: ${doc.intro}`);
  if (doc.faqs?.length) {
    parts.push("FAQs:");
    doc.faqs.slice(0, 6).forEach((f) => parts.push(`Q: ${f.q}\nA: ${f.a}`));
  }
  if (doc.who_can_apply?.length) {
    parts.push("Eligibility:");
    doc.who_can_apply.slice(0, 6).forEach((x) => parts.push(`- ${x}`));
  }
  return parts.join("\n");
}

async function embedOne(text: string): Promise<number[]> {
  const r = await client.embeddings.create({ model: EMBED_MODEL, input: text });
  const row = Array.isArray(r.data) ? r.data[0] : (r.data as unknown as { embedding: number[] });
  return row.embedding;
}

async function embedBatch(inputs: string[]): Promise<number[][]> {
  const r = await client.embeddings.create({
    model: EMBED_MODEL,
    input: inputs,
  });
  const rows = [...r.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return rows.map((d) => d.embedding);
}

type StoredVec = {
  path: string;
  url: string;
  text: string;
  vec: number[];
};

async function main() {
  const indexRaw = await fs.readFile(INDEX_PATH, "utf-8");
  const index = JSON.parse(indexRaw) as { docs: IndexEntry[] };
  const N = index.docs.length;
  console.log(`Corpus dir: ${CORPUS_DIR}`);
  console.log(`Indexing ${N} docs with "${EMBED_MODEL}" (batch=${BATCH_SIZE}) ...`);

  let existing: {
    model: string;
    dim: number;
    vectors: StoredVec[];
  } | null = null;
  if (!FORCE) {
    try {
      existing = JSON.parse(await fs.readFile(EMB_PATH, "utf-8"));
    } catch {
      /* none */
    }
  }

  const haveByPath =
    existing && existing.model === EMBED_MODEL
      ? Object.fromEntries(existing.vectors.map((v) => [v.path, v]))
      : undefined;

  const slots: (StoredVec | null)[] = new Array(N).fill(null);

  if (haveByPath) {
    for (let i = 0; i < N; i++) {
      const p = index.docs[i].path;
      const hit = haveByPath[p];
      if (hit) slots[i] = hit;
    }
    const reused = slots.filter(Boolean).length;
    console.log(`  reused ${reused}/${N} cached vectors (${EMBED_MODEL})\n`);
  }

  /** Indices that still need a fresh embedding */
  const missing: number[] = [];
  for (let i = 0; i < N; i++) if (!slots[i]) missing.push(i);

  console.log(`${missing.length} vectors to compute\n`);

  const startedAt = Date.now();
  let dim = existing?.dim ?? 0;

  for (let b = 0; b < missing.length; b += BATCH_SIZE) {
    const slice = missing.slice(b, b + BATCH_SIZE);
    const batchMeta: Array<{ idx: number; text: string; entry: IndexEntry }> = [];
    for (const idx of slice) {
      const entry = index.docs[idx];
      const docPath = path.join(CORPUS_DIR, entry.path);
      const doc = JSON.parse(await fs.readFile(docPath, "utf-8")) as CorpusDoc;
      const text = chunkText(entry, doc);
      batchMeta.push({ idx, text, entry });
    }

    let vecs: number[][];
    if (BATCH_SIZE === 1) {
      vecs = [await embedOne(batchMeta[0].text)];
    } else {
      vecs = await embedBatch(batchMeta.map((x) => x.text));
    }

    for (let k = 0; k < batchMeta.length; k++) {
      const { idx, text, entry } = batchMeta[k];
      dim = vecs[k].length;
      slots[idx] = { path: entry.path, url: entry.url, text, vec: vecs[k] };
    }

    const done = Math.min(b + BATCH_SIZE, missing.length);
    if (done % Math.max(50, BATCH_SIZE * 10) <= BATCH_SIZE || b + BATCH_SIZE >= missing.length) {
      const pct = ((done / missing.length) * 100).toFixed(1);
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(`  [${done}/${missing.length}] ${pct}% — ${elapsed}s elapsed`);
    }
  }

  const vectors = slots.map((v, i) => {
    if (!v)
      throw new Error(`missing vector at slot ${i} (${index.docs[i].path}); try --force`);
    return v;
  });

  const out = {
    model: EMBED_MODEL,
    dim,
    generated_at: new Date().toISOString(),
    vectors,
  };
  await fs.writeFile(EMB_PATH, JSON.stringify(out), "utf-8");

  console.log(
    `\nWrote ${vectors.length} vectors (${dim}-d) to ${EMB_PATH} ` +
      `in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
