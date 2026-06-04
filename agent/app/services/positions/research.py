"""``research_candidate_positions`` — the reusable, cache-feeding research unit.

Six graceful steps (design §"The research pipeline"):

1. **Disambiguate** — build an entity string from existing candidate data
   (name stripped of honorifics + office + district + state + party + cycle).
   This is the single biggest fix for "can't identify the candidate."
2. **Discover** — query Perplexity to FIND primary sources (URLs), not summarize.
3. **Rank** — a positions-specific scorer: candidate's own domain > questionnaire
   > news; aggregators denied as a *primary* source.
4. **Scrape** the top N (deep = 3) through the existing evidence store, which
   archives each page (archived ✓) and returns a ``SourceDocumentRef``.
5. **Extract** per-issue stances from the SCRAPED page text via Gemini, tagging
   ``evidenceType`` by provenance. Hard guardrail: only assert a stance the text
   supports — otherwise ``no_positions_found``. Never infer.
6. **Degrade** — no primary sources / all scrapes fail → a shallow per-issue
   Perplexity fan-out (``reported``); still nothing → an honest empty.

Every external call (``search_fn``, ``scrape_fn``, ``structure_fn``) is injected
so tests run network-free, and every one is guarded — the function NEVER raises
into its caller.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

from app.services.evidence.schema import SourceDocumentRef
from app.services.evidence.store import fetch_and_store_source
from app.services.positions.schema import (
    AGGREGATOR_DENY,
    QUESTIONNAIRE_DOMAINS,
    STATUS_EMPTY,
    STATUS_FOUND,
    positions_content_hash,
)
from app.tools.position_search import _perplexity_search, _search_name

logger = logging.getLogger(__name__)

CYCLE = "2026"
_HONORIFICS = {"mr", "mrs", "ms", "dr", "rep", "sen", "hon", "gov"}
_TIER_SCRAPE_CAP = {"deep": 3, "shallow": 0, "discovery_only": 0}

# Issues fanned out per-issue in the shallow fallback tier.
_SHALLOW_ISSUES = (
    "the economy and jobs",
    "health care",
    "immigration",
    "education",
    "reproductive rights",
    "climate and energy",
)

SearchFn = Callable[[str], Awaitable[tuple[str, list[dict]]]]
ScrapeFn = Callable[[str], Awaitable[SourceDocumentRef | None]]
StructureFn = Callable[[str, list[dict]], Awaitable[list[dict]]]


# ---------------------------------------------------------------------------
# Step 1 — disambiguation
# ---------------------------------------------------------------------------


def _strip_honorifics(name: str) -> str:
    """Drop leading honorific tokens (Mr./Dr./Rep. …) from a natural-order name."""
    tokens = name.replace(".", "").split()
    while tokens and tokens[0].lower() in _HONORIFICS:
        tokens = tokens[1:]
    return " ".join(tokens)


def _natural_name(candidate: dict[str, Any]) -> str:
    """Candidate name in natural order, honorifics stripped (Perplexity-friendly)."""
    return _strip_honorifics(_search_name(candidate.get("name", "")))


def _parse_race_key(race_key: str) -> tuple[str, str, str]:
    """Return (office_label, state, district) from ``2026-{H|S}-{ST}-{DD}``."""
    parts = race_key.split("-")
    if len(parts) != 4:
        return "U.S. Congress", "", ""
    _, chamber, state, district = parts
    office = "U.S. Senate" if chamber.upper() == "S" else "U.S. House"
    return office, state, district


def build_disambiguation(candidate: dict[str, Any]) -> str:
    """Build the resolved-entity string used in every query (and stored for audit).

    Carries the identity signals the old one-query path dropped: office, district,
    state, party, and cycle. For a Senate seat (district ``00``) it reads as
    statewide rather than emitting a bogus district number.
    """
    name = _natural_name(candidate)
    party = candidate.get("party", "")
    office, state, district = _parse_race_key(candidate.get("race_key", ""))

    if office == "U.S. Senate" or district in ("", "00"):
        seat = f"{state} (statewide)" if state else office
    else:
        seat = f"{state}-{district}"

    pieces = [name]
    if party:
        pieces.append(party)
    pieces.append("candidate for")
    pieces.append(office)
    pieces.append(seat)
    pieces.append(f"{CYCLE} election")
    return " ".join(p for p in pieces if p)


# ---------------------------------------------------------------------------
# Step 3 — positions-specific source ranking
# ---------------------------------------------------------------------------


def _hostname(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def _last_name(candidate: dict[str, Any]) -> str:
    raw = candidate.get("name", "")
    last = raw.split(",", 1)[0] if "," in raw else raw.split(" ")[-1]
    return "".join(ch for ch in last.lower() if ch.isalpha())


def _source_score(url: str, candidate: dict[str, Any]) -> int:
    """Score a source for *primary* suitability. Negative → denied as primary."""
    host = _hostname(url)
    if any(host == d or host.endswith("." + d) for d in AGGREGATOR_DENY):
        return -1
    if any(host == d or host.endswith("." + d) for d in QUESTIONNAIRE_DOMAINS):
        return 50
    last = _last_name(candidate)
    if last and last in host.replace("-", ""):
        return 100  # the candidate's own domain
    return 10  # news / interview / other


def rank_sources(sources: list[dict], candidate: dict[str, Any]) -> list[dict]:
    """Rank discovered sources for primary suitability, dropping denied aggregators.

    Own-domain (100) > questionnaire (50) > news (10); aggregators (-1) are
    excluded entirely so they can never be selected as a primary source.
    """
    scored = [(s, _source_score(s.get("url", ""), candidate)) for s in sources]
    primary = [(s, score) for s, score in scored if score >= 0]
    primary.sort(key=lambda pair: pair[1], reverse=True)
    return [s for s, _ in primary]


# ---------------------------------------------------------------------------
# Step 4 — scrape helpers
# ---------------------------------------------------------------------------


def _archived_source(source: dict, ref: SourceDocumentRef) -> dict:
    """Merge a discovered source with its archived ref → the T4 source shape."""
    return {
        "title": source.get("title", ""),
        "url": source.get("url", ""),
        "date": source.get("date"),
        "snippet": source.get("snippet", ""),
        "archived": True,
        "archivedAt": ref.fetched_at.isoformat() if ref.fetched_at else None,
        "sourceDocumentId": ref.id,
    }


async def _scrape_one(source: dict, scrape_fn: ScrapeFn) -> dict | None:
    """Scrape one source; return its archived shape, or None on any failure."""
    url = source.get("url", "")
    if not url:
        return None
    try:
        ref = await scrape_fn(url)
    except Exception as exc:  # graceful: a scrape failure drops the source
        logger.warning("research: scrape failed for %s: %s", url, exc)
        return None
    if ref is None:
        return None
    return _archived_source(source, ref)


# ---------------------------------------------------------------------------
# Steps 2/5/6 helpers
# ---------------------------------------------------------------------------


async def _discover(query: str, search_fn: SearchFn) -> list[dict]:
    try:
        _answer, sources = await search_fn(query)
        return sources or []
    except Exception as exc:  # missing key / transport error → no discovery
        logger.warning("research: discovery failed: %s", exc)
        return []


async def _extract(
    candidate_name: str, scraped: list[dict], structure_fn: StructureFn
) -> list[dict]:
    try:
        positions = await structure_fn(candidate_name, scraped)
        return positions or []
    except Exception as exc:  # graceful: extraction failure → honest empty
        logger.warning("research: extraction failed for %s: %s", candidate_name, exc)
        return []


async def _shallow_fanout(disambiguation: str, search_fn: SearchFn) -> list[dict]:
    """Per-issue Perplexity fan-out → ``reported`` positions (no scrape)."""

    async def _one(issue: str) -> dict | None:
        query = f"What is the position of {disambiguation} on {issue}?"
        try:
            answer, sources = await search_fn(query)
        except Exception as exc:
            logger.warning("research: shallow fan-out failed for %s: %s", issue, exc)
            return None
        if len(answer.strip()) <= 200:
            return None
        return {
            "issue": issue,
            "answer": answer.strip(),
            "evidenceType": "reported",
            "sources": sources or [],
        }

    results = await asyncio.gather(
        *(_one(issue) for issue in _SHALLOW_ISSUES), return_exceptions=True
    )
    return [r for r in results if isinstance(r, dict)]


# ---------------------------------------------------------------------------
# Doc assembly
# ---------------------------------------------------------------------------


def _build_doc(
    candidate: dict[str, Any],
    *,
    disambiguation: str,
    tier: str,
    positions: list[dict],
) -> dict[str, Any]:
    return {
        "candidate_id": candidate.get("candidate_id", ""),
        "race_key": candidate.get("race_key", ""),
        "candidate_name": _natural_name(candidate),
        "researched_at": datetime.now(UTC),
        "research_tier": tier,
        "disambiguation": disambiguation,
        "status": STATUS_FOUND if positions else STATUS_EMPTY,
        "positions": positions,
        "content_hash": positions_content_hash(positions),
        "retrieval_history": [],
    }


# ---------------------------------------------------------------------------
# Default Gemini extractor (network — replaced by an injected fake in tests)
# ---------------------------------------------------------------------------


async def _default_structure_fn(
    candidate_name: str, scraped_sources: list[dict]
) -> list[dict]:
    """Extract per-issue stances from the archived page text via Gemini.

    Loads each scraped page's markdown from ``source_documents`` and asks Gemini
    to extract only stances the text supports. Returns ``[]`` on any failure or
    when no stance is grounded — the no-inference guardrail. Network-bound; the
    unit tests inject a fake in its place.
    """
    try:
        from app.services.positions.extract import extract_positions_from_pages

        return await extract_positions_from_pages(candidate_name, scraped_sources)
    except Exception as exc:  # graceful: never raise into the pipeline
        logger.warning("research: default extractor failed for %s: %s", candidate_name, exc)
        return []


# ---------------------------------------------------------------------------
# The pipeline
# ---------------------------------------------------------------------------


async def research_candidate_positions(
    candidate: dict[str, Any],
    *,
    tier: str = "deep",
    search_fn: SearchFn = _perplexity_search,
    scrape_fn: ScrapeFn = fetch_and_store_source,
    structure_fn: StructureFn = _default_structure_fn,
) -> dict[str, Any]:
    """Research one candidate's positions into a ``candidate_positions`` doc.

    Returns a doc ready for ``upsert_positions``. NEVER raises: every step
    degrades to a fallback or an honest empty.
    """
    disambiguation = build_disambiguation(candidate)
    name = _natural_name(candidate)

    cap = _TIER_SCRAPE_CAP.get(tier, 3)

    if cap > 0:
        discovery_query = (
            f"Find primary sources documenting the policy positions of {disambiguation}: "
            "the campaign website, Ballotpedia Candidate Connection, "
            "Vote411 / League of Women Voters questionnaire, and recent news coverage."
        )
        discovered = await _discover(discovery_query, search_fn)
        primary = rank_sources(discovered, candidate)[:cap]

        if primary:
            scraped_results = await asyncio.gather(
                *(_scrape_one(source, scrape_fn) for source in primary)
            )
            scraped = [s for s in scraped_results if s is not None]
            if scraped:
                # We read the candidate's own pages — trust extraction's verdict,
                # including an honest empty (no inference / no fan-out).
                positions = await _extract(name, scraped, structure_fn)
                return _build_doc(
                    candidate,
                    disambiguation=disambiguation,
                    tier="deep",
                    positions=positions,
                )

    # No primary sources, or every scrape failed → shallow reported fan-out.
    shallow = await _shallow_fanout(disambiguation, search_fn)
    return _build_doc(
        candidate,
        disambiguation=disambiguation,
        tier="shallow" if shallow else "discovery_only",
        positions=shallow,
    )
