"""Stage 4: ask Ollama (gemma4:26b) to add chatbot-ready fields.

We feed the parser's structured brief into the local model and require a
JSON response matching ``prompts.SCHEMA``. On parse failure we retry once
with a "your previous reply was not valid JSON" nudge, and if that also
fails we skip enrichment for that doc and emit will fall back to the
deterministic fields only.

Concurrency is intentionally small (default 2): a 26B model on most
machines is the bottleneck, and parallel requests just thrash GPU memory.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any

import ollama
from rich.console import Console
from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    TextColumn,
    TimeElapsedColumn,
)

from . import config, prompts
from .util import read_json, read_jsonl, write_json

console = Console()

_REQUIRED_KEYS = {
    "summary",
    "topics",
    "faqs",
    "normalised_eligibility",
    "normalised_what_you_need",
}


def _extract_json(text: str) -> Any | None:
    """The model is forced to JSON via format='json', but we still defend
    against the occasional code-fenced reply or trailing junk."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not m:
            return None
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return None


def _sanitise(obj: Any, allowed_urls: set[str]) -> dict[str, Any] | None:
    """Coerce the LLM's reply into the schema. Returns None if the reply is
    too malformed to recover."""
    if not isinstance(obj, dict):
        return None

    summary = str(obj.get("summary") or "").strip()
    raw_topics = obj.get("topics") or []
    topics: list[str] = []
    for t in raw_topics:
        if isinstance(t, str):
            tag = re.sub(r"\s+", "-", t.strip().lower())
            tag = re.sub(r"[^a-z0-9-]", "", tag)
            if tag and tag not in topics:
                topics.append(tag)
    topics = topics[:6]

    raw_faqs = obj.get("faqs") or []
    faqs: list[dict[str, Any]] = []
    for f in raw_faqs:
        if not isinstance(f, dict):
            continue
        q = str(f.get("q") or "").strip()
        a = str(f.get("a") or "").strip()
        link = f.get("link")
        if isinstance(link, str):
            link = link.strip() or None
            if link and allowed_urls and link not in allowed_urls:
                link = None
        else:
            link = None
        if q and a:
            faqs.append({"q": q, "a": a, "link": link})
    faqs = faqs[:6]

    def _str_list(key: str) -> list[str]:
        items = obj.get(key) or []
        out: list[str] = []
        for item in items:
            if isinstance(item, str):
                s = item.strip()
                if s:
                    out.append(s)
        return out[:25]

    return {
        "summary": summary,
        "topics": topics,
        "faqs": faqs,
        "normalised_eligibility": _str_list("normalised_eligibility"),
        "normalised_what_you_need": _str_list("normalised_what_you_need"),
    }


