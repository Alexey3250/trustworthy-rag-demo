/**
 * One-shot indexer. Reads ../corpus/index.json, embeds each doc using
 * the configured local embedding model, writes ../corpus/.embeddings.json
 *
 * Run after every `python -m spider.cli emit`:
 *
 *     npm run build-index
 *
 * Re-runs are idempotent: if the embeddings file already covers every
 * doc with the same model, nothing happens. Pass --force to rebuild.
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

// Prefer chatbot/corpus (Vercel layout) and fall back to ../corpus (the
// spider's output) so this script works in either workflow.
function resolveCorpus(): string {
  const candidates = [
    path.join(process.cwd(), "corpus"),
    path.join(ROOT, "corpus"),
  ];
  for (const c of candidates) {
    try {
      readFileSync(path.join(c, "index.json"), "utf-8");
      return c;
    } catch {}
  }
  return candidates[0];
}
const CORPUS_DIR = resolveCorpus();
const INDEX_PATH = path.join(CORPUS_DIR, "index.json");
const EMB_PATH = path.join(CORPUS_DIR, ".embeddings.json");

function readEnvFromLocal() {
  // Tiny .env.local loader so we don't add a runtime dotenv dep just
  // for a build script. Reads chatbot/.env.local first, then the
  // project-root .env.local as fallback (so users can keep one secret
  // file at the repo root).
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

async function embed(text: string): Promise<number[]> {
  const r = await client.embeddings.create({ model: EMBED_MODEL, input: text });
  return r.data[0].embedding;
}

async function main() {
  const indexRaw = await fs.readFile(INDEX_PATH, "utf-8");
  const index = JSON.parse(indexRaw) as { docs: IndexEntry[] };
  console.log(`Indexing ${index.docs.length} docs with ${EMBED_MODEL} ...`);

  let existing: { model: string; vectors: { path: string }[] } | null = null;
  if (!FORCE) {
    try {
      existing = JSON.parse(await fs.readFile(EMB_PATH, "utf-8"));
    } catch {
      /* no prior index */
    }
  }
  const haveSet = new Set(
    existing && existing.model === EMBED_MODEL
      ? existing.vectors.map((v) => v.path)
      : [],
  );

  type Vec = { path: string; url: string; text: string; vec: number[] };
  const vectors: Vec[] = [];
  const startedAt = Date.now();
  let dim = 0;
  for (let i = 0; i < index.docs.length; i++) {
    const entry = index.docs[i];
    const docPath = path.join(CORPUS_DIR, entry.path);
    const doc = JSON.parse(await fs.readFile(docPath, "utf-8")) as CorpusDoc;

    if (haveSet.has(entry.path) && existing) {
      const prev = existing.vectors.find((v) => v.path === entry.path) as Vec;
      vectors.push(prev);
      continue;
    }

    const text = chunkText(entry, doc);
    const t0 = Date.now();
    const vec = await embed(text);
    dim = vec.length;
    const ms = Date.now() - t0;
    vectors.push({ path: entry.path, url: entry.url, text, vec });
    if (i % 5 === 0 || i === index.docs.length - 1) {
      const pct = (((i + 1) / index.docs.length) * 100).toFixed(0);
      console.log(`  [${i + 1}/${index.docs.length}] ${pct}% — ${entry.path} (${ms} ms)`);
    }
  }

  const out = {
    model: EMBED_MODEL,
    dim,
    generated_at: new Date().toISOString(),
    vectors,
  };
  await fs.writeFile(EMB_PATH, JSON.stringify(out), "utf-8");
  console.log(
    `Wrote ${vectors.length} vectors (${dim}-d) to ${EMB_PATH}  in ${(
      (Date.now() - startedAt) /
      1000
    ).toFixed(1)} s`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
