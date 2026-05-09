import { listChatModels } from "@/lib/llm";
import { env } from "@/lib/env";
import { isEmbeddingModel, modelMeta } from "@/lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/models
 *
 * Returns the chat models available on the currently configured
 * provider, with friendly labels. If the provider's /v1/models
 * endpoint is unreachable, returns an empty list and an error so the
 * UI can fall back to the env default.
 */
export async function GET() {
  try {
    const ids = await listChatModels();
    const filtered = ids.filter((id) => !isEmbeddingModel(id));
    const models = filtered
      .map((id) => {
        const m = modelMeta(id);
        return { id, label: m.label, badge: m.badge ?? null, family: m.family ?? null };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    return Response.json({
      provider: env.llm.provider,
      defaultModel: env.llm.model,
      models,
    });
  } catch (e) {
    return Response.json(
      {
        provider: env.llm.provider,
        defaultModel: env.llm.model,
        models: [],
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 200 },
    );
  }
}
