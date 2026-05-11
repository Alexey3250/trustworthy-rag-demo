"use client";

import { useState } from "react";
import { RetrievalHit } from "@/lib/types";

function Section({
  title,
  children,
  hidden,
}: {
  title: string;
  children: React.ReactNode;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <div className="mt-3">
      <div className="text-[11px] font-semibold tracking-wider text-goldDark/80 uppercase">
        {title}
      </div>
      <div className="mt-1 text-[14px] leading-relaxed text-ink">
        {children}
      </div>
    </div>
  );
}

export type AnswerCardVariant = "primary" | "related" | "candidate";

export function AnswerCard({
  hit,
  index,
  msgId,
  variant = "primary",
}: {
  hit: RetrievalHit;
  index: number;
  msgId: string;
  variant?: AnswerCardVariant;
}) {
  const d = hit.doc;
  const e = hit.entry;
  const [open, setOpen] = useState(false);

  const borderClass =
    variant === "primary"
      ? "border-gold/40 shadow-gold"
      : variant === "candidate"
        ? "border-amber-300"
        : "border-gold/15";

  return (
    <article
      id={`${msgId}-src-${index + 1}`}
      className={`scroll-mt-24 rounded-xl border bg-white shadow-sm overflow-hidden transition-shadow ${borderClass}`}
    >
      <header
        className={`px-4 py-3 cursor-pointer hover:bg-gold/[0.04] transition-colors ${
          open ? "border-b border-gold/10" : ""
        }`}
        onClick={() => setOpen((v) => !v)}
        role="button"
        aria-expanded={open}
        aria-controls={`${msgId}-src-${index + 1}-body`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wide">
              <span
                className={`inline-flex items-center justify-center min-w-[20px] h-[20px] rounded-full text-white text-[10px] ${
                  variant === "primary"
                    ? "bg-gold-gradient"
                    : variant === "candidate"
                      ? "bg-amber-500"
                      : "bg-ink/30"
                }`}
              >
                {index + 1}
              </span>
              <span className="text-ink/50">{e.category}</span>
              {variant === "primary" && (
                <span className="px-1.5 py-0.5 rounded bg-gold/10 text-goldDark border border-gold/30 text-[10px]">
                  primary source
                </span>
              )}
              {variant === "candidate" && (
                <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[10px]">
                  option
                </span>
              )}
            </div>
            <h3 className="mt-1 font-semibold text-ink leading-snug">
              {e.title}
            </h3>
            {d.summary && (
              <p className="text-sm text-ink/60 mt-1 line-clamp-2">
                {d.summary}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-[10px] font-mono text-ink/40 whitespace-nowrap text-right hidden sm:block">
              <div>fused {hit.fusedScore.toFixed(3)}</div>
              <div>
                bm25 {hit.bm25Score.toFixed(2)} · cos {hit.denseScore.toFixed(2)}
              </div>
            </div>
            <span
              className={`text-ink/40 transition-transform ${
                open ? "rotate-180" : ""
              }`}
              aria-hidden
            >
              ▾
            </span>
          </div>
        </div>
      </header>

      {open && (
        <div id={`${msgId}-src-${index + 1}-body`}>
          <div className="px-4 py-3">
            <Section title="Who can apply" hidden={!d.who_can_apply?.length}>
              <ul className="list-disc pl-5 space-y-1">
                {d.who_can_apply.slice(0, 6).map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </Section>

            <Section title="What you need" hidden={!d.what_you_need?.length}>
              <ul className="list-disc pl-5 space-y-1">
                {d.what_you_need.slice(0, 6).map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </Section>

            <Section title="How to" hidden={!d.how_to_steps?.length}>
              <ol className="list-decimal pl-5 space-y-1">
                {d.how_to_steps.map((s) => (
                  <li key={s.n}>
                    {s.text}
                    {s.link && (
                      <>
                        {" "}
                        <a
                          href={s.link}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-goldDark hover:text-ink underline decoration-dotted"
                        >
                          ↗
                        </a>
                      </>
                    )}
                  </li>
                ))}
              </ol>
            </Section>

            {d.faqs?.length > 0 && (
              <Section title="FAQ">
                <div className="space-y-2">
                  {d.faqs.slice(0, 3).map((f, i) => (
                    <div key={i}>
                      <div className="font-medium">{f.q}</div>
                      <div className="text-ink/70 text-sm">
                        {f.a}
                        {f.link && (
                          <>
                            {" "}
                            <a
                              href={f.link}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-goldDark hover:text-ink underline decoration-dotted"
                            >
                              source
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>

          <footer className="px-4 py-3 bg-gold/[0.04] border-t border-gold/10 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/60">
            <a
              href={e.url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(ev) => ev.stopPropagation()}
              className="font-medium text-goldDark hover:text-ink underline decoration-dotted break-all"
            >
              {e.url}
            </a>
            {e.last_modified && (
              <span className="font-mono">last updated · {e.last_modified}</span>
            )}
          </footer>
        </div>
      )}
    </article>
  );
}
