"""Perplexity sonar-pro tool for finding candidate position statements.

Two paths share one Perplexity client:
  - search_candidate_positions: single-issue FunctionTool for the LLM chat path.
  - _broad_search + structure_positions + gather_candidate_positions: the
    deterministic Voter Brief path. One broad Perplexity call per candidate
    (parallelized) is structured into per-issue EvidenceCard dicts by a
    second-pass gemini-3.1-pro-preview call (ADR 0001).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time

import httpx
from google.adk.tools import ToolContext

logger = logging.getLogger(__name__)

_ENDPOINT = "https://api.perplexity.ai/chat/completions"
_MODEL = "sonar-pro"
_GEMINI_MODEL = "gemini-3.1-pro-preview"
_DEFAULT_LOCATION = "global"
_MAX_BROAD_SOURCES = 10
_CIVIC_DOMAINS = [
    "congress.gov", "fec.gov", "ballotpedia.org", "opensecrets.org",
    "votesmart.org", "govtrack.us", "house.gov", "senate.gov", "gpo.gov",
    "politifact.com", "factcheck.org", "apnews.com", "reuters.com",
    "npr.org", "pbs.org", "nytimes.com", "washingtonpost.com",
    "wsj.com", "thehill.com", "rollcall.com",
]
_SYSTEM = (
    "You are a nonpartisan civic research assistant. "
    "Report only what verifiable sources say. "
    "Distinguish direct candidate statements from third-party characterizations. "
    "If no direct statement exists in the sources, say so explicitly with the phrase "
    "'NO DIRECT STATEMENT FOUND'. "
    "Never recommend how to vote. Never infer positions from donors or party alone. "
    "Cite every factual claim with inline numeric markers [1], [2], etc."
)

_BROAD_TRIGGERS = {"", "all", "general", "overview", "issues", "everything"}

_STRUCTURE_SYSTEM = (
    "You are a nonpartisan civic data extractor. You are given a research summary "
    "about a congressional candidate's public positions, with numbered sources. "
    "Group the candidate's positions by policy issue. For each issue, write one "
    "concise factual statement of what the candidate has publicly said, and list the "
    "indices of the sources (0-based) that support it. Use only what the summary "
    "states; never infer from party or donors. Return ONLY valid JSON matching the "
    "requested schema."
)

_STRUCTURE_SCHEMA = {
    "type": "object",
    "properties": {
        "positions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "issue": {"type": "string"},
                    "statement": {"type": "string"},
                    "source_indices": {
                        "type": "array",
                        "items": {"type": "integer"},
                    },
                },
                "required": ["issue", "statement", "source_indices"],
            },
        }
    },
    "required": ["positions"],
}


def _is_broad(issue: str) -> bool:
    return issue.strip().lower() in _BROAD_TRIGGERS


def _build_prompt(candidate_name: str, state_code: str, issue: str) -> str:
    """Build the Perplexity user prompt for a broad sweep or a single issue."""
    if _is_broad(issue):
        return (
            f"What are {candidate_name}'s positions and stances on key policy issues? "
            f"{candidate_name} is a congressional candidate from {state_code}. "
            "Cover as many issues as possible using only direct statements from their "
            "campaign website, press releases, floor speeches, voting record, and "
            "verified questionnaires. For each issue where no direct statement exists, "
            "say 'NO DIRECT STATEMENT FOUND' for that issue specifically."
        )
    return (
        f"What has {candidate_name}, congressional candidate from {state_code}, "
        f"publicly said about {issue}? "
        "Prioritize direct statements from: campaign website, press releases, "
        "floor speeches, voting record, debate transcripts, verified questionnaires. "
        "If only third-party characterizations exist, label them as such. "
        "If no direct statement is found, say 'NO DIRECT STATEMENT FOUND' explicitly."
    )


def _normalize_sources(raw_sources: list[dict]) -> list[dict]:
    """Map Perplexity search_results to the frontend source shape."""
    return [
        {
            "title": s.get("title", ""),
            "url": s.get("url", ""),
            "date": s.get("date"),
            "snippet": s.get("snippet", ""),
        }
        for s in raw_sources[:_MAX_BROAD_SOURCES]
    ]


async def _perplexity_search(prompt: str) -> tuple[str, list[dict]]:
    """Run one Perplexity sonar-pro call. Returns (answer, normalized_sources).

    Raises on HTTP/timeout failure so callers can decide how to recover.
    """
    api_key = os.environ.get("PERPLEXITY_API_KEY")
    if not api_key:
        raise ValueError("PERPLEXITY_API_KEY environment variable is not set")

    payload = {
        "model": _MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "max_tokens": 1500,
        "return_related_questions": False,
        "return_images": False,
        "search_domain_filter": _CIVIC_DOMAINS,
        "search_recency_filter": "year",
        "web_search_options": {"search_context_size": "high"},
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            _ENDPOINT,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()

    answer: str = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    raw_sources: list[dict] = data.get("search_results", [])
    return answer, _normalize_sources(raw_sources)


async def _broad_search(candidate_name: str, state_code: str) -> tuple[str, list[dict]]:
    """One broad Perplexity sweep covering all key issues. No state writes."""
    prompt = _build_prompt(candidate_name, state_code, issue="")
    return await _perplexity_search(prompt)


def _structure_with_gemini(candidate_name: str, broad_answer: str, sources: list[dict]) -> str:
    """Second-pass gemini-3.1-pro-preview call. Returns raw JSON text.

    Pinned to gemini-3.1-pro-preview with location="global" (project mandate);
    never a flash or 2.5 model. Isolated so tests can monkeypatch it.
    """
    import google.genai as genai
    from google.genai import types

    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project:
        raise ValueError("GOOGLE_CLOUD_PROJECT environment variable is not set")
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", _DEFAULT_LOCATION)

    numbered_sources = "\n".join(
        f"[{i}] {s.get('title', '')} — {s.get('url', '')}"
        for i, s in enumerate(sources)
    )
    prompt = (
        f"Candidate: {candidate_name}\n\n"
        f"Research summary:\n{broad_answer}\n\n"
        f"Numbered sources (0-based):\n{numbered_sources}"
    )

    client = genai.Client(vertexai=True, project=project, location=location)
    response = client.models.generate_content(
        model=_GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=_STRUCTURE_SYSTEM,
            response_mime_type="application/json",
            response_schema=_STRUCTURE_SCHEMA,
        ),
    )
    return response.text or ""


def _fallback_card(candidate_name: str, broad_answer: str, sources: list[dict]) -> dict:
    """A single EvidenceCard preserving the whole answer when structuring fails."""
    return {
        "candidateName": candidate_name,
        "issue": "key positions",
        "answer": broad_answer,
        "sources": sources,
    }


def _select_sources(sources: list[dict], indices: list) -> list[dict]:
    """Map model-provided source indices back into the source list, skipping bad ones."""
    selected: list[dict] = []
    for index in indices:
        if isinstance(index, int) and 0 <= index < len(sources):
            selected.append(sources[index])
    return selected


async def structure_positions(
    candidate_name: str, broad_answer: str, sources: list[dict]
) -> list[dict]:
    """Structure a broad answer into per-issue EvidenceCard dicts via Gemini.

    On any failure (Gemini error, non-JSON, malformed shape, or no positions),
    falls back to a single "key positions" card so stances still render.
    """
    try:
        raw_json = _structure_with_gemini(candidate_name, broad_answer, sources)
        parsed = json.loads(raw_json)
        positions = parsed.get("positions", [])
    except Exception as exc:  # noqa: BLE001 — any failure must fall back, never abort
        logger.warning("structure_positions fallback for %s: %s", candidate_name, exc)
        return [_fallback_card(candidate_name, broad_answer, sources)]

    cards = [
        {
            "candidateName": candidate_name,
            "issue": position.get("issue", "key positions"),
            "answer": position.get("statement", ""),
            "sources": _select_sources(sources, position.get("source_indices", [])),
        }
        for position in positions
        if isinstance(position, dict)
    ]
    if not cards:
        return [_fallback_card(candidate_name, broad_answer, sources)]
    return cards


async def gather_candidate_positions(
    candidates: list[dict], state_code: str
) -> list[dict]:
    """Run every candidate's broad search + structuring concurrently.

    One candidate failing must not abort the others. Returns the flattened
    list of EvidenceCard dicts across all candidates that succeeded.
    """

    async def one(candidate: dict) -> list[dict]:
        name = candidate["name"]
        answer, sources = await _broad_search(name, state_code)
        return await structure_positions(name, answer, sources)

    results = await asyncio.gather(
        *(one(candidate) for candidate in candidates),
        return_exceptions=True,
    )

    cards: list[dict] = []
    for candidate, result in zip(candidates, results):
        if isinstance(result, Exception):
            logger.warning(
                "gather_candidate_positions skipped %s: %s",
                candidate.get("name", "?"),
                result,
            )
            continue
        cards.extend(result)
    return cards


async def search_candidate_positions(
    candidate_name: str, state: str, issue: str, tool_context: ToolContext
) -> str:
    """Search for a congressional candidate's direct public statements on a policy issue.

    Uses Perplexity sonar-pro with civic domain filtering to find evidence from
    campaign websites, press releases, interviews, and legislative records.

    Args:
        candidate_name: Full name of the candidate (e.g. "Elissa Slotkin")
        state: Two-letter state code or full state name (e.g. "MI" or "Michigan")
        issue: Specific policy topic or "key policy positions" for a broad overview

    Returns:
        Formatted string prefixed with DIRECT STATEMENT FOUND or NO DIRECT STATEMENT FOUND,
        including source count, latency, and cited URLs.
    """
    tool_context.state["status_message"] = (
        f"Searching {candidate_name}'s {issue} position via Perplexity…"
    )

    prompt = _build_prompt(candidate_name, state, issue)

    t0 = time.monotonic()
    try:
        answer, sources = await _perplexity_search(prompt)
    except (httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        logger.warning("search_candidate_positions failed: %s", exc)
        tool_context.state["status_message"] = "Position search unavailable"
        return "NO DIRECT STATEMENT FOUND (search unavailable)"
    except Exception as exc:
        logger.error("search_candidate_positions unexpected error: %s", exc)
        tool_context.state["status_message"] = ""
        return "NO DIRECT STATEMENT FOUND (search error)"
    elapsed = time.monotonic() - t0

    source_count = len(sources)
    substantive = len(answer.strip()) > 300
    prefix = "DIRECT STATEMENT FOUND" if substantive else "NO DIRECT STATEMENT FOUND"

    logger.info(
        "search_candidate_positions: %s / %s / %s → %s (%d sources, %.1fs)",
        candidate_name,
        state,
        issue,
        prefix,
        source_count,
        elapsed,
    )

    source_lines = "\n".join(
        f"[{i + 1}] {s.get('url', '')}" for i, s in enumerate(sources)
    )

    evidence_card = {
        "candidateName": candidate_name,
        "issue": issue or "key positions",
        "answer": answer,
        "sources": sources,
    }
    existing_positions = list(tool_context.state.get("positions", []))
    existing_positions.append(evidence_card)
    tool_context.state["positions"] = existing_positions
    tool_context.state["stage"] = "news"

    return (
        f"{prefix} ({source_count} sources, {elapsed:.1f}s)\n\n"
        f"Candidate: {candidate_name} ({state})\n"
        f"Issue: {issue}\n\n"
        f"{answer}"
        + (f"\n\nSources:\n{source_lines}" if source_lines else "")
    )
