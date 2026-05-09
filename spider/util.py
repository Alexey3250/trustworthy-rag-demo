"""Tiny helpers shared across stages."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlsplit


def url_sha1(url: str) -> str:
    """Stable disk key for a URL. Trims trailing slash, lowercases scheme/host."""
    parts = urlsplit(url)
    norm = f"{parts.scheme.lower()}://{parts.netloc.lower()}{parts.path.rstrip('/') or '/'}"
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()


def url_path_segments(url: str) -> list[str]:
    return [s for s in urlsplit(url).path.split("/") if s]


def category_of(url: str) -> str:
    """First path segment, e.g. 'transaction', 'guide'. 'home' for '/'."""
    segs = url_path_segments(url)
    return segs[0] if segs else "home"


def slug_of(url: str) -> str:
    """Last meaningful path segment; for '/' returns 'home'."""
    segs = url_path_segments(url)
    return segs[-1] if segs else "home"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            n += 1
    return n


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


_WS_RE = re.compile(r"\s+")


def squash_ws(s: str) -> str:
    """Collapse runs of whitespace (including newlines) into single spaces."""
    return _WS_RE.sub(" ", s).strip()
