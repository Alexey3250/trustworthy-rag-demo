"""Stage 5: assemble the human + AI-friendly corpus.

For every parsed doc we look up the matching enrichment (if any) and
write a single self-contained JSON file at:

    corpus/<category>/<slug>.json

We also write a flat ``corpus/index.json`` containing the headline fields
that a retriever (BM25, embeddings, MCP tool, whatever) needs to find the
right document in response to a citizen question.
"""
from __future__ import annotations

from typing import Any

from rich.console import Console

from . import config
from .util import read_json, read_jsonl, utc_now_iso, write_json

console = Console()


def _build_doc(parsed: dict[str, Any], enriched: dict[str, Any] | None) -> dict[str, Any]:
    bucketed = parsed.get("bucketed") or {}
    enrichment = (enriched or {}).get("enrichment") if enriched else None

    doc: dict[str, Any] = {
        "url": parsed.get("final_url") or parsed.get("url"),
        "source_url": parsed.get("url"),
        "category": parsed.get("category"),
        "article_kind": parsed.get("article_class"),
        "slug": parsed.get("slug"),
        "title": parsed.get("title"),
        "summary": (enrichment or {}).get("summary"),
        "topics": (enrichment or {}).get("topics") or [],
        "intro": bucketed.get("intro"),
        "who_can_apply": (
            (enrichment or {}).get("normalised_eligibility")
            or bucketed.get("who_can_apply")
            or []
        ),
        "what_you_need": (
            (enrichment or {}).get("normalised_what_you_need")
            or bucketed.get("what_you_need")
            or []
        ),
        "how_to_steps": bucketed.get("how_to_steps") or [],
        "fees": bucketed.get("fees"),
        "processing_time": bucketed.get("processing_time"),
        "contact": bucketed.get("contact"),
        "more_info": bucketed.get("more_info") or [],
        "external_links": [
            {"text": l["text"], "url": l["url"]}
            for l in (parsed.get("all_links") or [])
            if l.get("external")
        ],
        "internal_links": [
            {"text": l["text"], "url": l["url"]}
            for l in (parsed.get("all_links") or [])
            if not l.get("external")
        ],
        "faqs": (enrichment or {}).get("faqs") or [],
        "source": {
            "fetched_at": parsed.get("fetched_at"),
            "last_modified": parsed.get("last_updated"),
            "html_sha1": parsed.get("sha1"),
            "enriched": bool(enrichment),
            "enrichment_status": (enriched or {}).get("status") if enriched else "missing",
        },
    }
    return doc


def _index_entry(doc: dict[str, Any], rel_path: str) -> dict[str, Any]:
    return {
        "url": doc["url"],
        "category": doc["category"],
        "article_kind": doc["article_kind"],
        "slug": doc["slug"],
        "title": doc["title"],
        "summary": doc["summary"],
        "topics": doc["topics"],
        "path": rel_path,
        "last_modified": doc["source"]["last_modified"],
    }


def run() -> dict[str, int]:
    counts = {"emitted": 0, "skipped": 0, "no_enrichment": 0}
    entries = read_jsonl(config.URLS_FILE)
    if not entries:
        console.print(f"[red]No URLs in {config.URLS_FILE}.[/red] Run `discover` first.")
        return counts

    index: list[dict[str, Any]] = []

    for e in entries:
        sha1 = e["sha1"]
        parsed_path = config.PARSED_DIR / f"{sha1}.json"
        if not parsed_path.exists():
            counts["skipped"] += 1
            continue
        parsed = read_json(parsed_path)

        enriched_path = config.ENRICHED_DIR / f"{sha1}.json"
        enriched = read_json(enriched_path) if enriched_path.exists() else None
        if enriched is None or enriched.get("status") != "ok":
            counts["no_enrichment"] += 1

        doc = _build_doc(parsed, enriched)

        category = doc["category"] or "other"
        slug = doc["slug"] or sha1
        out_path = config.CORPUS_DIR / category / f"{slug}.json"
        write_json(out_path, doc)

        rel_path = f"{category}/{slug}.json"
        index.append(_index_entry(doc, rel_path))
        counts["emitted"] += 1

    index.sort(key=lambda r: (r["category"] or "", r["slug"] or ""))
    write_json(
        config.CORPUS_DIR / "index.json",
        {
            "generated_at": utc_now_iso(),
            "host": config.HOST,
            "doc_count": len(index),
            "docs": index,
        },
    )

    console.print(
        f"  emitted={counts['emitted']}  skipped={counts['skipped']}  "
        f"no_enrichment={counts['no_enrichment']}"
    )
    console.print(f"  index: [cyan]{config.CORPUS_DIR / 'index.json'}[/cyan]")
    return counts
