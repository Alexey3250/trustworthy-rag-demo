export type CorpusDoc = {
  url: string;
  source_url: string;
  category: string;
  article_kind: string | null;
  slug: string;
  title: string;
  summary: string | null;
  topics: string[];
  intro: string | null;
  who_can_apply: string[];
  what_you_need: string[];
  how_to_steps: { n: number; text: string; link: string | null }[];
  fees: string | null;
  processing_time: string | null;
  contact: string | null;
  more_info: { text: string; link: string | null }[];
  external_links: { text: string; url: string }[];
  internal_links: { text: string; url: string }[];
  faqs: { q: string; a: string; link: string | null }[];
  source: {
    fetched_at: string | null;
    last_modified: string | null;
    html_sha1: string;
    enriched: boolean;
    enrichment_status: string;
  };
};

export type IndexEntry = {
  url: string;
  category: string;
  article_kind: string | null;
  slug: string;
  title: string;
  summary: string | null;
  topics: string[];
  path: string;
  last_modified: string | null;
};

export type CorpusIndex = {
  generated_at: string;
  host: string;
  doc_count: number;
  docs: IndexEntry[];
};

export type EmbeddingsFile = {
  model: string;
  dim: number;
  generated_at: string;
  vectors: { path: string; url: string; text: string; vec: number[] }[];
};

export type RetrievalHit = {
  entry: IndexEntry;
  doc: CorpusDoc;
  bm25Score: number;
  denseScore: number;
  fusedScore: number;
  bm25Rank: number;
  denseRank: number;
};

export type PerfEvent =
  | { type: "stage"; name: string; ms: number }
  | { type: "ttft"; ms: number }
  | { type: "latency"; ms: number }
  | { type: "tokens"; n: number }
  | { type: "tps"; tps: number }
  | { type: "model"; provider: string; model: string }
  | { type: "usage"; input: number; output: number; embed: number }
  | { type: "embed_source"; source: "cache" | "live" | "none" };

export type Mode = "answer" | "clarify" | "guide";

export type ChatStreamEvent =
  | { type: "retrieved"; hits: RetrievalHit[]; mode: Mode }
  | { type: "perf"; event: PerfEvent }
  | { type: "token"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  hits?: RetrievalHit[];
  mode?: Mode;
  perf?: Record<string, number | string>;
};
