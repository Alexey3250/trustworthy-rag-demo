import { NextRequest } from "next/server";
import { generation } from "@/lib/llm";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/**
 * POST /api/warmup { model? }
 *
 * Fires a 1-token completion against the chosen model so the next
 * real chat call has a hot model. Returns the warmup latency, which
 * is roughly the cold-start cost the user would otherwise pay.
 *
 * For Ollama: this loads the model from disk into VRAM.
 * For Cerebras: this is essentially a connectivity / auth probe and
 *               returns in well under a second.
 */
export async function POST(req: NextRequest) {
  let model = env.llm.model;
  try {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body.model === "string" && body.model.trim()) {
      model = body.model.trim();
    }
  } catch {
    /* ignore */
  }

  const t0 = performance.now();
  try {
    const r = await generation.chat.completions.create({
      model,
      messages: [{ role: "user", content: "ok" }],
      max_tokens: 1,
      temperature: 0,
    });
    const ms = performance.now() - t0;
    return Response.json({
      ok: true,
      provider: env.llm.provider,
      model,
      ms,
      promptTokens: r.usage?.prompt_tokens ?? 0,
      completionTokens: r.usage?.completion_tokens ?? 0,
    });
  } catch (e) {
    const ms = performance.now() - t0;
    return Response.json(
      {
        ok: false,
        provider: env.llm.provider,
        model,
        ms,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 200 },
    );
  }
}
