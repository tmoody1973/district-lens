"""Gemini search-grounding tool for finding candidate position statements."""

from __future__ import annotations

import logging
import os
import time

import google.genai as genai
from google.genai import types

logger = logging.getLogger(__name__)

_NONPARTISAN_SYSTEM = (
    "You are a nonpartisan civic research assistant. "
    "Your only job is to find and quote direct public statements made by political candidates. "
    "Do NOT infer a candidate's position from their party, donors, or associates. "
    "If you cannot find a direct statement, say 'NO DIRECT STATEMENT FOUND' and explain what you searched. "
    "Always cite the source (URL, interview, press release, vote record) for every statement you report."
)


async def search_candidate_positions(
    candidate_name: str, state: str, issue: str
) -> str:
    """Search for a congressional candidate's direct public statements on a policy issue.

    Uses Gemini's Google Search grounding to find evidence from campaign websites,
    press releases, interviews, and legislative records.

    Args:
        candidate_name: Full name of the candidate (e.g. "Elissa Slotkin")
        state: Two-letter state code or full state name (e.g. "MI" or "Michigan")
        issue: The policy issue to search for (e.g. "healthcare", "immigration")

    Returns:
        Formatted string prefixed with DIRECT STATEMENT FOUND or NO DIRECT STATEMENT FOUND,
        including source count and query latency.
    """
    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project:
        raise ValueError("GOOGLE_CLOUD_PROJECT environment variable is not set")

    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")

    prompt = (
        f"What is {candidate_name} ({state})'s position on {issue}? "
        "Find direct quotes, official statements, or voting record evidence from their "
        "campaign website, press releases, interviews, or congressional record. "
        "Do NOT infer the position from party affiliation, donors, or endorsements."
    )

    t0 = time.monotonic()
    client = genai.Client(vertexai=True, project=project, location=location)
    response = await client.aio.models.generate_content(
        model="gemini-3.1-pro-preview",
        contents=prompt,
        config=types.GenerateContentConfig(
            tools=[types.Tool(google_search=types.GoogleSearch())],
            system_instruction=_NONPARTISAN_SYSTEM,
        ),
    )
    elapsed = time.monotonic() - t0

    answer = response.text or ""

    source_count = 0
    if response.candidates:
        for candidate in response.candidates:
            if (
                candidate.grounding_metadata
                and candidate.grounding_metadata.grounding_chunks
            ):
                source_count = len(candidate.grounding_metadata.grounding_chunks)
                break

    lower = answer.lower()
    no_direct = any(
        phrase in lower
        for phrase in [
            "no direct statement",
            "i could not find",
            "could not find a direct",
            "no public statement",
            "not found any direct",
        ]
    )

    prefix = "NO DIRECT STATEMENT FOUND" if no_direct else "DIRECT STATEMENT FOUND"
    logger.info(
        "search_candidate_positions: %s / %s / %s → %s (%d sources, %.1fs)",
        candidate_name,
        state,
        issue,
        prefix,
        source_count,
        elapsed,
    )

    return (
        f"{prefix} ({source_count} sources, {elapsed:.1f}s)\n\n"
        f"Candidate: {candidate_name} ({state})\n"
        f"Issue: {issue}\n\n"
        f"{answer}"
    )