def _allowed_urls(parsed: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    out.add(parsed.get("final_url") or parsed.get("url") or "")
    for ln in parsed.get("all_links") or []:
        u = ln.get("url")
        if u:
            out.add(u)
    for s in (parsed.get("bucketed") or {}).get("how_to_steps") or []:
        u = s.get("link")
        if u:
            out.add(u)
    out.discard("")
    return out


class OllamaEnricher:
    def __init__(self, model: str = config.OLLAMA_MODEL, host: str = config.OLLAMA_HOST):
        self.model = model
        self.client = ollama.Client(host=host, timeout=config.OLLAMA_TIMEOUT_S)
        self._warm = False

    def warmup(self) -> None:
        """Force the model into memory so the first real prompt does not
        race the cold-load against our request timeout."""
        if self._warm:
            return
        console.print(f"  warming up [bold]{self.model}[/bold] (loading weights, may take ~1\u20132 min) ...")
        self.client.chat(
            model=self.model,
            options={"temperature": 0.0, "num_predict": 8, "num_ctx": 1024},
            messages=[{"role": "user", "content": "Reply with the single word READY."}],
        )
        self._warm = True
        console.print("  model is resident")

    def _call(self, user: str) -> str:
        if not self._warm:
            self.warmup()
        resp = self.client.chat(
            model=self.model,
            options={"temperature": 0.1, "num_ctx": config.OLLAMA_NUM_CTX},
            format="json",
            messages=[
                {"role": "system", "content": prompts.SYSTEM},
                {"role": "user", "content": user},
            ],
        )
        return resp["message"]["content"]

    def enrich(self, parsed: dict[str, Any]) -> dict[str, Any] | None:
        prompt = prompts.build_user_prompt(parsed)
        allowed = _allowed_urls(parsed)
        for attempt in range(2):
            raw = self._call(
                prompt
                if attempt == 0
                else (
                    prompt
                    + "\n\nYour previous reply was not valid JSON or was missing required keys."
                    " Reply ONLY with a JSON object matching the schema above. No prose."
                )
            )
            obj = _extract_json(raw)
            if obj is None:
                continue
            cleaned = _sanitise(obj, allowed_urls=allowed)
            if cleaned is None:
                continue
            if not _REQUIRED_KEYS.issubset(cleaned.keys()):
                continue
            return cleaned
        return None


_LOG_LOCK = threading.Lock()


def _log_line(message: str) -> None:
    """Append a single timestamped line to data/enrich.log.

    Cheap, line-buffered, safe to ``Get-Content -Wait`` (PowerShell's tail -f).
    """
    line = f"{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}  {message}\n"
    log_path = config.DATA_DIR / "enrich.log"
    with _LOG_LOCK:
        with log_path.open("a", encoding="utf-8") as fh:
            fh.write(line)


def _enrich_one(
    parsed_path,
    enricher: OllamaEnricher,
    *,
    index: int,
    total: int,
    quiet: bool = False,
) -> tuple[str, str]:
    parsed = read_json(parsed_path)
    sha1 = parsed["sha1"]
    url = parsed.get("url") or ""
    out_path = config.ENRICHED_DIR / f"{sha1}.json"
    # Only treat *successful* prior runs as cached. Errors should be
    # retried on the next run without forcing the user to pass --force.
    if out_path.exists():
        existing = read_json(out_path)
        if existing.get("status") == "ok":
            return ("cached", sha1)

    started = time.monotonic()
    if not quiet:
        console.print(f"  [{index}/{total}] [dim]start[/dim]    {url}")
    _log_line(f"START [{index}/{total}] {url}")

    cleaned = enricher.enrich(parsed)
    elapsed = time.monotonic() - started

    if cleaned is None:
        write_json(
            out_path,
            {
                "sha1": sha1,
                "url": url,
                "status": "error",
                "enrichment": None,
                "elapsed_s": round(elapsed, 1),
            },
        )
        if not quiet:
            console.print(
                f"  [{index}/{total}] [red]error[/red]    {url}  ({elapsed:.1f}s)"
            )
        _log_line(f"ERROR [{index}/{total}] {url}  ({elapsed:.1f}s)")
        return ("error", sha1)

    write_json(
        out_path,
        {
            "sha1": sha1,
            "url": url,
            "status": "ok",
            "enrichment": cleaned,
            "elapsed_s": round(elapsed, 1),
        },
    )
    if not quiet:
        console.print(
            f"  [{index}/{total}] [green]ok[/green]       {url}  ({elapsed:.1f}s)"
        )
    _log_line(f"OK    [{index}/{total}] {url}  ({elapsed:.1f}s)")
    return ("ok", sha1)


def run(
    *,
    workers: int = config.DEFAULT_ENRICH_WORKERS,
    limit: int | None = None,
    force: bool = False,
    max_docs: int | None = None,
    max_time_min: float | None = None,
    quiet: bool = False,
) -> dict[str, int]:
    """Enrich parsed docs with the LLM.

    Safety limits:
        max_docs:     stop after processing this many *new* documents
                      (cached docs don't count). Use as a smoke-test cap.
        max_time_min: stop after this many wall-clock minutes once the
                      first request has fired (excludes warmup).
                      Either limit triggers a graceful shutdown: in-flight
                      requests finish, results persist, log gets a STOP
                      line, and counts are returned as usual.
    """
    counts = {"ok": 0, "cached": 0, "error": 0, "stopped_early": 0}
    entries = read_jsonl(config.URLS_FILE)
    if limit:
        entries = entries[:limit]
    if not entries:
        console.print(f"[red]No URLs in {config.URLS_FILE}.[/red] Run `discover` first.")
        return counts

    parsed_paths = []
    for e in entries:
        p = config.PARSED_DIR / f"{e['sha1']}.json"
        if p.exists():
            if force:
                out = config.ENRICHED_DIR / f"{e['sha1']}.json"
                if out.exists():
                    out.unlink()
            parsed_paths.append(p)

    console.print(
        f"Enriching [bold]{len(parsed_paths)}[/bold] parsed docs with [bold]{config.OLLAMA_MODEL}[/bold]"
        f" ({workers} concurrent) ..."
    )
    if max_docs:
        console.print(f"  [yellow]safety: stop after {max_docs} new doc(s)[/yellow]")
    if max_time_min:
        console.print(f"  [yellow]safety: stop after {max_time_min:.1f} min of work[/yellow]")
    console.print(f"  heartbeat log: [cyan]{config.DATA_DIR / 'enrich.log'}[/cyan]")
    _log_line(
        f"=== START run model={config.OLLAMA_MODEL} workers={workers} "
        f"docs={len(parsed_paths)} max_docs={max_docs} max_time_min={max_time_min}"
    )

    enricher = OllamaEnricher()
    enricher.warmup()

    stop_at = (time.monotonic() + max_time_min * 60) if max_time_min else None
    n_new = 0
    stop_flag = threading.Event()

    def task(arg):
        i, path = arg
        if stop_flag.is_set():
            return ("stopped_early", "")
        if stop_at is not None and time.monotonic() > stop_at:
            stop_flag.set()
            return ("stopped_early", "")
        result = _enrich_one(path, enricher, index=i, total=len(parsed_paths), quiet=quiet)
        return result

    try:
        with cf.ThreadPoolExecutor(max_workers=workers) as ex:
            for status, _sha in ex.map(task, enumerate(parsed_paths, start=1)):
                counts[status] = counts.get(status, 0) + 1
                if status in ("ok", "error"):
                    n_new += 1
                    if max_docs and n_new >= max_docs:
                        stop_flag.set()
    except KeyboardInterrupt:
        console.print("[yellow]Interrupted by user. Partial results are saved.[/yellow]")
        _log_line("INTERRUPT")

    _log_line(
        f"=== END   ok={counts['ok']} cached={counts['cached']} "
        f"error={counts['error']} stopped_early={counts['stopped_early']}"
    )
    console.print(
        f"  ok={counts['ok']}  cached={counts['cached']}  error={counts['error']}"
        + (f"  stopped_early={counts['stopped_early']}" if counts.get("stopped_early") else "")
    )
    return counts
