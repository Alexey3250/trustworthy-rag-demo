import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import type {
  CorpusDoc,
  CorpusIndex,
  EmbeddingsFile,
  IndexEntry,
} from "../types";

// On Vercel the project root is `chatbot/`, so we look inside it first.
// Locally we also support `../corpus` for development against the spider's
// output. CORPUS_DIR env var overrides both.
function resolveCorpusDir(): string {
  if (process.env.CORPUS_DIR) return path.resolve(process.env.CORPUS_DIR);
  const candidates = [
    path.resolve(process.cwd(), "corpus"),
    path.resolve(process.cwd(), "..", "corpus"),
  ];
  for (const c of candidates) {
    if (existsSync(path.join(c, "index.json"))) return c;
  }
  return candidates[0];
}

const CORPUS_DIR = resolveCorpusDir();
const INDEX_PATH = path.join(CORPUS_DIR, "index.json");
const EMBEDDINGS_PATH = path.join(CORPUS_DIR, ".embeddings.json");

let cached: {
  index: CorpusIndex;
  docs: Map<string, CorpusDoc>;
  embeddings?: EmbeddingsFile;
} | null = null;

export async function loadCorpus(): Promise<{
  index: CorpusIndex;
  docs: Map<string, CorpusDoc>;
  embeddings?: EmbeddingsFile;
}> {
  if (cached) return cached;

  const indexRaw = await fs.readFile(INDEX_PATH, "utf-8");
  const index: CorpusIndex = JSON.parse(indexRaw);

  const docs = new Map<string, CorpusDoc>();
  await Promise.all(
    index.docs.map(async (entry: IndexEntry) => {
      const docPath = path.join(CORPUS_DIR, entry.path);
      const raw = await fs.readFile(docPath, "utf-8");
      docs.set(entry.path, JSON.parse(raw) as CorpusDoc);
    }),
  );

  let embeddings: EmbeddingsFile | undefined;
  try {
    const embRaw = await fs.readFile(EMBEDDINGS_PATH, "utf-8");
    embeddings = JSON.parse(embRaw) as EmbeddingsFile;
    if (embeddings.vectors.length !== index.docs.length) {
      console.warn(
        `[corpus] embeddings file has ${embeddings.vectors.length} vectors but index has ${index.docs.length} docs; rerun \`npm run build-index\``,
      );
    }
  } catch {
    console.warn(
      `[corpus] no embeddings file at ${EMBEDDINGS_PATH}; dense retrieval disabled. Run \`npm run build-index\`.`,
    );
  }

  cached = { index, docs, embeddings };
  return cached;
}

export function corpusPaths() {
  return { CORPUS_DIR, INDEX_PATH, EMBEDDINGS_PATH };
}
