"""Stage 3: deterministic HTML → preliminary structured JSON.

The site is Drupal-rendered with a remarkably consistent skeleton:

    <main>
      <h1 id="page-title">...</h1>
      <article class="page-wrapper transaction|guide|service|...">
        <section class="page-section">
          <h2>Introduction</h2>           <-- section break
          <p>...</p>
          <h2>Eligibility</h2>            <-- section break
          <ul><li>...</li></ul>
          <h2>What you need</h2>          <-- section break
          ...
          <h2>How to ...</h2>             <-- section break
          ...
        </section>
        <div class="last-updated">Last published: 26 February 2026</div>
      </article>
    </main>

We walk the direct children of ``section.page-section`` in document order
and split at each ``<h2>`` heading. Section names are normalised against a
small set of well-known buckets; anything we don't recognise is kept under
``other_sections`` so the LLM and downstream emitters can still see it.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlsplit

from rich.console import Console
from selectolax.parser import HTMLParser, Node

from . import config
from .util import category_of, read_json, read_jsonl, slug_of, squash_ws, write_json

console = Console()

# Heading text → canonical bucket name. Compared lowercased and stripped.
_SECTION_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^introduction$"), "intro"),
    (re.compile(r"^(eligibility|who can apply|am i eligible)"), "who_can_apply"),
    (re.compile(r"^what you('?ll)? need"), "what_you_need"),
    (re.compile(r"^how to"), "how_to_steps"),
    (re.compile(r"^(payment( and fees)?|fees|cost(s)?)$"), "fees"),
    (re.compile(r"^(processing time|how long)"), "processing_time"),
    (re.compile(r"^(contact( us)?|need help|get in touch)"), "contact"),
    (re.compile(r"^(more information|additional information|related|see also|first steps)"), "more_info"),
]


def _normalise_heading(heading: str) -> str:
    h = heading.strip().lower()
    for rx, name in _SECTION_PATTERNS:
        if rx.search(h):
            return name
    return "other"


# --- DOM helpers --------------------------------------------------------

def _text(node: Node | None) -> str:
    if node is None:
        return ""
    return squash_ws(node.text(deep=True))


def _is_heading(node: Node) -> bool:
    return node.tag in ("h2", "h3", "h4", "h5")


def _heading_level(node: Node) -> int:
    return int(node.tag[1])


def _children(node: Node):
    """Direct element children of a node (skips text/whitespace nodes)."""
    for c in node.iter(include_text=False):
        yield c


def _list_items(list_node: Node) -> list[dict[str, Any]]:
    """Each top-level <li> as {"text": ..., "links": [{text,url}], "sub": [...]}.

    selectolax does not support relative CSS like ``> li``, so we iterate
    direct children manually.
    """
    out: list[dict[str, Any]] = []
    for li in _children(list_node):
        if li.tag != "li":
            continue
        text = squash_ws(li.text(deep=True))
        links = _links_in(li)
        sub: list[dict[str, Any]] = []
        for inner in _children(li):
            if inner.tag in ("ul", "ol"):
                sub.extend(_list_items(inner))
                inner_text = squash_ws(inner.text(deep=True))
                if inner_text and inner_text in text:
                    text = squash_ws(text.replace(inner_text, "")).strip()
        out.append({"text": text, "links": links, "sub": sub})
    return out


def _links_in(node: Node) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for a in node.css("a[href]"):
        href = (a.attributes.get("href") or "").strip()
        if not href or href.startswith(("#", "mailto:", "javascript:")):
            continue
        text = squash_ws(a.text(deep=True))
        key = (text, href)
        if key in seen:
            continue
        seen.add(key)
        out.append({"text": text, "href": href})
    return out


# --- Section walker -----------------------------------------------------

@dataclass
class Section:
    heading: str
    bucket: str
    level: int
    paragraphs: list[str] = field(default_factory=list)
    lists: list[list[dict[str, Any]]] = field(default_factory=list)
    subsections: list["Section"] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "heading": self.heading,
            "bucket": self.bucket,
            "level": self.level,
            "paragraphs": self.paragraphs,
            "lists": self.lists,
            "subsections": [s.to_dict() for s in self.subsections],
        }


def _walk_sections(container: Node) -> list[Section]:
    """Split a container's direct children into sections by h2/h3/h4."""
    flat: list[Section] = []
    current = Section(heading="_preamble", bucket="intro", level=2)
    for child in _children(container):
        if _is_heading(child):
            if current.paragraphs or current.lists or current.heading != "_preamble":
                flat.append(current)
            heading_text = squash_ws(child.text(deep=True))
            current = Section(
                heading=heading_text,
                bucket=_normalise_heading(heading_text),
                level=_heading_level(child),
            )
            continue
        if child.tag == "p":
            t = squash_ws(child.text(deep=True))
            if t:
                current.paragraphs.append(t)
        elif child.tag in ("ul", "ol"):
            items = _list_items(child)
            if items:
                current.lists.append(items)
        elif child.tag == "div":
            for inner in _children(child):
                if inner.tag == "p":
                    t = squash_ws(inner.text(deep=True))
                    if t:
                        current.paragraphs.append(t)
                elif inner.tag in ("ul", "ol"):
                    items = _list_items(inner)
                    if items:
                        current.lists.append(items)
    if current.paragraphs or current.lists:
        flat.append(current)

    # Nest h3/h4 under the most recent h2.
    nested: list[Section] = []
    for s in flat:
        if s.level == 2 or not nested:
            nested.append(s)
        else:
            nested[-1].subsections.append(s)
    return nested


