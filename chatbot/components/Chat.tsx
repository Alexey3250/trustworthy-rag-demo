"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { SUGGESTIONS, type Route } from "@/lib/suggestions";

const ROUTE_STYLES: Record<
  Route,
  { border: string; tagBg: string; tagText: string; hover: string }
> = {
  answer: {
    border: "border-gold/25",
    tagBg: "bg-gold/10",
    tagText: "text-goldDark",
    hover: "hover:border-gold hover:shadow-gold",
  },
  clarify: {
    border: "border-amber-300/60",
    tagBg: "bg-amber-100",
    tagText: "text-amber-800",
    hover: "hover:border-amber-400 hover:shadow-[0_4px_24px_-8px_rgba(245,158,11,0.35)]",
  },
  guide: {
    border: "border-ink/15",
    tagBg: "bg-ink/5",
    tagText: "text-ink/55",
    hover: "hover:border-ink/30",
  },
};

const ROUTE_LEGEND: { route: Route; label: string; desc: string }[] = [
  { route: "answer", label: "Answer", desc: "high-confidence hit" },
  { route: "clarify", label: "Clarify", desc: "ambiguous — bot asks back" },
  { route: "guide", label: "Out of scope", desc: "polite refusal" },
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
    case "embed_source":
      perf.embed_source = e.source;
      break;
  }
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [draft]);

  const onModelChange = useCallback((m: string) => {
    setModel(m);
  }, []);

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
    [busy, model],
  );

  const onStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const onNewChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setDraft("");
  }, []);

  return (
    <div className="flex flex-col h-dvh overflow-hidden">
      <header className="shrink-0 px-3 sm:px-6 py-3 border-b border-gold/20 bg-white/80 backdrop-blur-md z-10 shadow-soft">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <ConciergeMark />
            <div className="min-w-0">
              <h1 className="font-serif text-lg sm:text-xl text-ink leading-tight truncate">
                Government Concierge
              </h1>
              <p className="text-[10px] sm:text-[11px] text-ink/60 truncate tracking-wide">
                Service NSW assistant · grounded in official sources
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <SessionTokenBadge tokens={sessionTokens} />
            {messages.length > 0 && (
              <button
                onClick={onNewChat}
                className="text-xs px-2.5 sm:px-3 py-1.5 rounded-full border border-gold/30 text-ink/70 hover:border-gold hover:text-ink hover:bg-gold/5 transition"
                title="Start a new conversation"
              >
                New
              </button>
            )}
            <ModelPicker onModelChange={onModelChange} />
          </div>
        </div>
      </header>

      <main
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="max-w-3xl mx-auto px-3 sm:px-4 py-6 sm:py-8 space-y-6">
          {messages.length === 0 && <Welcome onPick={send} />}
          {messages.map((m) => (
            <MessageBlock key={m.id} message={m} />
          ))}
        </div>
      </main>

      <div className="shrink-0 border-t border-gold/20 bg-white/85 backdrop-blur-md px-3 sm:px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <form
          className="max-w-3xl mx-auto flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              className="w-full resize-none rounded-2xl border border-gold/30 bg-white px-4 py-3 pr-3 text-base sm:text-sm placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold transition shadow-soft min-h-[48px] max-h-[200px]"
              rows={1}
              placeholder="Ask anything about Service NSW…"
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
          </div>
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="shrink-0 h-12 w-12 sm:w-auto sm:px-5 rounded-2xl bg-ink text-cream text-sm font-medium hover:bg-ink/90 transition shadow-soft flex items-center justify-center"
            >
              <span className="hidden sm:inline">Stop</span>
              <span className="sm:hidden" aria-hidden>
                ◼
              </span>
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send message"
              className="shrink-0 h-12 w-12 sm:w-auto sm:px-5 rounded-2xl bg-gold-gradient text-white text-sm font-semibold hover:shadow-gold disabled:opacity-40 disabled:cursor-not-allowed transition shadow-soft flex items-center justify-center"
              disabled={!draft.trim()}
            >
              <span className="hidden sm:inline">Send</span>
              <span className="sm:hidden text-base" aria-hidden>
                ↑
              </span>
            </button>
          )}
        </form>
        <CreditStrip />
      </div>
    </div>
  );
}

