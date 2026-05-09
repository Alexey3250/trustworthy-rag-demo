"""Quality report on the emitted corpus.

This is *not* a substitute for human review; it's a cheap, repeatable
sanity check that flags the things that most often go wrong with
LLM-augmented corpora:

- empty / very short summaries
- missing or sparse FAQs
- FAQs whose ``link`` we had to drop because it wasn't in the source
- documents with no how_to_steps where we'd expect them (transactions)
- enrichment failures (status != ok)

Run ``python -m spider.cli evaluate`` after ``emit``.
"""
from __future__ import annotations

import json
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from rich.console import Console
from rich.table import Table

from . import config
from .util import read_json

console = Console()


@dataclass
class DocReport:
    path: Path
    url: str
    category: str
    title: str
    has_summary: bool
    summary_len: int
    n_topics: int
    n_faqs: int
    n_steps: int
    n_eligibility: int
    n_what_you_need: int
    n_external_links: int
    n_internal_links: int
    enriched_ok: bool
    flags: list[str]


_SHORT_SUMMARY = 50
_MIN_FAQS = 3


def _evaluate_doc(path: Path) -> DocReport:
    doc = read_json(path)
    summary = (doc.get("summary") or "").strip()
    faqs = doc.get("faqs") or []
    enriched_ok = doc.get("source", {}).get("enrichment_status") == "ok"

    flags: list[str] = []
    if not enriched_ok:
        flags.append("not_enriched")
    if not summary:
        flags.append("no_summary")
    elif len(summary) < _SHORT_SUMMARY:
        flags.append("short_summary")
    if len(faqs) == 0:
        flags.append("no_faqs")
    elif len(faqs) < _MIN_FAQS:
        flags.append("few_faqs")
    if doc.get("category") == "transaction" and not (doc.get("how_to_steps") or []):
        flags.append("transaction_no_steps")
    if any(not (f.get("q") and f.get("a")) for f in faqs):
        flags.append("malformed_faq")

    return DocReport(
        path=path,
        url=doc.get("url") or "",
        category=doc.get("category") or "?",
        title=doc.get("title") or "",
        has_summary=bool(summary),
        summary_len=len(summary),
        n_topics=len(doc.get("topics") or []),
        n_faqs=len(faqs),
        n_steps=len(doc.get("how_to_steps") or []),
        n_eligibility=len(doc.get("who_can_apply") or []),
        n_what_you_need=len(doc.get("what_you_need") or []),
        n_external_links=len(doc.get("external_links") or []),
        n_internal_links=len(doc.get("internal_links") or []),
        enriched_ok=enriched_ok,
        flags=flags,
    )


def _all_docs() -> list[DocReport]:
    out: list[DocReport] = []
    for sub in config.CORPUS_DIR.iterdir():
        if not sub.is_dir():
            continue
        for p in sub.glob("*.json"):
            out.append(_evaluate_doc(p))
    return out


def _stats(values: Iterable[int]) -> tuple[int, int, float, int]:
    vals = list(values)
    if not vals:
        return (0, 0, 0.0, 0)
    return (min(vals), max(vals), statistics.mean(vals), int(statistics.median(vals)))


def _summary_table(reports: list[DocReport]) -> None:
    n = len(reports)
    if not n:
        console.print("[red]No corpus documents found. Did you run `emit`?[/red]")
        return

    n_enriched = sum(1 for r in reports if r.enriched_ok)
    n_with_summary = sum(1 for r in reports if r.has_summary)
    n_with_steps = sum(1 for r in reports if r.n_steps > 0)
    n_with_faqs = sum(1 for r in reports if r.n_faqs > 0)

    table = Table(title="Corpus quality summary", header_style="bold cyan")
    table.add_column("metric")
    table.add_column("value", justify="right")
    table.add_row("total docs", str(n))
    table.add_row("enriched ok", f"{n_enriched} / {n}")
    table.add_row("with summary", f"{n_with_summary} / {n}")
    table.add_row("with topics (>=1)", f"{sum(1 for r in reports if r.n_topics > 0)} / {n}")
    table.add_row("with faqs (>=1)", f"{n_with_faqs} / {n}")
    table.add_row("with how_to_steps", f"{n_with_steps} / {n}")

    s_min, s_max, s_mean, s_med = _stats(r.summary_len for r in reports if r.has_summary)
    f_min, f_max, f_mean, f_med = _stats(r.n_faqs for r in reports)
    t_min, t_max, t_mean, t_med = _stats(r.n_topics for r in reports)
    table.add_row("summary length (chars)", f"min={s_min} med={s_med} mean={s_mean:.0f} max={s_max}")
    table.add_row("faqs per doc", f"min={f_min} med={f_med} mean={f_mean:.1f} max={f_max}")
    table.add_row("topics per doc", f"min={t_min} med={t_med} mean={t_mean:.1f} max={t_max}")

    console.print(table)


