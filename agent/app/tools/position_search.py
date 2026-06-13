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

from app.services.positions.gemini_ground import gemini_grounded_search as _grounded_search

logger = logging.getLogger(__name__)

_ENDPOINT = "https://api.perplexity.ai/chat/completions"
_MODEL = "sonar-pro"
_GEMINI_MODEL = "gemini-3.1-pro-preview"
_DEFAULT_LOCATION = "global"
_MAX_BROAD_SOURCES = 10
_SYSTEM = (
    "You are a nonpartisan civic research assistant. "
    "Report the candidate's documented STANCE on policy issues, drawing on the "
    "candidate's own materials (campaign website, press releases, speeches), candidate "
    "questionnaires (Vote411, League of Women Voters, Ballotpedia Candidate Connection), "
    "credible interviews and news/endorsement coverage that quotes or describes their "
    "position, and — for incumbents — their voting and sponsorship record. "
    "For each stance make clear whether it is the candidate's own words (a direct quote) "
    "or a credible source reporting/characterizing their position. "
    "Cite every claim with inline numeric markers [1], [2], etc. "
    "Never infer a position from party affiliation or from donors. Never recommend how "
    "to vote. Only say no information is available for an issue when no credible source "
    "documents a stance on it."
)

_BROAD_TRIGGERS = {"", "all", "general", "overview", "issues", "everything"}

_STRUCTURE_SYSTEM = (
    "You are a nonpartisan civic data extractor. You are given a research summary "
    "about a congressional candidate's policy stances, with numbered sources. "
    "Group the candidate's stances by policy issue. Be exhaustive: produce a "
    "separate entry for EVERY distinct issue the summary addresses (economy and "
    "jobs, taxes, health care, Social Security and Medicare, immigration, "
    "education, reproductive rights, climate and energy, guns, veterans, foreign "
    "policy, and more). Do NOT stop after the first one or two issues. "
    "For each issue, write one concise "
    "factual statement of the candidate's position, classify the evidence_type as one "
    "of: 'direct_quote' (the candidate's own words), 'reported' (a credible outlet "
    "describing their position), 'questionnaire' (a candidate questionnaire such as "
    "Vote411 / League of Women Voters / Ballotpedia Candidate Connection), or "
    "'voting_record' (an incumbent's votes or bill sponsorships); and list the indices "
    "of the sources (0-based) that support it. Use only what the summary states; never "
    "infer from party or donors. Return ONLY valid JSON matching the requested schema."
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
                    "evidence_type": {
                        "type": "string",
                        "enum": ["direct_quote", "reported", "questionnaire", "voting_record"],
                    },
                    "source_indices": {
                        "type": "array",
                        "items": {"type": "integer"},
                    },
                },
                "required": ["issue", "statement", "evidence_type", "source_indices"],
            },
        }
    },
    "required": ["positions"],
}


def _is_broad(issue: str) -> bool:
    return issue.strip().lower() in _BROAD_TRIGGERS


def _search_name(candidate_name: str) -> str:
    """Convert an FEC 'Last, First Middle' name to natural 'First Middle Last'.

    Perplexity matches a natural name ('Amy Donahue') far better than the
    comma-inverted FEC form ('Donahue, Amy'), which yields sparse or wrong hits.
    """
    if "," in candidate_name:
        last, first = candidate_name.split(",", 1)
        return f"{first.strip()} {last.strip()}".strip()
    return candidate_name.strip()


def _build_prompt(candidate_name: str, state_code: str, issue: str) -> str:
    """Build the Perplexity user prompt for a broad sweep or a single issue."""
    name = _search_name(candidate_name)
    if _is_broad(issue):
        return (
            f"Share comprehensive, issue-by-issue details of {name}'s political stances. "
            f"{name} is a 2026 U.S. congressional candidate from {state_code}. "
            "Cover as many issues as possible — economy and jobs, taxes, health care, "
            "Social Security and Medicare, reproductive rights, education, immigration, "
            "public lands and climate, veterans, foreign policy, guns, and others that "
            "apply. For each issue, state the candidate's position and cite the source. "
            "Draw on the candidate's own campaign website, press releases and speeches; "
            "candidate questionnaires (Vote411, League of Women Voters, Ballotpedia "
            "Candidate Connection); credible interviews and news/endorsement coverage; "
            "and, for an incumbent, their voting and sponsorship record. Note for each "
            "issue whether it is the candidate's own words or a credible source describing "
            "their position. Only say no information is available for an issue when no "
            "credible source documents a stance on it."
        )
    return (
        f"What is {name}'s stance on {issue}? {name} is a 2026 U.S. congressional "
        f"candidate from {state_code}. State the candidate's position on {issue} and cite "
        "the source, drawing on the candidate's campaign materials, candidate "
        "questionnaires (Vote411, League of Women Voters, Ballotpedia Candidate "
        "Connection), credible interviews and news/endorsement coverage, and — for an "
        "incumbent — their voting record. Note whether it is the candidate's own words or "
        "a credible source describing their position. Only say no information is available "
        "when no credible source documents a stance on this issue."
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
        # No domain allowlist: non-incumbents' positions live on their campaign
        # sites and local news, which an allowlist excludes. The evidence-first
        # system prompt + Gemini structuring keep results grounded.
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
        "evidenceType": "reported",
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
        # _structure_with_gemini is a blocking SDK call; offload it so it does not
        # stall the event loop and actually runs concurrently under asyncio.gather.
        raw_json = await asyncio.to_thread(
            _structure_with_gemini, candidate_name, broad_answer, sources
        )
        parsed = json.loads(raw_json)
        positions = parsed.get("positions", [])
    except Exception as exc:  # any failure must fall back, never abort
        logger.warning("structure_positions fallback for %s: %s", candidate_name, exc)
        return [_fallback_card(candidate_name, broad_answer, sources)]

    cards = [
        {
            "candidateName": candidate_name,
            "issue": position.get("issue", "key positions"),
            "answer": position.get("statement", ""),
            "evidenceType": position.get("evidence_type", "reported"),
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
    for candidate, result in zip(candidates, results, strict=True):
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

    Uses Gemini 3.5 Flash with Google Search grounding to find evidence from
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
        f"Searching {candidate_name}'s {issue} position via Google Search grounding…"
    )

    prompt = _build_prompt(candidate_name, state, issue)

    t0 = time.monotonic()
    try:
        answer, sources = await _grounded_search(prompt)
    except Exception as exc:
        logger.error("search_candidate_positions error: %s", exc)
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

    return (
        f"{prefix} ({source_count} sources, {elapsed:.1f}s)\n\n"
        f"Candidate: {candidate_name} ({state})\n"
        f"Issue: {issue}\n\n"
        f"{answer}"
        + (f"\n\nSources:\n{source_lines}" if source_lines else "")
    )
