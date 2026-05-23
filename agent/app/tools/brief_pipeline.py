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

import logging
from collections.abc import AsyncGenerator
from typing import Any

from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event, EventActions

from app.tools.district_lookup import resolve_race_from_address
from app.tools.mongodb_tools import (
    fetch_candidate_cards,
    fetch_finance_summaries,
    fetch_legislation_records,
)
from app.tools.position_search import gather_candidate_positions

logger = logging.getLogger(__name__)

_BRIEF_TRIGGER_PREFIX = "Build a complete voter brief for:"


def extract_brief_address(message_text: str) -> str | None:
    """Return the address if the message is a brief trigger, else None."""
    stripped = message_text.strip()
    if not stripped.startswith(_BRIEF_TRIGGER_PREFIX):
        return None
    return stripped[len(_BRIEF_TRIGGER_PREFIX):].strip() or None


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
        address = extract_brief_address(_latest_user_text(ctx))

        race_key, state_code = await self._resolve_district(address)
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

        positions = await self._fetch_positions(candidates, state_code)
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

    async def _fetch_positions(
        self, candidates: list[dict], state_code: str | None
    ) -> list[dict]:
        if not candidates or not state_code:
            return []
        try:
            return await gather_candidate_positions(candidates, state_code)
        except Exception as exc:  # any failure must not abort the brief
            logger.warning("voter_brief positions step failed: %s", exc)
            return []
