"""At-a-glance pipeline state.

Run ``python -m spider.cli status`` to see how far each stage has
progressed against the URL frontier. Useful for "where am I?" questions
after an interrupted run.
"""
from __future__ import annotations

from pathlib import Path

from rich.console import Console
from rich.table import Table

from . import config
from .util import read_json, read_jsonl

console = Console()


def _count_dir(path: Path, suffix: str = ".json") -> int:
    if not path.exists():
        return 0
    return sum(1 for p in path.iterdir() if p.is_file() and p.name.endswith(suffix))


def _dir_size_mb(path: Path) -> float:
    if not path.exists():
        return 0.0
    total = 0
    for p in path.rglob("*"):
        if p.is_file():
            total += p.stat().st_size
    return total / (1024 * 1024)


def _enrichment_breakdown() -> tuple[int, int, int]:
    ok = err = missing = 0
    for p in config.ENRICHED_DIR.iterdir() if config.ENRICHED_DIR.exists() else []:
        if not p.is_file() or not p.name.endswith(".json"):
            continue
        try:
            data = read_json(p)
            if data.get("status") == "ok":
                ok += 1
            elif data.get("status") == "error":
                err += 1
            else:
                missing += 1
        except Exception:
            err += 1
    return ok, err, missing


def _category_counts() -> dict[str, int]:
    counts: dict[str, int] = {}
    if not config.CORPUS_DIR.exists():
        return counts
    for sub in config.CORPUS_DIR.iterdir():
        if sub.is_dir():
            counts[sub.name] = sum(1 for p in sub.glob("*.json"))
    return counts


def run() -> None:
    urls = read_jsonl(config.URLS_FILE) if config.URLS_FILE.exists() else []
    n_urls = len(urls)
    n_raw = _count_dir(config.RAW_DIR, ".html")
    n_meta = _count_dir(config.META_DIR)
    n_parsed = _count_dir(config.PARSED_DIR)
    n_enr = _count_dir(config.ENRICHED_DIR)
    ok, err, _ = _enrichment_breakdown()
    cat_counts = _category_counts()

    table = Table(title="Pipeline status", header_style="bold cyan")
    table.add_column("stage")
    table.add_column("count", justify="right")
    table.add_column("of frontier", justify="right")
    table.add_column("on disk", justify="right")

    def _row(stage: str, n: int, size_mb: float) -> None:
        pct = f"{(n / n_urls * 100):.0f}%" if n_urls else "-"
        table.add_row(stage, str(n), pct, f"{size_mb:.1f} MB")

    _row("discover (urls.jsonl)", n_urls, _dir_size_mb(config.URLS_FILE.parent) if n_urls else 0.0)
    _row("fetch (cache/raw)", n_raw, _dir_size_mb(config.RAW_DIR))
    _row("parse (data/parsed)", n_parsed, _dir_size_mb(config.PARSED_DIR))
    _row("enrich (data/enriched)", n_enr, _dir_size_mb(config.ENRICHED_DIR))

    n_corpus = sum(cat_counts.values())
    _row("emit (corpus)", n_corpus, _dir_size_mb(config.CORPUS_DIR))

    console.print(table)
    console.print()
    console.print(f"  enriched: [green]ok={ok}[/green]  [red]error={err}[/red]")
    if cat_counts:
        cats = "  ".join(f"[bold]{k}[/bold]={v}" for k, v in sorted(cat_counts.items()))
        console.print(f"  corpus by category: {cats}")
    if n_urls and n_enr < n_urls:
        remaining = n_urls - ok
        console.print(
            f"  [yellow]{remaining} doc(s) still need successful enrichment.[/yellow]"
            "  Re-run [bold]python -m spider.cli enrich[/bold] to continue."
        )

    log_path = config.DATA_DIR / "enrich.log"
    if log_path.exists():
        console.print(f"  enrichment log: [cyan]{log_path}[/cyan] ({log_path.stat().st_size / 1024:.1f} KB)")
