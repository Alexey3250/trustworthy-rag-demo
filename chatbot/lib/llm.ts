import OpenAI from "openai";
import { env } from "./env";
import { lookupQueryEmbedding } from "./queryCache";

/**
 * Both Ollama (>= 0.5) and Cerebras Cloud expose the OpenAI Chat
 * Completions API. Provider switching is therefore just env: change
 * LLM_BASE_URL + LLM_API_KEY + LLM_MODEL and restart.
 *
 * We keep TWO clients:
 *   - generation: governed by LLM_*  (swappable Ollama <-> Cerebras)
 *   - embedding:  governed by EMBED_* (always local; Cerebras has no
 *                 embeddings endpoint as of writing).
 */
export const generation = new OpenAI({
  baseURL: env.llm.baseUrl,
  apiKey: env.llm.apiKey,
});

export const embedding = env.embed.enabled
  ? new OpenAI({
      baseURL: env.embed.baseUrl,
      apiKey: env.embed.apiKey || "none",
    })
  : null;

export type EmbedResult = {
  vector: number[];
  promptTokens: number;
  totalTokens: number;
};

/**
 * Embeds a single string. Returns `null` if embeddings aren't configured
 * (e.g. Vercel + Cerebras-only deployment). Callers should treat null
 * as "fall back to BM25-only" rather than as an error.
 */
export async function embedOne(text: string): Promise<EmbedResult | null> {
  if (!embedding) return null;
  const resp = await embedding.embeddings.create({
    model: env.embed.model,
    input: text,
  });
  return {
    vector: resp.data[0].embedding,
    promptTokens: resp.usage?.prompt_tokens ?? 0,
    totalTokens: resp.usage?.total_tokens ?? 0,
  };
}

/**
 * Query-side embedding with a pre-computed cache for the showcase
 * suggestions. Tried in order:
 *   1. Static cache (`corpus/.query-cache.json`) — zero network, zero
 *      tokens. Makes hybrid retrieval work on Vercel + Cerebras-only
 *      deployments for the preset questions.
 *   2. Live `embedOne()` — only runs if EMBED_* is configured.
 * Returns null if neither hits, so the caller falls back to BM25-only.
 */
export async function embedQuery(text: string): Promise<
  (EmbedResult & { source: "cache" | "live" }) | null
> {
  const cached = lookupQueryEmbedding(text);
  if (cached) {
    return { vector: cached, promptTokens: 0, totalTokens: 0, source: "cache" };
  }
  const live = await embedOne(text);
  return live ? { ...live, source: "live" } : null;
}

export function describeProvider(model?: string) {
  return { provider: env.llm.provider, model: model ?? env.llm.model };
}

/** Fetch the available chat models from the configured provider's
 *  OpenAI-compatible /v1/models endpoint. Both Ollama and Cerebras
 *  speak this. Returns ids only; UI labels them via lib/models.ts. */
export async function listChatModels(): Promise<string[]> {
  const url = `${env.llm.baseUrl.replace(/\/+$/, "")}/models`;
  const resp = await fetch(url, {
    headers: { authorization: `Bearer ${env.llm.apiKey}` },
    cache: "no-store",
  });
  if (!resp.ok) {
    throw new Error(`Failed to list models: ${resp.status} ${resp.statusText}`);
  }
  const data = (await resp.json()) as { data?: { id: string }[] };
  return (data.data ?? []).map((m) => m.id);
}
