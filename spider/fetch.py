"""Stage 2: politely download HTML and cache it on disk.

Each URL is keyed by SHA-1 of its normalised form. We store the raw HTML
under ``cache/raw/<sha1>.html`` and a small metadata sidecar under
``cache/meta/<sha1>.json`` so later stages can find their inputs.

Re-runs are essentially free: anything already cached is skipped unless
``--force`` is passed.
"""
from __future__ import annotations

import asyncio
import random
import re
from typing import Iterable
from urllib.parse import urljoin

import httpx
from rich.console import Console
from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    TextColumn,
    TimeElapsedColumn,
)
from tenacity import (
    AsyncRetrying,
    RetryError,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

from . import config
from .util import read_jsonl, utc_now_iso, write_json

console = Console()

_META_REFRESH_RE = re.compile(
    r'<meta[^>]+http-equiv=["\']?refresh["\']?[^>]+content=["\']?\s*\d+\s*;\s*url=([^"\'>\s]+)',
    re.IGNORECASE,
)


def _meta_refresh_target(html: str, base_url: str) -> str | None:
    """Return the absolute URL that the page is asking us to follow, or
    None if there's no meta refresh."""
    head_only = html[:4096]
    m = _META_REFRESH_RE.search(head_only)
    if not m:
        return None
    target = m.group(1).strip().strip("'\"")
    if not target:
        return None
    return urljoin(base_url, target)


async def _fetch_one(
    client: httpx.AsyncClient,
    url: str,
    sha1: str,
    *,
    force: bool,
) -> tuple[str, str]:
    """Fetch a single URL and write to cache. Returns (status, final_url).

    status ∈ {"cached", "fetched", "skipped", "error"}.
    """
    raw_path = config.RAW_DIR / f"{sha1}.html"
    meta_path = config.META_DIR / f"{sha1}.json"

    if not force and raw_path.exists() and meta_path.exists():
        return ("cached", url)

    final_url = url
    try:
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(config.FETCH_RETRIES),
            wait=wait_exponential_jitter(initial=1, max=10),
            retry=retry_if_exception_type(
                (httpx.HTTPError, httpx.RemoteProtocolError, httpx.ReadError)
            ),
            reraise=True,
        ):
            with attempt:
                r = await client.get(url, follow_redirects=True)
                r.raise_for_status()
                html = r.text
                final_url = str(r.url)

                # Drupal sometimes serves a meta-refresh shim instead of a 301.
                target = _meta_refresh_target(html, base_url=final_url)
                if target and target != final_url:
                    r2 = await client.get(target, follow_redirects=True)
                    r2.raise_for_status()
                    html = r2.text
                    final_url = str(r2.url)
    except (RetryError, httpx.HTTPError) as exc:
        write_json(
            meta_path,
            {
                "url": url,
                "final_url": final_url,
                "sha1": sha1,
                "status": "error",
                "error": repr(exc),
                "fetched_at": utc_now_iso(),
            },
        )
        return ("error", final_url)

    raw_path.write_text(html, encoding="utf-8")
    write_json(
        meta_path,
        {
            "url": url,
            "final_url": final_url,
            "sha1": sha1,
            "status": "ok",
            "content_length": len(html),
            "fetched_at": utc_now_iso(),
        },
    )
    return ("fetched", final_url)


async def _runner(
    entries: list[dict],
    *,
    workers: int,
    delay: float,
    force: bool,
) -> dict[str, int]:
    sem = asyncio.Semaphore(workers)
    counts = {"cached": 0, "fetched": 0, "error": 0}
    headers = {
        "User-Agent": config.USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
    }

    progress = Progress(
        TextColumn("[bold blue]{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        TextColumn("•"),
        TimeElapsedColumn(),
        console=console,
    )

    async with httpx.AsyncClient(
        timeout=config.FETCH_TIMEOUT_S,
        headers=headers,
        http2=True,
        follow_redirects=True,
        limits=httpx.Limits(max_keepalive_connections=workers, max_connections=workers * 2),
    ) as client:
        async def worker(entry: dict, task_id) -> None:
            async with sem:
                # Jittered delay to be polite per request.
                await asyncio.sleep(delay + random.uniform(0, delay))
                status, _final = await _fetch_one(
                    client, entry["url"], entry["sha1"], force=force
                )
                counts[status] = counts.get(status, 0) + 1
                progress.update(task_id, advance=1)

        with progress:
            task_id = progress.add_task("fetching", total=len(entries))
            await asyncio.gather(*(worker(e, task_id) for e in entries))

    return counts


def run(*, workers: int = config.DEFAULT_FETCH_WORKERS, force: bool = False, limit: int | None = None) -> dict[str, int]:
    entries = read_jsonl(config.URLS_FILE)
    if not entries:
        console.print(
            f"[red]No URLs in {config.URLS_FILE}.[/red] Run `discover` first."
        )
        return {"cached": 0, "fetched": 0, "error": 0}
    if limit:
        entries = entries[:limit]
    console.print(f"Fetching [bold]{len(entries)}[/bold] URLs with [bold]{workers}[/bold] workers ...")
    counts = asyncio.run(_runner(entries, workers=workers, delay=config.FETCH_DELAY_S, force=force))
    console.print(
        f"  cached={counts['cached']}  fetched={counts['fetched']}  error={counts['error']}"
    )
    return counts
