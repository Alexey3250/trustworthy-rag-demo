function need(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v && v.trim()) return v.trim();
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing env var ${name}`);
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

const embedBaseUrl = optional("EMBED_BASE_URL");

export const env = {
  llm: {
    provider: need("LLM_PROVIDER", "ollama"),
    baseUrl: need("LLM_BASE_URL", "http://127.0.0.1:11434/v1"),
    apiKey: need("LLM_API_KEY", "ollama"),
    model: need("LLM_MODEL", "gemma4:e4b"),
  },
  embed: {
    // Embeddings are optional. When unset (e.g. Vercel + Cerebras-only),
    // the chatbot falls back to BM25-only retrieval. Quality is still
    // good for small corpora; hybrid wins on larger ones.
    enabled: Boolean(embedBaseUrl),
    baseUrl: embedBaseUrl ?? "",
    apiKey: optional("EMBED_API_KEY") ?? "",
    model: optional("EMBED_MODEL") ?? "",
  },
  retrieval: {
    topK: Number(need("TOP_K", "3")),
    // Modes from retrieval confidence (top dense cosine):
    //   topDense >= ANSWER_AT  -> answer
    //   ANSWER_AT > topDense >= CLARIFY_AT -> clarify
    //   topDense < CLARIFY_AT -> guide (canned, no LLM call)
    answerAt: Number(need("ANSWER_AT", "0.65")),
    clarifyAt: Number(need("CLARIFY_AT", "0.40")),
    // If top1 - top2 dense cosine is below this AND the user's query
    // is short/vague, route to clarify even when the absolute score
    // is high. Long specific queries always trust the top hit.
    minMargin: Number(need("MIN_MARGIN", "0.05")),
    shortQueryWords: Number(need("SHORT_QUERY_WORDS", "5")),
    maxContextChars: Number(need("MAX_CONTEXT_CHARS", "6000")),
  },
};
