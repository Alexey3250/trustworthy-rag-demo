"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  ChatStreamEvent,
  Message,
  Mode,
  PerfEvent,
  RetrievalHit,
} from "@/lib/types";
import { AnswerCard } from "./AnswerCard";
import { AnswerLead } from "./AnswerLead";
import { PerfPanel } from "./PerfPanel";
import { ModelPicker } from "./ModelPicker";
import { looksLikeRefusal } from "@/lib/prompts";

const SUGGESTIONS = [
  "How do I renew my driving licence?",
  "What do I need to renew my car rego online?",
  "I need a licence",
  "How do I pay an overdue fine?",
  "I just moved to NSW from interstate",
];

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

function applyPerf(perf: Record<string, number | string>, e: PerfEvent) {
  switch (e.type) {
    case "stage":
      perf[`${e.name}_ms`] = e.ms;
      break;
    case "ttft":
      perf.ttft_ms = e.ms;
      break;
    case "latency":
      perf.latency_ms = e.ms;
      break;
    case "tokens":
      perf.tokens = e.n;
      break;
    case "tps":
      perf.tps = e.tps;
      break;
    case "model":
      perf.model = e.model;
      perf.provider = e.provider;
      break;
    case "usage":
      perf.input_tokens = e.input;
      perf.output_tokens = e.output;
      perf.embed_tokens = e.embed;
      perf.total_tokens = e.input + e.output + e.embed;
      break;
  }
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  const onModelChange = useCallback((m: string) => {
    setModel(m);
  }, []);

  // Session token tally (sum of every assistant turn so far).
  const sessionTokens = useMemo(() => {
    let input = 0;
    let output = 0;
    let embed = 0;
    for (const m of messages) {
      const p = m.perf ?? {};
      input += Number(p.input_tokens ?? 0);
      output += Number(p.output_tokens ?? 0);
      embed += Number(p.embed_tokens ?? 0);
    }
    return { input, output, embed, total: input + output + embed };
  }, [messages]);

  const send = useCallback(
    async (q: string) => {
      if (!q.trim() || busy) return;

      const userMsg: Message = { id: newId(), role: "user", text: q.trim() };
      const assistantId = newId();
      const assistantMsg: Message = {
        id: assistantId,
        role: "assistant",
        text: "",
        perf: {},
        hits: [],
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setDraft("");
      setBusy(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: q.trim(), model: model || undefined }),
          signal: ctrl.signal,
        });
        if (!resp.body) throw new Error("No response body");
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const evt = JSON.parse(line) as ChatStreamEvent;
            applyEvent(setMessages, assistantId, evt);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        applyEvent(setMessages, assistantId, { type: "error", message });
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy],
  );

  const onStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <div className="flex flex-col h-screen">
      <header className="px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-white/10 bg-white/80 dark:bg-ink/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-semibold text-lg text-nsw dark:text-white truncate">
              Service NSW Assistant
            </h1>
            <p className="text-[11px] text-slate-500 truncate">
              Demo · Retrieval-grounded · Cites Service NSW pages
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <SessionTokenBadge tokens={sessionTokens} />
            <ModelPicker onModelChange={onModelChange} />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
          {messages.length === 0 && (
            <div className="text-center text-slate-500 mt-16 space-y-4">
              <p>Ask about a NSW government service.</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-sm px-3 py-1.5 rounded-full bg-white dark:bg-white/10 border border-slate-200 dark:border-white/10 hover:border-nswSky hover:text-nsw dark:hover:text-white transition"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <MessageBlock key={m.id} message={m} />
          ))}
        </div>
      </main>

      <footer className="border-t border-slate-200 dark:border-white/10 bg-white/80 dark:bg-ink/60 backdrop-blur px-4 py-3">
        <form
          className="max-w-3xl mx-auto flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <textarea
            className="flex-1 resize-none rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-nswSky"
            rows={2}
            placeholder="Ask about a NSW government service…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            disabled={busy}
          />
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              className="rounded-lg bg-slate-700 text-white px-4 py-2 text-sm hover:bg-slate-800"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="rounded-lg bg-nsw text-white px-4 py-2 text-sm hover:bg-nswSky disabled:opacity-50"
              disabled={!draft.trim()}
            >
              Send
            </button>
          )}
        </form>
        <p className="max-w-3xl mx-auto mt-2 text-[11px] text-slate-500 font-mono">
          The assistant only uses information from the indexed Service NSW pages and quotes their step-by-step instructions verbatim.
        </p>
      </footer>
    </div>
  );
}