# --- Top-level extraction -----------------------------------------------

@dataclass
class ParsedDoc:
    url: str
    final_url: str
    sha1: str
    category: str
    slug: str
    article_class: str | None
    title: str | None
    intro: str | None
    sections: list[Section]
    bucketed: dict[str, Any]
    all_links: list[dict[str, str]]
    last_updated: str | None
    fetched_at: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "final_url": self.final_url,
            "sha1": self.sha1,
            "category": self.category,
            "slug": self.slug,
            "article_class": self.article_class,
            "title": self.title,
            "intro": self.intro,
            "bucketed": self.bucketed,
            "sections": [s.to_dict() for s in self.sections],
            "all_links": self.all_links,
            "last_updated": self.last_updated,
            "fetched_at": self.fetched_at,
        }


_LAST_UPDATED_RE = re.compile(
    r"(?:Last\s+(?:published|updated|reviewed))\s*:\s*(.+)", re.IGNORECASE
)


def _extract_last_updated(tree: HTMLParser) -> str | None:
    node = tree.css_first("div.last-updated, .last-updated")
    if not node:
        return None
    text = squash_ws(node.text(deep=True))
    m = _LAST_UPDATED_RE.search(text)
    return (m.group(1) if m else text).strip() or None


def _bucket_sections(
    sections: list[Section], base_url: str
) -> tuple[dict[str, Any], str | None]:
    """Reduce the section tree to the high-value fields the chatbot wants."""
    out: dict[str, Any] = {
        "intro": None,
        "who_can_apply": [],
        "what_you_need": [],
        "how_to_steps": [],
        "fees": None,
        "processing_time": None,
        "contact": None,
        "more_info": [],
        "other": [],
    }
    intro_paragraphs: list[str] = []

    for s in sections:
        # Pull h3/h4 paragraphs into the parent prose so we don't lose them.
        all_paragraphs = list(s.paragraphs)
        all_lists = list(s.lists)
        for sub in s.subsections:
            sub_lines: list[str] = []
            if sub.heading and sub.heading != "_preamble":
                sub_lines.append(f"### {sub.heading}")
            sub_lines.extend(sub.paragraphs)
            all_paragraphs.extend(sub_lines)
            all_lists.extend(sub.lists)

        if s.bucket == "intro":
            intro_paragraphs.extend(all_paragraphs)
        elif s.bucket == "who_can_apply":
            for lst in all_lists:
                for item in lst:
                    out["who_can_apply"].append(item["text"])
            for p in all_paragraphs:
                out["who_can_apply"].append(p)
        elif s.bucket == "what_you_need":
            for lst in all_lists:
                for item in lst:
                    out["what_you_need"].append(item["text"])
            for p in all_paragraphs:
                out["what_you_need"].append(p)
        elif s.bucket == "how_to_steps":
            n = 0
            for lst in all_lists:
                for item in lst:
                    n += 1
                    link = item["links"][0]["href"] if item["links"] else None
                    if link:
                        link = urljoin(base_url, link)
                    out["how_to_steps"].append({"n": n, "text": item["text"], "link": link})
            if not out["how_to_steps"]:
                for p in all_paragraphs:
                    n += 1
                    out["how_to_steps"].append({"n": n, "text": p, "link": None})
        elif s.bucket == "fees":
            out["fees"] = "\n\n".join(all_paragraphs) or None
        elif s.bucket == "processing_time":
            out["processing_time"] = "\n\n".join(all_paragraphs) or None
        elif s.bucket == "contact":
            out["contact"] = "\n\n".join(all_paragraphs) or None
        elif s.bucket == "more_info":
            for lst in all_lists:
                for item in lst:
                    out["more_info"].append(
                        {
                            "text": item["text"],
                            "link": urljoin(base_url, item["links"][0]["href"])
                            if item["links"]
                            else None,
                        }
                    )
            for p in all_paragraphs:
                out["more_info"].append({"text": p, "link": None})
        else:
            out["other"].append(
                {
                    "heading": s.heading,
                    "paragraphs": all_paragraphs,
                    "items": [i["text"] for lst in all_lists for i in lst],
                }
            )

    intro = "\n\n".join(intro_paragraphs).strip() or None
    return out, intro


