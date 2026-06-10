"""Deterministic Voter Brief pipeline (ADR 0001).

Replaces the fragile "LLM voluntarily chains seven tools" brief with a custom
BaseAgent whose _run_async_impl runs every step in a fixed order. Each step
yields one Event carrying an EventActions(state_delta=...) so ag_ui_adk forwards
one STATE_DELTA per yield and the live receipt streams 1:1 with steps. The slow
candidate-stance phase runs all broad Perplexity searches concurrently inside one
step and writes positions once (ParallelAgent is unsafe for merging — ADR 0001).

A single slow or failing step never aborts the brief: each is wrapped in
try/except, logs, sets a status_message, and the pipeline continues so stances
and the complete signal still reach the canvas.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncGenerator
from typing import Any

from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event, EventActions

from app.services.evidence.schema import SourceDocumentRef
from app.services.evidence.store import fetch_and_store_source
from app.services.positions.research import research_candidate_positions
from app.services.positions.store import get_cached_positions, upsert_positions
from app.tools.district_lookup import resolve_race_from_address
from app.tools.mongodb_mcp_query import mongodb_mcp_count
from app.tools.mongodb_tools import (
    fetch_candidate_cards,
    fetch_finance_summaries,
    fetch_legislation_records,
    fetch_voting_record,
)

logger = logging.getLogger(__name__)

_BRIEF_TRIGGER_PREFIX = "Build a complete voter brief for:"
_BRIEF_RACE_PREFIX = "Build a complete voter brief for race:"

# Archival budget per brief: dedup'd cited source URLs are fetched concurrently,
# capped so a source-heavy brief can't blow the Firecrawl quota or stall the demo.
_MAX_ARCHIVE_FETCHES = 12
_ARCHIVE_TIMEOUT_SECONDS = 10.0

# Cache-miss lazy fill: a shallow per-issue research pass, awaited only briefly so
# a long-tail candidate never stalls the brief — if it overruns we return what we
# have and fill on the next view (the scheduled deep job covers the priority set).
# 30s fits the broad tier (one grounded search + structuring); the positions
# stage already shows a live "Searching candidate positions…" receipt.
_LAZY_POSITIONS_TIMEOUT = 30.0


def extract_brief_address(message_text: str) -> str | None:
    """Return the address if the message is an address-brief trigger, else None."""
    stripped = message_text.strip()
    # The race-key trigger is a distinct prefix; don't treat it as an address.
    if stripped.startswith(_BRIEF_RACE_PREFIX):
        return None
    if not stripped.startswith(_BRIEF_TRIGGER_PREFIX):
        return None
    return stripped[len(_BRIEF_TRIGGER_PREFIX):].strip() or None


def extract_brief_race_key(message_text: str) -> str | None:
    """Return the race key if the message is a race-key brief trigger, else None.

    Used by the journalist race table: the race key is already known, so the
    pipeline skips address geocoding and uses it directly.
    """
    stripped = message_text.strip()
    if not stripped.startswith(_BRIEF_RACE_PREFIX):
        return None
    return stripped[len(_BRIEF_RACE_PREFIX):].strip() or None


def is_brief_trigger(message_text: str) -> bool:
    """True for either brief trigger (address or known race key)."""
    return (
        extract_brief_address(message_text) is not None
        or extract_brief_race_key(message_text) is not None
    )


def _state_from_race_key(race_key: str) -> str | None:
    """'2026-H-WI-04' -> 'WI'."""
    parts = race_key.split("-")
    return parts[2] if len(parts) >= 3 else None


def _latest_user_text(ctx: InvocationContext) -> str:
    """Read the latest user message text from the invocation context."""
    content = getattr(ctx, "user_content", None)
    if content is None or not getattr(content, "parts", None):
        return ""
    return " ".join(part.text for part in content.parts if getattr(part, "text", None))


class VoterBriefPipeline(BaseAgent):
    """Runs the full voter brief deterministically, one state_delta per step."""

    def _delta(self, ctx: InvocationContext, delta: dict[str, Any]) -> Event:
        ctx.session.state.update(delta)
        return Event(author=self.name, actions=EventActions(state_delta=delta))

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        text = _latest_user_text(ctx)
        # Journalist drill-in supplies a known race key; voter flow supplies an
        # address to geocode. Both run the identical downstream steps.
        race_key = extract_brief_race_key(text)
        if race_key:
            state_code = _state_from_race_key(race_key)
        else:
            race_key, state_code = await self._resolve_district(
                extract_brief_address(text)
            )
        yield self._delta(
            ctx,
            {
                "stage": "district",
                "currentRaceKey": race_key,
                "mapFocus": state_code,
                "status_message": (
                    f"District resolved: {race_key}" if race_key
                    else "Could not resolve a district for that address"
                ),
            },
        )

        candidates = await self._fetch("candidates", fetch_candidate_cards, race_key)
        yield self._delta(
            ctx, {"stage": "candidates", "candidates": candidates, "status_message": ""}
        )

        # Partner MCP step (hackathon MongoDB track): a real read-only count
        # through mongodb-mcp-server, surfaced as its own trace step so a judge
        # sees a genuine MCP call in the demo path. Non-fatal — None on failure.
        mcp_count = await self._verify_via_mcp(race_key)
        yield self._delta(
            ctx,
            {
                "stage": "mcp",
                "status_message": (
                    f"MongoDB MCP confirmed {mcp_count} candidate filings on record"
                    if mcp_count is not None
                    else "MongoDB MCP verification unavailable"
                ),
            },
        )

        finance = await self._fetch("finance", fetch_finance_summaries, race_key)
        yield self._delta(
            ctx, {"stage": "finance", "finance": finance, "status_message": ""}
        )

        legislation = await self._fetch(
            "legislation", fetch_legislation_records, race_key
        )
        yield self._delta(
            ctx,
            {"stage": "legislation", "legislation": legislation, "status_message": ""},
        )

        voting_record = await self._fetch_voting_record(race_key)
        yield self._delta(
            ctx, {"votingRecord": voting_record, "status_message": ""}
        )

        # Announce the slow positions phase as its own running step before the
        # ~25s gather, so the live receipt shows it active rather than stalling
        # on "legislation" and then jumping straight to "complete".
        yield self._delta(
            ctx,
            {
                "stage": "positions",
                "status_message": "Searching candidate positions across the web…",
            },
        )

        positions = await self._fetch_positions(candidates, race_key)

        # Archive the cited sources so each citation links to a dated, hashed copy
        # we stored — not just a link we found. Streamed as its own step; degrades
        # gracefully (un-archived sources stay cited as plain links).
        yield self._delta(
            ctx,
            {"stage": "archiving", "status_message": "Archiving cited sources…"},
        )
        positions = await self._archive_sources(positions)

        yield self._delta(
            ctx,
            {
                "stage": "complete",
                "positions": positions,
                "briefReady": True,
                "status_message": "",
            },
        )

    async def _resolve_district(
        self, address: str | None
    ) -> tuple[str | None, str | None]:
        if not address:
            logger.warning("voter_brief: no address found in trigger message")
            return None, None
        try:
            resolved = await resolve_race_from_address(address)
            return resolved.get("raceKey"), resolved.get("stateCode")
        except Exception as exc:  # any failure must not abort the brief
            logger.warning("voter_brief district step failed: %s", exc)
            return None, None

    async def _fetch(self, step: str, fetcher, race_key: str | None) -> list[dict]:
        if not race_key:
            return []
        try:
            return await fetcher(race_key)
        except Exception as exc:  # any failure must not abort the brief
            logger.warning("voter_brief %s step failed: %s", step, exc)
            return []

    async def _verify_via_mcp(self, race_key: str | None) -> int | None:
        if not race_key:
            return None
        try:
            return await mongodb_mcp_count("candidates", {"race_key": race_key})
        except Exception as exc:  # any failure must not abort the brief
            logger.warning("voter_brief mcp step failed: %s", exc)
            return None

    async def _fetch_voting_record(self, race_key: str | None):
        if not race_key:
            return None
        try:
            return await fetch_voting_record(race_key)
        except Exception as exc:  # any failure must not abort the brief
            logger.warning("voter_brief voting_record step failed: %s", exc)
            return None

    async def _fetch_positions(
        self, candidates: list[dict], race_key: str | None
    ) -> list[dict]:
        """Read each candidate's cached positions (lazy-filling on miss), flattened.

        Per ADR 0001 every candidate is researched concurrently inside this one
        step and the result is yielded once. A cache hit is a fast Mongo read; a
        miss fires a short, shallow on-demand fill written through to the cache.
        One candidate failing never aborts the step.
        """
        if not candidates or not race_key:
            return []
        results = await asyncio.gather(
            *(self._positions_for_candidate(card, race_key) for card in candidates),
            return_exceptions=True,
        )
        cards: list[dict] = []
        for card, result in zip(candidates, results, strict=True):
            if isinstance(result, Exception):
                logger.warning(
                    "voter_brief positions failed for %s: %s",
                    card.get("candidateId", "?"),
                    result,
                )
                continue
            cards.extend(result)
        return cards

    async def _positions_for_candidate(
        self, card: dict, race_key: str
    ) -> list[dict]:
        candidate_id = card.get("candidateId")
        if not candidate_id:
            return []
        doc = await self._read_or_fill(candidate_id, card, race_key)
        if not doc:
            return []
        return self._flatten_positions(doc, candidate_id)

    async def _read_or_fill(
        self, candidate_id: str, card: dict, race_key: str
    ) -> dict | None:
        """Return the fresh cached doc, else a shallow lazy fill, else None."""
        try:
            doc = await get_cached_positions(candidate_id)
        except Exception as exc:  # cache read failure must not abort the brief
            logger.warning("voter_brief positions cache read failed: %s", exc)
            doc = None
        if doc is not None:
            return doc
        return await self._lazy_fill(card, race_key)

    async def _lazy_fill(self, card: dict, race_key: str) -> dict | None:
        """Broad-tier on-demand research + write-through, bounded by a timeout.

        Broad = ONE grounded gemini-3.5-flash call + structuring — the engine
        that finds low-profile candidates (the shallow Perplexity fan-out left
        whole states honest-empty, e.g. WY 2026-06-10). First view of a cold
        race self-warms the cache; every later view is a fast hit.
        """
        candidate = self._research_candidate(card, race_key)
        try:
            doc = await asyncio.wait_for(
                research_candidate_positions(candidate, tier="broad"),
                timeout=_LAZY_POSITIONS_TIMEOUT,
            )
        except Exception as exc:  # timeout or any failure → fill on next view
            logger.warning(
                "voter_brief positions lazy fill skipped for %s: %s",
                card.get("candidateId", "?"),
                exc,
            )
            return None
        try:
            await upsert_positions(doc)  # write-through so the next view is a hit
        except Exception as exc:  # a failed write must not drop the result
            logger.warning("voter_brief positions write-through failed: %s", exc)
        return doc

    @staticmethod
    def _research_candidate(card: dict, race_key: str) -> dict:
        """Map a camelCase CandidateCard to the snake_case research input shape."""
        return {
            "candidate_id": card.get("candidateId"),
            "name": card.get("name", ""),
            "party": card.get("party", ""),
            "race_key": race_key,
            "incumbent_challenge_status": card.get("status", ""),
        }

    @staticmethod
    def _flatten_positions(doc: dict, candidate_id: str) -> list[dict]:
        """Flatten a candidate_positions doc into per-issue EvidenceCard dicts.

        Each card carries ``candidateId`` so the canvas can reliably tell which
        candidates have positions and which are a no-footprint empty state, even
        when display names differ in form.
        """
        candidate_name = doc.get("candidate_name", "")
        return [
            {
                "candidateId": candidate_id,
                "candidateName": candidate_name,
                "issue": position.get("issue", ""),
                "answer": position.get("answer", ""),
                "evidenceType": position.get("evidenceType", "reported"),
                "sources": position.get("sources", []),
            }
            for position in doc.get("positions", [])
        ]

    async def _archive_sources(self, positions: list[dict]) -> list[dict]:
        """Archive each cited source URL, returning cards enriched with archival refs.

        Deduped and capped per brief; every fetch is graceful. Any failure leaves
        the sources un-archived (still cited as links) and never aborts the brief.
        """
        if not positions:
            return positions
        try:
            urls = self._unique_cited_urls(positions)[:_MAX_ARCHIVE_FETCHES]
            if not urls:
                return positions
            refs = await asyncio.gather(
                *(self._archive_one(url) for url in urls),
                return_exceptions=True,
            )
            archived = {
                url: ref
                for url, ref in zip(urls, refs, strict=True)
                if isinstance(ref, SourceDocumentRef)
            }
            return [self._enrich_card(card, archived) for card in positions]
        except Exception as exc:  # archival must never abort the brief
            logger.warning("voter_brief archive step failed: %s", exc)
            return positions

    @staticmethod
    def _unique_cited_urls(positions: list[dict]) -> list[str]:
        """Cited URLs that still need archiving, de-duplicated, order preserved.

        Sources already carrying a ``sourceDocumentId`` were archived upstream
        (cached deep-research positions). Skipping them avoids a redundant Mongo
        freshness lookup per already-archived citation on every brief view; the
        un-archived shallow/reported sources are still fetched and archived.
        """
        urls = [
            url
            for card in positions
            for source in card.get("sources", [])
            if (url := source.get("url")) and not source.get("sourceDocumentId")
        ]
        return list(dict.fromkeys(urls))

    async def _archive_one(self, url: str) -> SourceDocumentRef | None:
        """Archive one URL with a per-source timeout; None on any failure."""
        try:
            return await asyncio.wait_for(
                fetch_and_store_source(url), timeout=_ARCHIVE_TIMEOUT_SECONDS
            )
        except Exception as exc:  # per-source failure must not abort the brief
            logger.warning("voter_brief archive source failed %s: %s", url, exc)
            return None

    @staticmethod
    def _enrich_card(card: dict, archived: dict[str, SourceDocumentRef]) -> dict:
        """Return a new card whose archived sources carry the archival fields."""
        new_sources = []
        for source in card.get("sources", []):
            ref = archived.get(source.get("url"))
            if ref is None:
                new_sources.append(source)
            else:
                new_sources.append(
                    {
                        **source,
                        "archived": True,
                        "archivedAt": ref.fetched_at.isoformat(),
                        "sourceDocumentId": ref.id,
                    }
                )
        return {**card, "sources": new_sources}
