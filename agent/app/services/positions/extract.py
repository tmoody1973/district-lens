"""Gemini extraction of per-issue stances from archived page text.

This is the production body behind ``research._default_structure_fn``: it loads
each scraped page's markdown from ``source_documents`` and asks
``gemini-3.1-pro-preview`` (location ``global``, project mandate) to extract only
the stances the page text actually supports — the no-inference guardrail. It is
network-bound and graceful; the unit tests inject a fake in its place.

The scraped page text is untrusted data: it is quoted into the prompt as
material to analyze, never executed as instructions.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

from app.services.evidence.schema import COLLECTION_NAME as SOURCE_DOCS
from app.services.positions.schema import QUESTIONNAIRE_DOMAINS

logger = logging.getLogger(__name__)

_GEMINI_MODEL = "gemini-3.1-pro-preview"
_DEFAULT_LOCATION = "global"
_MAX_PAGE_CHARS = 12_000

_EXTRACT_SYSTEM = (
    "You are a nonpartisan civic data extractor. You are given the archived text "
    "of a congressional candidate's source pages. Extract the candidate's policy "
    "stances GROUNDED ONLY in the provided page text. "
    "Be exhaustive: extract EVERY distinct issue the text actually addresses — a "
    "candidate's issues page commonly covers many topics (economy and jobs, taxes, "
    "health care, Social Security and Medicare, immigration, education, "
    "reproductive rights, climate and energy, guns, veterans, foreign policy, and "
    "more). Do NOT stop after the first one or two; emit a separate entry for each "
    "issue the page supports. "
    "For each stance, write one concise factual statement and name the issue. "
    "Use only what the text states; NEVER infer a position from party, donors, or "
    "omission — a stance the text does not support must be omitted, not guessed. "
    "If the text supports no stance at all, return an empty positions list. "
    "Return ONLY valid JSON matching the requested schema."
)

_EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {
        "positions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "issue": {"type": "string"},
                    "statement": {"type": "string"},
                    "source_index": {"type": "integer"},
                },
                "required": ["issue", "statement", "source_index"],
            },
        }
    },
    "required": ["positions"],
}


def _evidence_type_for(url: str) -> str:
    """Classify ``evidenceType`` by source provenance (never a guess)."""
    host = url.lower()
    if any(domain in host for domain in QUESTIONNAIRE_DOMAINS):
        return "questionnaire"
    return "direct_quote"


def _coerce_object_id(doc_id: Any) -> Any:
    """Best-effort: turn a stored id string back into an ObjectId for lookup."""
    try:
        from bson import ObjectId

        return ObjectId(doc_id)
    except Exception:
        return doc_id


def _load_markdown(db: Any, source_document_id: Any) -> str:
    doc = db[SOURCE_DOCS].find_one({"_id": _coerce_object_id(source_document_id)})
    if not doc:
        return ""
    return (doc.get("markdown") or "")[:_MAX_PAGE_CHARS]


def _build_prompt(candidate_name: str, pages: list[dict]) -> str:
    blocks = [
        f"[{i}] {page['url']}\n{page['markdown']}"
        for i, page in enumerate(pages)
        if page["markdown"]
    ]
    return (
        f"Candidate: {candidate_name}\n\n"
        "Archived source pages (0-based index):\n\n" + "\n\n---\n\n".join(blocks)
    )


def _extract_with_gemini(prompt: str) -> str:
    """Blocking Gemini call. Pinned to gemini-3.1-pro-preview / global."""
    import google.genai as genai
    from google.genai import types

    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project:
        raise ValueError("GOOGLE_CLOUD_PROJECT environment variable is not set")
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", _DEFAULT_LOCATION)

    client = genai.Client(vertexai=True, project=project, location=location)
    response = client.models.generate_content(
        model=_GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=_EXTRACT_SYSTEM,
            response_mime_type="application/json",
            response_schema=_EXTRACT_SCHEMA,
        ),
    )
    return response.text or ""


def _to_position(raw: dict, scraped_sources: list[dict]) -> dict | None:
    """Map one Gemini-extracted stance back onto its archived source."""
    index = raw.get("source_index")
    if not isinstance(index, int) or not 0 <= index < len(scraped_sources):
        return None
    source = scraped_sources[index]
    return {
        "issue": raw.get("issue", "key positions"),
        "answer": raw.get("statement", ""),
        "evidenceType": _evidence_type_for(source.get("url", "")),
        "sources": [source],
    }


async def extract_positions_from_pages(
    candidate_name: str, scraped_sources: list[dict], *, db: Any = None
) -> list[dict]:
    """Load each scraped page's text and extract grounded per-issue stances.

    Returns ``[]`` when no stance is supported by the text (no inference). Raises
    are left to the caller's guard (``research._default_structure_fn``).
    """
    if db is None:
        from app.tools.mongodb_tools import _get_db

        db = _get_db()

    markdowns = await asyncio.gather(
        *(
            asyncio.to_thread(_load_markdown, db, source.get("sourceDocumentId"))
            for source in scraped_sources
        )
    )
    pages = [
        {"url": source.get("url", ""), "markdown": markdown}
        for source, markdown in zip(scraped_sources, markdowns, strict=True)
    ]

    if not any(page["markdown"] for page in pages):
        return []

    prompt = _build_prompt(candidate_name, pages)
    raw_json = await asyncio.to_thread(_extract_with_gemini, prompt)
    parsed = json.loads(raw_json) if raw_json else {}
    raw_positions = parsed.get("positions", []) if isinstance(parsed, dict) else []

    return [
        position
        for raw in raw_positions
        if isinstance(raw, dict)
        and (position := _to_position(raw, scraped_sources))
        and position["answer"]
    ]
