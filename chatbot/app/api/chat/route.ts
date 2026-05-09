import { NextRequest } from "next/server";
import { generation, describeProvider } from "@/lib/llm";
import { hybridRetrieve } from "@/lib/retrieve/hybrid";
import { loadCorpus } from "@/lib/retrieve/corpus";
import {
  SYSTEM_PROMPT,
  buildContextBlocks,
  buildUserPrompt,
  GUIDE_TEXT,
} from "@/lib/prompts";
import { env } from "@/lib/env";
import type { ChatStreamEvent } from "@/lib/types";
import { setTimeout as wait } from "node:timers/promises";

export const runtime = "nodejs";

/**
 * Streams NDJSON. One JSON object per line. Event shapes:
 *
 *   { type:"retrieved", hits:[...], mode:"answer"|"clarify"|"guide" }
 *   { type:"perf", event:{type:"stage", name:"retrieve", ms:120} }
 *   { type:"token", text:"..." }
 *   { type:"perf", event:{type:"ttft", ms:85} }
 *   { type:"perf", event:{type:"latency", ms:2400} }
 *   { type:"perf", event:{type:"tokens", n:47} }
 *   { type:"perf", event:{type:"tps", tps:19.6} }
 *   { type:"perf", event:{type:"usage", input, output, embed} }
 *   { type:"done" }
 */
export async function POST(req: NextRequest) {
  const { question, model: modelOverride } = (await req.json()) as {
    question?: string;
    model?: string;
  };
  if (!question || typeof question !== "string") {
    return new Response(JSON.stringify({ error: "Missing question" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const model = (modelOverride && modelOverride.trim()) || env.llm.model;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (e: ChatStreamEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));

      try {
        const t0 = performance.now();
        const { index, docs, embeddings } = await loadCorpus();
        const corpusMs = performance.now() - t0;
        send({ type: "perf", event: { type: "stage", name: "load_corpus", ms: corpusMs } });

        const provider = describeProvider(model);
        send({
          type: "perf",
          event: { type: "model", provider: provider.provider, model: provider.model },
        });

        const tRetrieve = performance.now();
        const result = await hybridRetrieve({
          query: question,
          index,
          docs,
          embeddings,
          topK: env.retrieval.topK,
          answerAt: env.retrieval.answerAt,
          clarifyAt: env.retrieval.clarifyAt,
          minMargin: env.retrieval.minMargin,
          shortQueryWords: env.retrieval.shortQueryWords,
        });
        const retrieveMs = performance.now() - tRetrieve;
        send({
          type: "perf",
          event: { type: "stage", name: "retrieve", ms: retrieveMs },
        });
        send({
          type: "perf",
          event: { type: "stage", name: "retrieve.bm25", ms: result.bm25Ms },
        });
        send({
          type: "perf",
          event: { type: "stage", name: "retrieve.dense", ms: result.denseMs },
        });
        send({ type: "retrieved", hits: result.hits, mode: result.mode });

        // ------- GUIDE mode: canned, no LLM call -------
        if (result.mode === "guide") {
          const pieces = GUIDE_TEXT.split(/(\s+)/);
          let firstAt: number | null = null;
          for (const w of pieces) {
            if (firstAt === null) {
              firstAt = performance.now();
              send({
                type: "perf",
                event: { type: "ttft", ms: firstAt - t0 },
              });
            }
            send({ type: "token", text: w });
            await wait(10);
          }
          const guideTokens = Math.ceil(GUIDE_TEXT.length / 4);
          send({ type: "perf", event: { type: "tokens", n: guideTokens } });
          send({
            type: "perf",
            event: {
              type: "usage",
              input: 0,
              output: guideTokens,
              embed: result.embedTokens,
            },
          });
          send({ type: "perf", event: { type: "latency", ms: performance.now() - t0 } });
          send({ type: "done" });
          controller.close();
          return;
        }

        // ------- ANSWER or CLARIFY mode: LLM call -------
        const context = buildContextBlocks(result.hits, env.retrieval.maxContextChars);
        const userPrompt = buildUserPrompt(question, context, result.mode);

        const tGen = performance.now();
        let firstTokenAt: number | null = null;
        let tokenCount = 0;
        let usageInput = 0;
        let usageOutput = 0;

        const stream = await generation.chat.completions.create({
          model,
          stream: true,
          temperature: 0.3,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          stream_options: { include_usage: true },
        });

        for await (const chunk of stream) {
          const piece = chunk.choices?.[0]?.delta?.content;
          if (piece) {
            if (firstTokenAt === null) {
              firstTokenAt = performance.now();
              send({
                type: "perf",
                event: { type: "ttft", ms: firstTokenAt - tGen },
              });
            }
            tokenCount += 1;
            send({ type: "token", text: piece });
          }
          if (chunk.usage) {
            usageInput = chunk.usage.prompt_tokens ?? usageInput;
            usageOutput = chunk.usage.completion_tokens ?? usageOutput;
          }
        }
        const tEnd = performance.now();
        const totalGenMs = tEnd - tGen;
        const generationOnly = firstTokenAt ? tEnd - firstTokenAt : totalGenMs;
        // TPS calibrated against streamed deltas (matches what the user
        // sees on screen). Some Ollama models report inflated
        // completion_tokens, which would make TPS look unreal.
        const tps = generationOnly > 0 ? (tokenCount * 1000) / generationOnly : 0;
        // For "tokens used" billing-style metric, prefer the API value
        // when present (that's what Cerebras would meter).
        const billedOut = usageOutput || tokenCount;

        send({ type: "perf", event: { type: "stage", name: "generate", ms: totalGenMs } });
        send({ type: "perf", event: { type: "tokens", n: tokenCount } });
        send({ type: "perf", event: { type: "tps", tps: Math.round(tps * 10) / 10 } });
        send({
          type: "perf",
          event: {
            type: "usage",
            input: usageInput,
            output: billedOut,
            embed: result.embedTokens,
          },
        });
        send({ type: "perf", event: { type: "latency", ms: tEnd - t0 } });
        send({ type: "done" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", message });
        send({ type: "done" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