def _flags_table(reports: list[DocReport]) -> None:
    flag_counts: dict[str, int] = {}
    for r in reports:
        for f in r.flags:
            flag_counts[f] = flag_counts.get(f, 0) + 1
    if not flag_counts:
        console.print("[green]No quality flags raised.[/green]")
        return

    table = Table(title="Quality flags", header_style="bold yellow")
    table.add_column("flag")
    table.add_column("count", justify="right")
    table.add_column("meaning")
    descriptions = {
        "not_enriched": "LLM enrichment failed or missing; doc has only deterministic fields.",
        "no_summary": "Empty summary string.",
        "short_summary": f"Summary shorter than {_SHORT_SUMMARY} chars.",
        "no_faqs": "Zero FAQs produced.",
        "few_faqs": f"Fewer than {_MIN_FAQS} FAQs (target is 3-6).",
        "transaction_no_steps": "Transaction page with no extractable how_to_steps.",
        "malformed_faq": "At least one FAQ is missing q or a.",
    }
    for flag, n in sorted(flag_counts.items(), key=lambda x: (-x[1], x[0])):
        table.add_row(flag, str(n), descriptions.get(flag, ""))
    console.print(table)


def _samples(reports: list[DocReport], k: int = 5) -> None:
    cats = sorted({r.category for r in reports})
    console.print()
    console.print("[bold]Random samples (one per category):[/bold]")
    for cat in cats:
        cat_docs = [r for r in reports if r.category == cat and r.enriched_ok]
        if not cat_docs:
            continue
        sample = sorted(cat_docs, key=lambda r: r.path.name)[: max(1, k // len(cats))]
        for r in sample:
            doc = read_json(r.path)
            console.print()
            console.print(f"[cyan]{r.category}/{r.path.stem}[/cyan]  -- {r.title}")
            console.print(f"  summary: {doc.get('summary')}")
            console.print(f"  topics:  {', '.join(doc.get('topics') or [])}")
            faqs = doc.get("faqs") or []
            for f in faqs[:2]:
                console.print(f"  Q: {f.get('q')}")
                console.print(f"  A: {f.get('a')}")
                if f.get("link"):
                    console.print(f"     -> {f['link']}")


def _flagged_examples(reports: list[DocReport], n: int = 8) -> None:
    flagged = [r for r in reports if r.flags]
    if not flagged:
        return
    flagged.sort(key=lambda r: (-len(r.flags), r.path.name))
    console.print()
    console.print(f"[bold]First {min(n, len(flagged))} flagged docs:[/bold]")
    for r in flagged[:n]:
        console.print(f"  [yellow]{','.join(r.flags):<40}[/yellow] {r.category}/{r.path.stem}")


def run(*, write_report: bool = True) -> None:
    reports = _all_docs()
    _summary_table(reports)
    console.print()
    _flags_table(reports)
    _flagged_examples(reports)
    _samples(reports)
    if write_report:
        out = config.CORPUS_DIR / "evaluation.json"
        out.write_text(
            json.dumps(
                {
                    "doc_count": len(reports),
                    "enriched_ok": sum(1 for r in reports if r.enriched_ok),
                    "by_flag": {
                        flag: [r.path.relative_to(config.CORPUS_DIR).as_posix() for r in reports if flag in r.flags]
                        for flag in {f for r in reports for f in r.flags}
                    },
                    "per_doc": [
                        {
                            "path": r.path.relative_to(config.CORPUS_DIR).as_posix(),
                            "category": r.category,
                            "title": r.title,
                            "summary_len": r.summary_len,
                            "n_topics": r.n_topics,
                            "n_faqs": r.n_faqs,
                            "n_steps": r.n_steps,
                            "n_eligibility": r.n_eligibility,
                            "n_what_you_need": r.n_what_you_need,
                            "flags": r.flags,
                        }
                        for r in sorted(reports, key=lambda x: x.path.name)
                    ],
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        console.print()
        console.print(f"  full report: [cyan]{out}[/cyan]")