function CreditStrip() {
  return (
    <div className="max-w-3xl mx-auto mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] sm:text-[11px] text-ink/50">
      <span className="hidden sm:inline">
        Always confirm details on the official site.
      </span>
      <span className="hidden sm:inline text-ink/30">·</span>
      <span>
        by{" "}
        <a
          href="https://github.com/Alexey3250"
          target="_blank"
          rel="noreferrer noopener"
          className="font-semibold text-ink/80 hover:text-goldDark underline decoration-gold decoration-1 underline-offset-2 transition"
        >
          Alexey Efimik
        </a>
      </span>
      <span className="text-ink/30">·</span>
      <a
        href="https://github.com/Alexey3250"
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 hover:text-ink transition"
        aria-label="GitHub profile"
      >
        <GitHubIcon />
        <span>@Alexey3250</span>
      </a>
      <span className="text-ink/30">·</span>
      <a
        href="https://github.com/Alexey3250/trustworthy-rag-demo"
        target="_blank"
        rel="noreferrer noopener"
        className="hover:text-ink transition"
      >
        Source ↗
      </a>
    </div>
  );
}

function ConciergeMark() {
  return (
    <div className="relative h-10 w-10 rounded-full bg-gold-gradient flex items-center justify-center shadow-gold shrink-0">
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5 text-white"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M3 21h18" />
        <path d="M5 21V10l4-3 4 3v11" />
        <path d="M13 21V14l4-2 4 2v7" />
        <path d="M9 7V3" />
      </svg>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="text-center mt-8 sm:mt-16 space-y-8">
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gold/10 border border-gold/30 text-[11px] uppercase tracking-[0.2em] text-goldDark font-medium">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-gradient" />
          Service NSW · Australia
        </div>
        <h2 className="font-serif text-3xl sm:text-4xl text-ink leading-tight">
          How can I help you today?
        </h2>
        <p className="text-ink/60 max-w-md mx-auto">
          Ask about licences, registrations, fines, residency, and other public
          services. Every answer cites its source.
        </p>
      </div>
      <NswExplainer />
      <div className="max-w-2xl mx-auto space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink/40 font-semibold">
            Try asking…
          </p>
          <RouteLegend />
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {SUGGESTIONS.map((s) => {
            const st = ROUTE_STYLES[s.route];
            return (
              <button
                key={s.text}
                onClick={() => onPick(s.text)}
                title={`Routing: ${s.route}`}
                className={`group flex items-start gap-3 text-left text-sm px-4 py-3 rounded-xl bg-white border transition shadow-soft ${st.border} ${st.hover}`}
              >
                <span className="text-lg shrink-0 leading-none mt-0.5">
                  {s.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`inline-block text-[10px] uppercase tracking-wider font-semibold mb-1 px-1.5 py-0.5 rounded ${st.tagBg} ${st.tagText}`}
                  >
                    {s.tag}
                  </span>
                  <span className="block text-ink/80 group-hover:text-ink leading-snug">
                    {s.text}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-ink/50 leading-relaxed pt-1">
          The bot routes each query by retrieval confidence —{" "}
          <span className="text-goldDark font-medium">gold</span> answers
          directly,{" "}
          <span className="text-amber-700 font-medium">amber</span> asks you to
          pick from candidates, and{" "}
          <span className="text-ink/60 font-medium">gray</span> politely refuses
          without calling the LLM.
        </p>
      </div>
    </div>
  );
}

function RouteLegend() {
  return (
    <div className="flex items-center gap-2 text-[10px] text-ink/45">
      {ROUTE_LEGEND.map((l) => {
        const st = ROUTE_STYLES[l.route];
        return (
          <span
            key={l.route}
            title={l.desc}
            className="inline-flex items-center gap-1"
          >
            <span
              className={`h-2 w-2 rounded-full border ${st.border}`}
              style={{
                backgroundColor:
                  l.route === "answer"
                    ? "rgba(201,165,90,0.35)"
                    : l.route === "clarify"
                      ? "rgba(245,158,11,0.4)"
                      : "rgba(26,20,16,0.15)",
              }}
            />
            <span className="uppercase tracking-wider">{l.label}</span>
          </span>
        );
      })}
    </div>
  );
}

function NswExplainer() {
  return (
    <div className="max-w-2xl mx-auto text-left rounded-2xl border border-gold/25 bg-white/70 backdrop-blur px-5 py-4 shadow-soft">
      <div className="flex items-start gap-3">
        <span
          className="text-xl shrink-0 leading-none mt-0.5"
          aria-hidden
          title="Flag of New South Wales"
        >
          🇦🇺
        </span>
        <div className="text-sm text-ink/75 leading-relaxed">
          <p>
            <span className="font-semibold text-ink">What's NSW?</span>{" "}
            New South Wales — Australia's most populous state, capital{" "}
            <span className="font-medium">Sydney</span>. Home to ~8.4 million
            people on the country's east coast.
          </p>
          <p className="mt-1.5 text-ink/60">
            This assistant answers questions about{" "}
            <a
              href="https://www.service.nsw.gov.au"
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-goldDark underline decoration-gold decoration-2 underline-offset-2 hover:text-ink"
            >
              Service NSW
            </a>
            , the state's one-stop shop for government services. (And yes —
            NSW, not NSFW. 😉)
          </p>
        </div>
      </div>
    </div>
  );
}

function GitHubIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.16 1.18a10.96 10.96 0 0 1 5.76 0c2.2-1.49 3.16-1.18 3.16-1.18.62 1.58.23 2.75.11 3.04.73.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.07.78 2.16v3.2c0 .31.21.67.8.56C20.21 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
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
      className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono bg-white border border-gold/30 text-ink/70 tabular-nums"
    >
      <span className="text-ink/40">session</span>
      <span className="text-ink">{tokens.total.toLocaleString()}</span>
      <span className="text-ink/40">tok</span>
    </div>
  );
}

const MODE_LABEL: Record<Mode, string> = {
  answer: "Answer",
  clarify: "Quick question",
  guide: "Let me help",
};

const MODE_LABEL_COLOR: Record<Mode, string> = {
  answer: "text-goldDark",
  clarify: "text-amber-700",
  guide: "text-ink/50",
};

function MessageBlock({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="rounded-2xl rounded-br-md bg-gold-gradient text-white px-4 py-2.5 max-w-[80%] whitespace-pre-wrap shadow-gold">
          {message.text}
        </div>
      </div>
    );
  }

  const hits = (message.hits ?? []) as RetrievalHit[];
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
      <div className="rounded-2xl rounded-bl-md bg-white border border-gold/20 px-5 py-4 shadow-soft">
        <div
          className={`flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] font-semibold ${MODE_LABEL_COLOR[mode]}`}
        >
          <span className="h-1 w-1 rounded-full bg-current" />
          {MODE_LABEL[mode]}
        </div>
        <div className="mt-2">
          <AnswerLead text={message.text} hits={hits} msgId={message.id} />
        </div>
        <PerfPanel msg={message} />
      </div>

      {hits.length > 0 && !message.text.trim() && (
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-ink/40 font-semibold">
          <span className="h-1 w-1 rounded-full bg-gold" />
          {hits.length} source{hits.length > 1 ? "s" : ""} found · waiting for answer
        </div>
      )}
      {mode === "answer" && hits.length > 0 && message.text.trim() && (
        <AnswerSourceList hits={hits} msgId={message.id} />
      )}
      {mode === "clarify" && hits.length > 0 && message.text.trim() && (
        <CandidateList hits={hits} msgId={message.id} />
      )}
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
      <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-goldDark">
        Source
      </div>
      <AnswerCard hit={primary} index={0} msgId={msgId} variant="primary" />
      {related.length > 0 && (
        <>
          <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-ink/40 pt-2">
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
      <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-amber-700">
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
