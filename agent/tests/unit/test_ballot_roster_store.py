"""Persisting NBC Decision Desk's full ballot roster (not just the winner).

resolve_nominees already fetches NBC's per-seat results — which include every
candidate with their vote share and winner flag. RaceStatusStore.store_nbc_roster
captures that ground-truth roster into a queryable collection so covered,
past-primary races can be reconciled against the FEC filing roster later.
"""

from __future__ import annotations

import pytest

from app.refresh.race_status_store import RaceStatusStore


class _FakeCol:
    def __init__(self) -> None:
        self.docs: list[dict] = []

    def update_one(self, flt: dict, update: dict, upsert: bool = False) -> None:
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in flt.items()):
                doc.update(update.get("$set", {}))
                return
        if upsert:
            self.docs.append({**flt, **update.get("$set", {})})


@pytest.mark.unit
def test_store_nbc_roster_upserts_candidates():
    col = _FakeCol()
    store = RaceStatusStore(
        status_col=None, events_col=None, citations_col=None, roster_col=col
    )
    store.store_nbc_roster(
        race_key="2026-S-AL-00",
        slug="alabama-senate-results",
        source_url="https://www.nbcnews.com/politics/2026-primary-elections/alabama-senate-results",
        candidates=[
            {"name": "Barry Moore", "party": "gop", "percent_vote": 39.2, "is_winner": False},
            {"name": "Morgan Murphy", "party": "gop", "percent_vote": 1.3, "is_winner": False},
        ],
    )
    assert len(col.docs) == 1
    doc = col.docs[0]
    assert doc["race_key"] == "2026-S-AL-00"
    assert doc["source"] == "nbc_decision_desk"
    assert doc["slug"] == "alabama-senate-results"
    assert [c["name"] for c in doc["candidates"]] == ["Barry Moore", "Morgan Murphy"]
    assert "fetched_at" in doc


@pytest.mark.unit
def test_store_nbc_roster_reupsert_replaces_in_place():
    col = _FakeCol()
    store = RaceStatusStore(
        status_col=None, events_col=None, citations_col=None, roster_col=col
    )
    for pct in (0.0, 39.2):
        store.store_nbc_roster(
            race_key="2026-S-AL-00", slug="s", source_url="u",
            candidates=[{"name": "Barry Moore", "party": "gop", "percent_vote": pct, "is_winner": False}],
        )
    assert len(col.docs) == 1  # one doc per race_key, updated in place
    assert col.docs[0]["candidates"][0]["percent_vote"] == 39.2


@pytest.mark.unit
def test_store_nbc_roster_is_noop_without_roster_col():
    store = RaceStatusStore(status_col=None, events_col=None, citations_col=None)
    # Must not raise when roster persistence isn't configured.
    store.store_nbc_roster(race_key="x", slug="s", source_url="u", candidates=[])
