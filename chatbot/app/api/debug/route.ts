import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { hybridRetrieve } from "@/lib/retrieve/hybrid";
import { loadCorpus } from "@/lib/retrieve/corpus";
import { pickMode } from "@/lib/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Diagnostic: env + a dry-run pickMode for an optional query. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  let trace: unknown = null;
  if (q) {
    const { index, docs, embeddings } = await loadCorpus();
    const r = await hybridRetrieve({
      query: q,
      index,
      docs,
      embeddings,
      topK: env.retrieval.topK,
      answerAt: env.retrieval.answerAt,
      clarifyAt: env.retrieval.clarifyAt,
      minMargin: env.retrieval.minMargin,
      shortQueryWords: env.retrieval.shortQueryWords,
    });
    const recomputed = pickMode(r.topDense, {
      answerAt: env.retrieval.answerAt,
      clarifyAt: env.retrieval.clarifyAt,
      margin: r.denseMargin,
      minMargin: env.retrieval.minMargin,
      query: q,
      shortQueryWords: env.retrieval.shortQueryWords,
    });
    trace = {
      query: q,
      topDense: r.topDense,
      top2Dense: r.topDense - r.denseMargin,
      denseMargin: r.denseMargin,
      modeFromHybrid: r.mode,
      modeRecomputed: recomputed,
      thresholds: {
        clarifyAt: env.retrieval.clarifyAt,
        answerAt: env.retrieval.answerAt,
        minMargin: env.retrieval.minMargin,
      },
    };
  }
  return Response.json({
    retrieval: env.retrieval,
    embed: { enabled: env.embed.enabled },
    trace,
  });
}
