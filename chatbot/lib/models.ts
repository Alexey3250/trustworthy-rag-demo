/**
 * Display labels for known models. Anything not listed here is shown
 * with its raw id, so this file is purely for prettification and is
 * safe to fall through. Both Ollama and Cerebras expose `/v1/models`,
 * so the *list* of models is fetched at runtime — this map only
 * provides a friendly label and an optional badge.
 */
export type ModelMeta = { label: string; badge?: string; family?: string };

export const MODEL_LABELS: Record<string, ModelMeta> = {
  // ---- Ollama (local) ----
  "gemma4:e4b": { label: "Gemma 4 E4B", badge: "fast", family: "Gemma" },
  "gemma4:26b": { label: "Gemma 4 26B", badge: "quality", family: "Gemma" },
  "gemma3:27b": { label: "Gemma 3 27B", badge: "quality", family: "Gemma" },
  "gemma3:12b": { label: "Gemma 3 12B", family: "Gemma" },
  "gemma3:4b": { label: "Gemma 3 4B", badge: "fast", family: "Gemma" },
  "llama3.2:3b": { label: "Llama 3.2 3B", badge: "fast", family: "Llama" },
  "llama3.1:8b": { label: "Llama 3.1 8B", family: "Llama" },
  "qwen3:8b": { label: "Qwen 3 8B", family: "Qwen" },
  "qwen3:14b": { label: "Qwen 3 14B", family: "Qwen" },
  "qwen2.5:7b": { label: "Qwen 2.5 7B", family: "Qwen" },
  "phi4": { label: "Phi-4", family: "Phi" },
  "mistral-small3.1": { label: "Mistral Small 3.1", family: "Mistral" },

  // ---- Cerebras Cloud (free tier) ----
  "llama-4-scout-17b-16e-instruct": { label: "Llama 4 Scout 17B", badge: "fast", family: "Llama" },
  "llama-4-maverick-17b-128e-instruct": { label: "Llama 4 Maverick 17B", family: "Llama" },
  "llama-3.3-70b": { label: "Llama 3.3 70B", badge: "quality", family: "Llama" },
  "llama3.1-8b": { label: "Llama 3.1 8B", badge: "fast", family: "Llama" },
  "qwen-3-235b-a22b-instruct-2507": { label: "Qwen 3 235B", badge: "quality", family: "Qwen" },
  "qwen-3-32b": { label: "Qwen 3 32B", family: "Qwen" },
  "qwen-3-coder-480b": { label: "Qwen 3 Coder 480B", family: "Qwen" },
  "gpt-oss-120b": { label: "GPT-OSS 120B", badge: "quality", family: "GPT" },
};

function inferFamily(id: string): string | undefined {
  const lower = id.toLowerCase();
  if (lower.startsWith("gemma")) return "Gemma";
  if (lower.startsWith("llama")) return "Llama";
  if (lower.startsWith("qwen")) return "Qwen";
  if (lower.startsWith("mistral")) return "Mistral";
  if (lower.startsWith("phi")) return "Phi";
  if (lower.startsWith("deepseek")) return "DeepSeek";
  if (lower.startsWith("gpt")) return "GPT";
  return undefined;
}

export function modelMeta(id: string): ModelMeta {
  const explicit = MODEL_LABELS[id];
  if (explicit) return explicit;
  return { label: id, family: inferFamily(id) };
}

const EMBED_PATTERNS = /embed|nomic|bge|gte|arctic|jina/i;

export function isEmbeddingModel(id: string): boolean {
  return EMBED_PATTERNS.test(id);
}
