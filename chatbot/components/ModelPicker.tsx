"use client";

import { useEffect, useRef, useState } from "react";

export type ModelOption = {
  id: string;
  label: string;
  badge: string | null;
  family: string | null;
};

type ModelsApiResponse = {
  provider: string;
  defaultModel: string;
  models: ModelOption[];
  error?: string;
};

type WarmupState =
  | { kind: "idle" }
  | { kind: "warming"; model: string }
  | { kind: "warm"; model: string; ms: number }
  | { kind: "error"; model: string; message: string };

const STORAGE_KEY = "chatbot.selectedModel";

export function ModelPicker({
  onModelChange,
}: {
  onModelChange: (model: string, provider: string) => void;
}) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [provider, setProvider] = useState<string>("");
  const [defaultModel, setDefaultModel] = useState<string>("");
  const [selected, setSelected] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warmup, setWarmup] = useState<WarmupState>({ kind: "idle" });
  const popoverRef = useRef<HTMLDivElement>(null);
  const lastWarmedRef = useRef<string | null>(null);

  // Fetch the catalog once on mount
  useEffect(() => {
    let cancelled = false;
    fetch("/api/models")
      .then((r) => r.json() as Promise<ModelsApiResponse>)
      .then((data) => {
        if (cancelled) return;
        setModels(data.models);
        setProvider(data.provider);
        setDefaultModel(data.defaultModel);
        setError(data.error ?? null);

        const stored = typeof window !== "undefined"
          ? localStorage.getItem(STORAGE_KEY)
          : null;
        const valid = stored && data.models.some((m) => m.id === stored);
        const initial = valid ? stored! : data.defaultModel;
        setSelected(initial);
        onModelChange(initial, data.provider);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [onModelChange]);

  // Warm up whenever the selected model changes
  useEffect(() => {
    if (!selected || lastWarmedRef.current === selected) return;
    lastWarmedRef.current = selected;
    setWarmup({ kind: "warming", model: selected });
    fetch("/api/warmup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: selected }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) {
          setWarmup({ kind: "warm", model: selected, ms: res.ms });
        } else {
          setWarmup({
            kind: "error",
            model: selected,
            message: res.error ?? "warmup failed",
          });
        }
      })
      .catch((e) => {
        setWarmup({
          kind: "error",
          model: selected,
          message: e instanceof Error ? e.message : String(e),
        });
      });
  }, [selected]);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function pick(id: string) {
    setSelected(id);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, id);
    onModelChange(id, provider);
    setOpen(false);
  }

  const current = models.find((m) => m.id === selected);
  const label = current?.label ?? selected ?? defaultModel;

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-nswSky transition text-sm"
      >
        <span className="px-1.5 py-0.5 text-[10px] uppercase font-mono rounded bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300">
          {provider || "—"}
        </span>
        <span className="font-medium text-slate-800 dark:text-slate-100 max-w-[180px] truncate">
          {label}
        </span>
        <WarmupBadge w={warmup} />
        <span className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-auto rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-ink shadow-xl z-20 p-1">
          {error && (
            <div className="px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              Couldn't reach {provider}: {error}
            </div>
          )}
          {models.length === 0 && !error && (
            <div className="px-3 py-2 text-xs text-slate-500">
              Loading models from {provider}…
            </div>
          )}
          {Object.entries(groupByFamily(models)).map(([family, list]) => (
            <div key={family}>
              <div className="px-3 pt-2 pb-1 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                {family}
              </div>
              {list.map((m) => (
                <button
                  key={m.id}
                  onClick={() => pick(m.id)}
                  className={`w-full flex items-center justify-between gap-2 text-left px-3 py-1.5 rounded-md text-sm hover:bg-slate-100 dark:hover:bg-white/5 ${
                    m.id === selected ? "bg-nswSky/10 text-nsw dark:text-nswSky" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{m.label}</div>
                    <div className="text-[11px] font-mono text-slate-400 truncate">
                      {m.id}
                    </div>
                  </div>
                  {m.badge && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                      {m.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WarmupBadge({ w }: { w: WarmupState }) {
  if (w.kind === "warming")
    return (
      <span className="text-[10px] font-mono text-amber-600 dark:text-amber-300">
        warming…
      </span>
    );
  if (w.kind === "warm")
    return (
      <span
        title={`Loaded in ${formatMs(w.ms)}`}
        className="text-[10px] font-mono text-emerald-600 dark:text-emerald-300"
      >
        warm · {formatMs(w.ms)}
      </span>
    );
  if (w.kind === "error")
    return (
      <span
        title={w.message}
        className="text-[10px] font-mono text-rose-600 dark:text-rose-300"
      >
        error
      </span>
    );
  return null;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function groupByFamily(models: ModelOption[]): Record<string, ModelOption[]> {
  const groups: Record<string, ModelOption[]> = {};
  for (const m of models) {
    const k = m.family ?? "Other";
    (groups[k] = groups[k] ?? []).push(m);
  }
  return groups;
}
