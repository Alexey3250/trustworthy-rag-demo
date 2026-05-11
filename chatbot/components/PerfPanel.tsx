"use client";

import { useState } from "react";
import { Message } from "@/lib/types";

const ORDER = [
  ["model", "model"],
  ["provider", "provider"],
  ["load_corpus_ms", "load corpus"],
  ["retrieve_ms", "retrieve"],
  ["retrieve.bm25_ms", "  · bm25"],
  ["retrieve.dense_ms", "  · dense"],
  ["ttft_ms", "ttft"],
  ["generate_ms", "generate"],
  ["tokens", "tokens"],
  ["tps", "tokens/s"],
  ["input_tokens", "in tokens"],
  ["output_tokens", "out tokens"],
  ["embed_tokens", "embed tokens"],
  ["total_tokens", "total tokens"],
  ["latency_ms", "total latency"],
] as const;

function fmt(key: string, val: number | string | undefined): string {
  if (val === undefined || val === null) return "—";
  if (typeof val === "string") return val;
  if (key.endsWith("_ms")) {
    if (val < 1) return `${val.toFixed(2)} ms`;
    if (val < 1000) return `${Math.round(val)} ms`;
    return `${(val / 1000).toFixed(2)} s`;
  }
  if (key === "tps") return `${val} t/s`;
  if (Number.isFinite(val)) return val.toLocaleString();
  return String(val);
}

export function PerfPanel({ msg }: { msg: Message }) {
  const [open, setOpen] = useState(false);
  if (!msg.perf || Object.keys(msg.perf).length === 0) return null;
  const p = msg.perf;
  return (
    <div className="mt-3 text-[11px] font-mono leading-snug">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-1.5 rounded-md bg-white/60 dark:bg-white/5 border border-slate-200/60 dark:border-white/10 hover:border-nswSky transition-colors"
      >
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600 dark:text-slate-300">
          {p.provider && p.model && (
            <span>
              <span className="text-slate-400">{p.provider}</span>{" "}
              <span className="text-slate-700 dark:text-slate-100">{p.model}</span>
            </span>
          )}
          {p.ttft_ms !== undefined && (
            <span>
              <span className="text-slate-400">ttft</span>{" "}
              <span className="tabular-nums">
                {fmt("ttft_ms", p.ttft_ms)}
              </span>
            </span>
          )}
          {p.tps !== undefined && (
            <span>
              <span className="text-slate-400">tps</span>{" "}
              <span className="tabular-nums">{fmt("tps", p.tps)}</span>
            </span>
          )}
          {p.total_tokens !== undefined && (
            <span title="input + output + embedding tokens">
              <span className="text-slate-400">tokens</span>{" "}
              <span className="tabular-nums">
                {Number(p.total_tokens).toLocaleString()}
              </span>
            </span>
          )}
          {p.embed_source === "cache" && (
            <span
              title="Query embedding served from the static cache (corpus/.query-cache.json) — no embeddings endpoint hit"
              className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] uppercase tracking-wider"
            >
              embed: cache
            </span>
          )}
          {p.embed_source === "live" && (
            <span
              title="Query embedding fetched live from the embeddings endpoint"
              className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] uppercase tracking-wider"
            >
              embed: live
            </span>
          )}
          {p.embed_source === "none" && (
            <span
              title="No embedding available — fell back to BM25-only retrieval"
              className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] uppercase tracking-wider"
            >
              bm25 only
            </span>
          )}
          {p.latency_ms !== undefined && (
            <span>
              <span className="text-slate-400">latency</span>{" "}
              <span className="tabular-nums">
                {fmt("latency_ms", p.latency_ms)}
              </span>
            </span>
          )}
        </span>
        <span
          className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          ▾
        </span>
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 bg-white/60 dark:bg-white/5 rounded-md px-3 py-2 border border-slate-200/60 dark:border-white/10">
          {ORDER.map(([key, label]) => {
            const v = msg.perf?.[key];
            if (v === undefined) return null;
            return (
              <div key={key} className="flex justify-between gap-2">
                <span className="text-slate-500 dark:text-slate-400">{label}</span>
                <span className="text-slate-800 dark:text-slate-100 tabular-nums">
                  {fmt(key, v)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
