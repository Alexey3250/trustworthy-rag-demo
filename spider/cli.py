"""Command-line entry point.

    python -m spider.cli discover --scope demo
    python -m spider.cli fetch    --workers 4
    python -m spider.cli parse
    python -m spider.cli enrich   --workers 2
    python -m spider.cli emit
    python -m spider.cli all      --scope demo
"""
from __future__ import annotations

import argparse
import sys

from rich.console import Console

from . import config, discover, emit, enrich, evaluate, fetch, parse, status

console = Console()


def _add_scope(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--scope",
        default="demo",
        help="demo | high_value | all | file:<path-to-urls.txt> (default: demo)",
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="spider", description="service.nsw.gov.au corpus spider")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_disc = sub.add_parser("discover", help="read sitemap.xml and write data/urls.jsonl")
    _add_scope(p_disc)

    p_fetch = sub.add_parser("fetch", help="download HTML to cache/raw/")
    p_fetch.add_argument("--workers", type=int, default=config.DEFAULT_FETCH_WORKERS)
    p_fetch.add_argument("--limit", type=int, default=None)
    p_fetch.add_argument("--force", action="store_true", help="re-fetch already cached pages")

    p_parse = sub.add_parser("parse", help="extract structure to data/parsed/")
    p_parse.add_argument("--limit", type=int, default=None)

    p_enrich = sub.add_parser("enrich", help="Ollama-augment to data/enriched/")
    p_enrich.add_argument("--workers", type=int, default=config.DEFAULT_ENRICH_WORKERS)
    p_enrich.add_argument("--limit", type=int, default=None,
                          help="only consider the first N URLs from the frontier")
    p_enrich.add_argument("--force", action="store_true", help="re-enrich already enriched docs")
    p_enrich.add_argument("--max-docs", type=int, default=None,
                          help="stop after enriching this many NEW docs (cached not counted)")
    p_enrich.add_argument("--max-time-min", type=float, default=None,
                          help="stop after N wall-clock minutes (graceful)")
    p_enrich.add_argument("--quiet", action="store_true",
                          help="suppress per-doc start/end console lines (heartbeat log still writes)")

    p_emit = sub.add_parser("emit", help="write corpus/")
    sub.add_parser("status", help="show pipeline progress at every stage")
    sub.add_parser("evaluate", help="quality report over the emitted corpus")

    p_all = sub.add_parser("all", help="discover -> fetch -> parse -> enrich -> emit")
    _add_scope(p_all)
    p_all.add_argument("--fetch-workers", type=int, default=config.DEFAULT_FETCH_WORKERS)
    p_all.add_argument("--enrich-workers", type=int, default=config.DEFAULT_ENRICH_WORKERS)
    p_all.add_argument("--limit", type=int, default=None)
    p_all.add_argument("--skip-enrich", action="store_true",
                       help="run discover/fetch/parse/emit only (rules-only corpus)")

    args = ap.parse_args(argv)

    if args.cmd == "discover":
        discover.run(scope=args.scope)
    elif args.cmd == "fetch":
        fetch.run(workers=args.workers, force=args.force, limit=args.limit)
    elif args.cmd == "parse":
        parse.run(limit=args.limit)
    elif args.cmd == "enrich":
        enrich.run(
            workers=args.workers,
            force=args.force,
            limit=args.limit,
            max_docs=args.max_docs,
            max_time_min=args.max_time_min,
            quiet=args.quiet,
        )
    elif args.cmd == "emit":
        emit.run()
    elif args.cmd == "status":
        status.run()
    elif args.cmd == "evaluate":
        evaluate.run()
    elif args.cmd == "all":
        console.rule("[bold]discover")
        discover.run(scope=args.scope)
        console.rule("[bold]fetch")
        fetch.run(workers=args.fetch_workers, limit=args.limit)
        console.rule("[bold]parse")
        parse.run(limit=args.limit)
        if not args.skip_enrich:
            console.rule("[bold]enrich")
            enrich.run(workers=args.enrich_workers, limit=args.limit)
        else:
            console.print("[yellow]skipping enrich (rules-only corpus)[/yellow]")
        console.rule("[bold]emit")
        emit.run()

    return 0


if __name__ == "__main__":
    sys.exit(main())
