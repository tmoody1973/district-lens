"""Perplexity sonar-pro tool for finding candidate position statements."""

from __future__ import annotations

import logging
import os
import time

import httpx
from google.adk.tools import ToolContext

logger = logging.getLogger(__name__)

_ENDPOINT = "https://api.perplexity.ai/chat/completions"
_MODEL = "sonar-pro"
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
    api_key = os.environ.get("PERPLEXITY_API_KEY")
    if not api_key:
        raise ValueError("PERPLEXITY_API_KEY environment variable is not set")

    tool_context.state["status_message"] = (
        f"Searching {candidate_name}'s {issue} position via Perplexity…"
    )

    _BROAD_TRIGGERS = {"", "all", "general", "overview", "issues", "everything"}
    broad = issue.strip().lower() in _BROAD_TRIGGERS

    if broad:
        prompt = (
            f"What are {candidate_name}'s positions and stances on key policy issues? "
            f"{candidate_name} is a congressional candidate from {state}. "
            "Cover as many issues as possible using only direct statements from their "
            "campaign website, press releases, floor speeches, voting record, and "
            "verified questionnaires. For each issue where no direct statement exists, "
            "say 'NO DIRECT STATEMENT FOUND' for that issue specifically."
        )
    else:
        prompt = (
            f"What has {candidate_name}, congressional candidate from {state}, "
            f"publicly said about {issue}? "
            "Prioritize direct statements from: campaign website, press releases, "
            "floor speeches, voting record, debate transcripts, verified questionnaires. "
            "If only third-party characterizations exist, label them as such. "
            "If no direct statement is found, say 'NO DIRECT STATEMENT FOUND' explicitly."
        )

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

    t0 = time.monotonic()
    try:
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
    except (httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        logger.warning("search_candidate_positions failed: %s", exc)
        tool_context.state["status_message"] = "Position search unavailable"
        return "NO DIRECT STATEMENT FOUND (search unavailable)"
    except Exception as exc:
        logger.error("search_candidate_positions unexpected error: %s", exc)
        tool_context.state["status_message"] = ""
        return "NO DIRECT STATEMENT FOUND (search error)"
    elapsed = time.monotonic() - t0

    answer: str = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    sources: list[dict] = data.get("search_results", [])
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
        f"[{i + 1}] {s.get('url', '')}" for i, s in enumerate(sources[:10])
    )

    evidence_card = {
        "candidateName": candidate_name,
        "issue": issue or "key positions",
        "answer": answer,
        "sources": [
            {
                "title": s.get("title", ""),
                "url": s.get("url", ""),
                "date": s.get("date"),
                "snippet": s.get("snippet", ""),
            }
            for s in sources[:10]
        ],
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
