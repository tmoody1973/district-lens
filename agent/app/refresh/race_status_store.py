"""Writes to race_status / race_status_events / results_citations.

Enforces the no-fabrication invariant: status="confirmed" requires a citation_id.
"""

from __future__ import annotations

import datetime
import hashlib
from typing import Any


class RaceStatusStore:
    def __init__(self, *, status_col, events_col, citations_col, roster_col=None):
        self.status_col = status_col
        self.events_col = events_col
        self.citations_col = citations_col
        self.roster_col = roster_col

    def store_nbc_roster(self, *, race_key: str, slug: str, source_url: str,
                         candidates: list[dict[str, Any]]) -> None:
        """Persist NBC Decision Desk's full ballot roster for a race.

        NBC's per-seat feed lists every candidate with vote share + winner flag —
        ground-truth ballot data for a covered, past-primary contest. One doc per
        race_key, updated in place. No-op when roster persistence isn't wired.
        """
        if self.roster_col is None:
            return
        now = datetime.datetime.now(datetime.UTC)
        self.roster_col.update_one(
            {"race_key": race_key},
            {"$set": {
                "race_key": race_key, "slug": slug, "source": "nbc_decision_desk",
                "source_url": source_url, "candidates": candidates, "fetched_at": now,
            }},
            upsert=True,
        )

    def store_citation(self, *, race_key: str, url: str, publisher: str, snippet: str, content: str) -> Any:
        now = datetime.datetime.now(datetime.UTC)
        res = self.citations_col.insert_one({
            "race_key": race_key, "url": url, "publisher": publisher,
            "snippet": snippet[:500],
            "content_hash": hashlib.sha256(content.encode("utf-8", "replace")).hexdigest(),
            "fetched_at": now,
        })
        return res.inserted_id

    def apply_resolution(
        self, *, race_key: str, to_status: str, winners: dict[str, str],
        citation_id: Any | None, reason: str | None,
        presentation_class: str = "routine", prev_status: str | None = None,
        confidence: float = 0.0, confirmation_basis: list[str] | None = None,
        losers: list[str] | None = None, extra: dict[str, Any] | None = None,
    ) -> None:
        if to_status == "confirmed" and citation_id is None:
            raise ValueError("cannot set status=confirmed without a citation_id (no-fabrication rule)")
        now = datetime.datetime.now(datetime.UTC)
        doc = {
            "status": to_status, "winners": winners, "losers": losers or [],
            "citation_id": citation_id, "flagged_reason": reason,
            "confidence": confidence, "confirmation_basis": confirmation_basis or [],
            "resolved_at": now, "last_checked_at": now,
            **(extra or {}),
        }
        self.status_col.update_one({"race_key": race_key}, {"$set": doc}, upsert=True)
        if to_status != prev_status:
            self.events_col.insert_one({
                "race_key": race_key, "from_status": prev_status, "to_status": to_status,
                "winners": winners, "reason": reason,
                "presentation_class": presentation_class,
                "citation_id": citation_id, "occurred_at": now,
            })
