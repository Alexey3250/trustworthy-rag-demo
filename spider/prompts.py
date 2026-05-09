"""Prompts for the Ollama enrichment stage.

We ask the local model for the things rules can't reliably do:

- a one-sentence chatbot-ready summary,
- 3-6 short topic tags,
- 3-6 canonical Q&A pairs an actual citizen would ask,
- normalised eligibility / what-you-need bullets if the page had them.

Crucially, the model is *not* allowed to invent fees, links, or steps.
Only information that appears in the supplied content may be used.
"""
from __future__ import annotations

import json
from typing import Any

SYSTEM = """You are a careful information-extraction assistant for the
Service NSW website. Your job is to convert a parsed government service
page into a structured JSON object so that a chatbot can give citizens
trustworthy, source-faithful answers.

Hard rules:
1. Only use information that is in the provided page content. Do NOT
   invent steps, fees, eligibility criteria, or links.
2. If a field cannot be filled from the content, return an empty list,
   empty string, or null as appropriate. Never make something up.
3. Output ONLY valid JSON that matches the requested schema. No prose,
   no markdown, no commentary, no code fences.
4. Keep wording plain, neutral, and citizen-friendly. Short sentences.
5. URLs in your output must come from the provided "links" list. Never
   fabricate a URL.
"""


SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": [
        "summary",
        "topics",
        "faqs",
        "normalised_eligibility",
        "normalised_what_you_need",
    ],
    "properties": {
        "summary": {
            "type": "string",
            "description": "One plain-English sentence describing what this page lets the citizen do.",
        },
        "topics": {
            "type": "array",
            "items": {"type": "string"},
            "description": "3 to 6 short lowercase topic tags, hyphenated, e.g. 'driver-licence'.",
        },
        "faqs": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["q", "a"],
                "properties": {
                    "q": {"type": "string"},
                    "a": {"type": "string"},
                    "link": {"type": ["string", "null"]},
                },
            },
            "description": "3 to 6 question/answer pairs a citizen would actually ask.",
        },
        "normalised_eligibility": {
            "type": "array",
            "items": {"type": "string"},
        },
        "normalised_what_you_need": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
}


def _truncate(text: str | None, n: int) -> str:
    if not text:
        return ""
    return text if len(text) <= n else text[: n - 1] + "\u2026"


def build_user_prompt(parsed: dict[str, Any]) -> str:
    """Render the parser's structured output back into a focused brief."""
    bucketed = parsed.get("bucketed") or {}
    title = parsed.get("title") or ""
    url = parsed.get("final_url") or parsed.get("url") or ""
    intro = bucketed.get("intro") or parsed.get("intro") or ""

    who_can_apply = bucketed.get("who_can_apply") or []
    what_you_need = bucketed.get("what_you_need") or []
    steps = bucketed.get("how_to_steps") or []
    fees = bucketed.get("fees") or ""
    processing = bucketed.get("processing_time") or ""
    contact = bucketed.get("contact") or ""

    other = bucketed.get("other") or []

    links = [
        {"text": l["text"], "url": l["url"]}
        for l in (parsed.get("all_links") or [])
        if l.get("text") and l.get("url")
    ][:40]

    parts: list[str] = []
    parts.append(f"URL: {url}")
    parts.append(f"Title: {title}")
    parts.append("")
    if intro:
        parts.append("Introduction:")
        parts.append(_truncate(intro, 1500))
        parts.append("")
    if who_can_apply:
        parts.append("Eligibility / who can apply:")
        for item in who_can_apply[:30]:
            parts.append(f"- {_truncate(item, 400)}")
        parts.append("")
    if what_you_need:
        parts.append("What you need:")
        for item in what_you_need[:30]:
            parts.append(f"- {_truncate(item, 400)}")
        parts.append("")
    if steps:
        parts.append("How-to steps:")
        for s in steps[:20]:
            link = f"  ({s['link']})" if s.get("link") else ""
            parts.append(f"{s['n']}. {_truncate(s['text'], 400)}{link}")
        parts.append("")
    if fees:
        parts.append("Payment / fees:")
        parts.append(_truncate(fees, 800))
        parts.append("")
    if processing:
        parts.append("Processing time:")
        parts.append(_truncate(processing, 400))
        parts.append("")
    if contact:
        parts.append("Contact:")
        parts.append(_truncate(contact, 400))
        parts.append("")
    if other:
        parts.append("Other sections (heading + key points):")
        for o in other[:8]:
            parts.append(f"- {o['heading']}")
            for it in (o.get("items") or [])[:8]:
                parts.append(f"    * {_truncate(it, 300)}")
        parts.append("")
    if links:
        parts.append("Links found on the page (use these verbatim if you cite a URL):")
        for ln in links:
            parts.append(f"- {_truncate(ln['text'], 120)} -> {ln['url']}")
        parts.append("")

    parts.append("Now produce the JSON object exactly matching this schema:")
    parts.append(json.dumps(SCHEMA, indent=2))

    return "\n".join(parts)