function applyEvent(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  id: string,
  evt: ChatStreamEvent,
) {
  setMessages((prev) =>
    prev.map((m) => {
      if (m.id !== id) return m;
      const next = { ...m, perf: { ...(m.perf ?? {}) } };
      switch (evt.type) {
        case "retrieved":
          next.hits = evt.hits;
          next.mode = evt.mode;
          break;
        case "token":
          next.text = (next.text ?? "") + evt.text;
          break;
        case "perf":
          applyPerf(next.perf as Record<string, number | string>, evt.event);
          break;
        case "error":
          next.text = (next.text ?? "") + `\n\n[error] ${evt.message}`;
          break;
        case "done":
          break;
      }
      return next;
    }),
  );
}

function SessionTokenBadge({
  tokens,
}: {
  tokens: { input: number; output: number; embed: number; total: number };
}) {
  if (tokens.total === 0) return null;
  return (
    <div
      title={`Session: ${tokens.input.toLocaleString()} in · ${tokens.output.toLocaleString()} out · ${tokens.embed.toLocaleString()} embed`}
      className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 tabular-nums"
    >
      <span className="text-slate-400">session</span>
      <span className="text-slate-800 dark:text-slate-100">
        {tokens.total.toLocaleString()}
      </span>
      <span className="text-slate-400">tok</span>
    </div>
  );
}

const MODE_LABEL: Record<Mode, string> = {
  answer: "Quick answer",
  clarify: "Quick question",
  guide: "How can I help?",
};

const MODE_LABEL_COLOR: Record<Mode, string> = {
  answer: "text-slate-400",
  clarify: "text-amber-600 dark:text-amber-300",
  guide: "text-slate-400",
};

function MessageBlock({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="rounded-2xl rounded-br-md bg-nsw text-white px-4 py-2 max-w-[80%] whitespace-pre-wrap">
          {message.text}
        </div>
      </div>
    );
  }

  const hits = (message.hits ?? []) as RetrievalHit[];
  // mode comes from the server. If the LLM produced a guide-shaped reply
  // despite being told to answer or clarify (model knows the blocks
  // don't actually cover the topic, e.g. "potato licence"), trust the
  // model and downgrade so the UI matches.
  let mode: Mode = message.mode ?? "answer";
  if (
    mode !== "guide" &&
    message.text.length > 30 &&
    looksLikeRefusal(message.text)
  ) {
    mode = "guide";
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl rounded-bl-md bg-white dark:bg-white/[0.04] border border-slate-200 dark:border-white/10 px-4 py-3 shadow-sm">
        <div
          className={`flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold ${MODE_LABEL_COLOR[mode]}`}
        >
          {MODE_LABEL[mode]}
        </div>
        <div className="mt-1.5">
          <AnswerLead text={message.text} hits={hits} msgId={message.id} />
        </div>
        <PerfPanel msg={message} />
      </div>

      {mode === "answer" && hits.length > 0 && (
        <AnswerSourceList hits={hits} msgId={message.id} />
      )}
      {mode === "clarify" && hits.length > 0 && (
        <CandidateList hits={hits} msgId={message.id} />
      )}
      {/* guide mode: no cards — we have nothing useful to suggest */}
    </div>
  );
}

function AnswerSourceList({
  hits,
  msgId,
}: {
  hits: RetrievalHit[];
  msgId: string;
}) {
  const [primary, ...related] = hits;
  return (
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">
        Source
      </div>
      <AnswerCard hit={primary} index={0} msgId={msgId} variant="primary" />
      {related.length > 0 && (
        <>
          <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 pt-2">
            Related pages
          </div>
          {related.map((h, i) => (
            <AnswerCard
              key={h.entry.url}
              hit={h}
              index={i + 1}
              msgId={msgId}
              variant="related"
            />
          ))}
        </>
      )}
    </div>
  );
}

function CandidateList({
  hits,
  msgId,
}: {
  hits: RetrievalHit[];
  msgId: string;
}) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-amber-600 dark:text-amber-300">
        Possible matches
      </div>
      {hits.map((h, i) => (
        <AnswerCard
          key={h.entry.url}
          hit={h}
          index={i}
          msgId={msgId}
          variant="candidate"
        />
      ))}
    </div>
  );
}