def _absolute_links(links: list[dict[str, str]], base_url: str) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for ln in links:
        href = ln["href"]
        if href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        absolute = urljoin(base_url, href)
        host = urlsplit(absolute).netloc
        if not host:
            continue
        if absolute in seen:
            continue
        seen.add(absolute)
        out.append(
            {
                "text": ln["text"],
                "url": absolute,
                "external": host not in {"www.service.nsw.gov.au", "service.nsw.gov.au"},
            }
        )
    return out


def parse_html(*, html: str, url: str, final_url: str, sha1: str, fetched_at: str | None) -> ParsedDoc | None:
    tree = HTMLParser(html)
    article = tree.css_first("article.page-wrapper")
    if not article:
        return None

    article_class = (article.attributes.get("class") or "").strip()
    article_kind = None
    for token in article_class.split():
        if token != "page-wrapper":
            article_kind = token
            break

    title_node = tree.css_first("h1#page-title") or tree.css_first("header.page-header h1")
    title = squash_ws(title_node.text(deep=True)) if title_node else None

    section_nodes = article.css("section.page-section")
    sections: list[Section] = []
    for s in section_nodes:
        sections.extend(_walk_sections(s))

    bucketed, intro = _bucket_sections(sections, base_url=final_url or url)
    bucketed["intro"] = intro

    raw_links = _links_in(article)
    all_links = _absolute_links(raw_links, base_url=final_url or url)

    return ParsedDoc(
        url=url,
        final_url=final_url,
        sha1=sha1,
        category=category_of(url),
        slug=slug_of(url),
        article_class=article_kind,
        title=title,
        intro=intro,
        sections=sections,
        bucketed=bucketed,
        all_links=all_links,
        last_updated=_extract_last_updated(tree),
        fetched_at=fetched_at,
    )


def parse_one(meta: dict[str, Any]) -> ParsedDoc | None:
    raw_path = config.RAW_DIR / f"{meta['sha1']}.html"
    if not raw_path.exists():
        return None
    if meta.get("status") != "ok":
        return None
    html = raw_path.read_text(encoding="utf-8")
    return parse_html(
        html=html,
        url=meta["url"],
        final_url=meta.get("final_url") or meta["url"],
        sha1=meta["sha1"],
        fetched_at=meta.get("fetched_at"),
    )


def run(*, limit: int | None = None) -> dict[str, int]:
    counts = {"parsed": 0, "skipped": 0, "no_article": 0}
    entries = read_jsonl(config.URLS_FILE)
    if limit:
        entries = entries[:limit]
    if not entries:
        console.print(f"[red]No URLs in {config.URLS_FILE}.[/red] Run `discover` first.")
        return counts

    for entry in entries:
        meta_path = config.META_DIR / f"{entry['sha1']}.json"
        if not meta_path.exists():
            counts["skipped"] += 1
            continue
        meta = read_json(meta_path)
        doc = parse_one(meta)
        if doc is None:
            counts["no_article"] += 1
            continue
        out_path = config.PARSED_DIR / f"{entry['sha1']}.json"
        write_json(out_path, doc.to_dict())
        counts["parsed"] += 1

    console.print(
        f"  parsed={counts['parsed']}  skipped={counts['skipped']}  no_article={counts['no_article']}"
    )
    return counts
