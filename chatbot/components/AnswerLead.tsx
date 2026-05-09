"use client";

import React from "react";
import type { RetrievalHit } from "@/lib/types";

/**
 * Renders the streamed LLM lead with:
 *   - markdown-style "- " bullets converted to a real list
 *   - inline [#N] citation markers replaced by clickable superscript chips
 *     that scroll-spy to <article id="src-N"> below.
 *
 * Kept dependency-free on purpose; the lead text is short and tightly
 * formatted, so a 30-line parser beats pulling in react-markdown.
 */

// Matches "[#1]" and the multi-citation form "[#1, #2, #3]" or "[#1,2,3]".
const CITE_RE = /\[#\s*(\d+(?:\s*,\s*#?\s*\d+)*)\s*\]/g;

function CitationChip({
  n,
  hits,
  msgId,
}: {
  n: number;
  hits?: RetrievalHit[];
  msgId: string;
}) {
  const hit = hits?.[n - 1];
  const label = hit?.entry.title ?? `Source ${n}`;
  return (
    <a
      href={`#${msgId}-src-${n}`}
      title={label}
      onClick={(e) => {
        e.preventDefault();
        const el = document.getElementById(`${msgId}-src-${n}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("ring-2", "ring-nswSky");
          setTimeout(() => el.classList.remove("ring-2", "ring-nswSky"), 1200);
        }
      }}
      className="inline-flex items-center justify-center align-super mx-0.5 px-1.5 min-w-[18px] h-[18px] text-[10px] font-mono font-semibold text-white bg-nswSky hover:bg-nsw rounded-full no-underline transition-colors"
    >
      {n}
    </a>
  );
}

function renderInline(
  text: string,
  hits: RetrievalHit[] | undefined,
  msgId: string,
  keyPrefix: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let groupIdx = 0;
  for (const m of text.matchAll(CITE_RE)) {
    const start = m.index ?? 0;
    if (start > lastIndex) out.push(text.slice(lastIndex, start));
    const ns = m[1]
      .split(",")
      .map((s) => Number(s.replace(/[#\s]/g, "")))
      .filter((n) => Number.isFinite(n) && n > 0);
    ns.forEach((n, j) =>
      out.push(
        <CitationChip
          key={`${keyPrefix}-c-${groupIdx}-${j}`}
          n={n}
          hits={hits}
          msgId={msgId}
        />,
      ),
    );
    groupIdx += 1;
    lastIndex = start + m[0].length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] };

function parseBlocks(raw: string): Block[] {
  const blocks: Block[] = [];
  const lines = raw.split(/\r?\n/);
  let buf: string[] = [];
  let bullets: string[] = [];

  const flushPara = () => {
    const t = buf.join(" ").trim();
    if (t) blocks.push({ kind: "p", text: t });
    buf = [];
  };
  const flushList = () => {
    if (bullets.length) blocks.push({ kind: "ul", items: [...bullets] });
    bullets = [];
  };

  for (const lineRaw of lines) {
    const line = lineRaw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const m = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (m) {
      flushPara();
      bullets.push(m[1]);
    } else {
      flushList();
      buf.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}

export function AnswerLead({
  text,
  hits,
  msgId,
}: {
  text: string;
  hits?: RetrievalHit[];
  msgId: string;
}) {
  if (!text.trim()) {
    return <span className="text-slate-400">Thinking…</span>;
  }
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-2 text-[15px] leading-relaxed text-slate-800 dark:text-slate-100">
      {blocks.map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>{renderInline(b.text, hits, msgId, `${i}`)}</p>
        ) : (
          <ul key={i} className="list-disc pl-5 space-y-1">
            {b.items.map((it, j) => (
              <li key={j}>{renderInline(it, hits, msgId, `${i}-${j}`)}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
