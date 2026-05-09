"""Stage 1: read sitemap.xml, classify, and write the URL frontier."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

import httpx
from rich.console import Console

from . import config
from .util import category_of, slug_of, url_sha1, write_jsonl

console = Console()

_SITEMAP_ENTRY_RE = re.compile(
    r"<url>\s*<loc>([^<]+)</loc>"
    r"(?:\s*<lastmod>([^<]+)</lastmod>)?"
    r"(?:\s*<changefreq>([^<]+)</changefreq>)?"
    r"(?:\s*<priority>([^<]+)</priority>)?"
    r"\s*</url>",
    re.IGNORECASE | re.DOTALL,
)


@dataclass
class UrlEntry:
    url: str
    category: str
    slug: str
    sha1: str
    lastmod: str | None
    changefreq: str | None
    priority: str | None

    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "category": self.category,
            "slug": self.slug,
            "sha1": self.sha1,
            "lastmod": self.lastmod,
            "changefreq": self.changefreq,
            "priority": self.priority,
        }


def _is_disallowed(url: str) -> bool:
    path = url[len(config.HOST):] if url.startswith(config.HOST) else url
    return any(path.startswith(p) for p in config.ROBOTS_DISALLOW_PREFIXES)


def fetch_sitemap() -> str:
    headers = {"User-Agent": config.USER_AGENT, "Accept": "application/xml,text/xml,*/*"}
    with httpx.Client(timeout=config.FETCH_TIMEOUT_S, headers=headers, follow_redirects=True) as client:
        r = client.get(config.SITEMAP_URL)
        r.raise_for_status()
        return r.text


def parse_sitemap(xml: str) -> list[UrlEntry]:
    entries: list[UrlEntry] = []
    for match in _SITEMAP_ENTRY_RE.finditer(xml):
        url = match.group(1).strip()
        if _is_disallowed(url):
            continue
        if not url.startswith(config.HOST):
            continue
        entries.append(
            UrlEntry(
                url=url,
                category=category_of(url),
                slug=slug_of(url),
                sha1=url_sha1(url),
                lastmod=(match.group(2) or "").strip() or None,
                changefreq=(match.group(3) or "").strip() or None,
                priority=(match.group(4) or "").strip() or None,
            )
        )
    return entries


def _filter_demo(all_entries: list[UrlEntry]) -> list[UrlEntry]:
    """All /guide/ pages plus any /transaction/ page whose slug matches a
    curated substring."""
    by_slug: dict[str, UrlEntry] = {}
    for e in all_entries:
        if e.category == "guide" and e.slug != "guide":
            by_slug[e.slug] = e

    transaction_entries = [e for e in all_entries if e.category == "transaction"]
    matched_patterns: set[str] = set()
    for pattern in config.DEMO_TRANSACTION_SLUG_PATTERNS:
        p = pattern.lower()
        for e in transaction_entries:
            if p in e.slug.lower():
                by_slug[e.slug] = e
                matched_patterns.add(pattern)

    missing = [p for p in config.DEMO_TRANSACTION_SLUG_PATTERNS if p not in matched_patterns]
    if missing:
        console.print(f"[yellow]warning: {len(missing)} demo patterns matched no live URL:[/yellow]")
        for p in missing:
            console.print(f"  [yellow]- {p}[/yellow]")

    return sorted(by_slug.values(), key=lambda e: (e.category, e.slug))


def _filter_high_value(all_entries: list[UrlEntry]) -> list[UrlEntry]:
    return [e for e in all_entries if e.category in config.HIGH_VALUE_CATEGORIES]


def _filter_file(all_entries: list[UrlEntry], path: str) -> list[UrlEntry]:
    from pathlib import Path

    wanted = {
        line.strip()
        for line in Path(path).read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    }
    return [e for e in all_entries if e.url in wanted]


def select(scope: str) -> list[UrlEntry]:
    """Apply a scope filter to the live sitemap."""
    console.print(f"Fetching sitemap [cyan]{config.SITEMAP_URL}[/cyan] ...")
    xml = fetch_sitemap()
    all_entries = parse_sitemap(xml)
    console.print(f"  parsed [bold]{len(all_entries)}[/bold] URLs from sitemap")

    if scope == "demo":
        chosen = _filter_demo(all_entries)
    elif scope == "high_value":
        chosen = _filter_high_value(all_entries)
    elif scope == "all":
        chosen = all_entries
    elif scope.startswith("file:"):
        chosen = _filter_file(all_entries, scope[len("file:"):])
    else:
        raise ValueError(f"unknown scope: {scope!r}")

    _summarise(chosen)
    return chosen


def _summarise(entries: Iterable[UrlEntry]) -> None:
    counts: dict[str, int] = {}
    for e in entries:
        counts[e.category] = counts.get(e.category, 0) + 1
    console.print(f"  selected [bold]{sum(counts.values())}[/bold] URLs:")
    for cat, n in sorted(counts.items(), key=lambda x: (-x[1], x[0])):
        console.print(f"    [green]{cat:<20}[/green] {n}")


def run(scope: str) -> int:
    entries = select(scope)
    n = write_jsonl(config.URLS_FILE, (e.to_dict() for e in entries))
    console.print(f"Wrote [bold]{n}[/bold] entries to [cyan]{config.URLS_FILE}[/cyan]")
    return n
