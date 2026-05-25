"""Unit tests for the resolve_nominees Cloud Run Job entrypoint.

All external dependencies are injected — no network, no real Mongo.
The real gate.decide, calendar.states_with_closed_contest, and
citation_fetch.pick_authoritative_url are used so logic bugs are caught.
"""

from __future__ import annotations

import datetime

import pytest

from app.jobs import resolve_nominees as job_mod

# ---------------------------------------------------------------------------
# Minimal fake collection that supports find, find_one, insert_one, update_one
# ---------------------------------------------------------------------------


class FakeCol:
    """In-memory stand-in for a pymongo collection (equality-only matching)."""

    def __init__(self, seed: list[dict] | None = None) -> None:
        self.docs: list[dict] = [dict(d) for d in (seed or [])]

    def find(self, flt: dict | None = None):
        flt = flt or {}
        return [d for d in self.docs if self._matches(d, flt)]

    def find_one(self, flt: dict) -> dict | None:
        return next(
            (d for d in self.docs if self._matches(d, flt)),
            None,
        )

    def insert_one(self, doc: dict):
        self.docs.append(dict(doc))
        return type("R", (), {"inserted_id": len(self.docs)})()

    def update_one(self, flt: dict, update: dict, upsert: bool = False) -> None:
        doc = self.find_one(flt)
        if doc is None and upsert:
            doc = dict(flt)
            self.docs.append(doc)
        if doc is not None:
            doc.update(update.get("$set", {}))

    @staticmethod
    def _matches(doc: dict, flt: dict) -> bool:
        return all(doc.get(key) == value for key, value in flt.items())


# ---------------------------------------------------------------------------
# Fake MongoClient / DB that routes collection names to caller-supplied FakeCol
# ---------------------------------------------------------------------------


class FakeDB:
    def __init__(self, cols: dict[str, FakeCol]) -> None:
        self._cols = cols

    def __getitem__(self, name: str) -> FakeCol:
        # Return an empty FakeCol for any collection not explicitly seeded.
        return self._cols.setdefault(name, FakeCol())


class FakeClient:
    def __init__(self, cols: dict[str, FakeCol]) -> None:
        self._db = FakeDB(cols)
        self.closed = False

    def __getitem__(self, name: str) -> FakeDB:
        return self._db

    def close(self) -> None:
        self.closed = True


# ---------------------------------------------------------------------------
# Shared calendar fixture: GA primary on 2026-05-19, majority_50 state
# (so runoff_rule != "none"; this exercises the full gate path)
# ---------------------------------------------------------------------------

GA_CALENDAR_ROW = {
    "state": "GA",
    "cycle": "2026",
    "primary_date": datetime.date(2026, 5, 19),
    "runoff_date": datetime.date(2026, 6, 16),
    "runoff_rule": "majority_50",
    "has_senate_race": True,
    "house_seat_count": 14,
    "source": "fvap_2026",
    "source_url": "https://www.fvap.gov/test",
}

GA_RACE_DOC = {
    "race_key": "2026-H-GA-07",
    "cycle": "2026",
    "office": "H",
    "state": "GA",
    "district": "07",
    "runoff_rule": "majority_50",
    "candidate_count": 2,
}

GA_CAND_REP = {
    "candidate_id": "H0GA07001",
    "race_key": "2026-H-GA-07",
    "name": "Jane Doe",
    "party": "REP",
    "office": "H",
    "state": "GA",
    "district": "07",
    "incumbent_challenge_status": "incumbent",
    "fec_status": "C",
}

GA_CAND_DEM = {
    "candidate_id": "H0GA07002",
    "race_key": "2026-H-GA-07",
    "name": "John Smith",
    "party": "DEM",
    "office": "H",
    "state": "GA",
    "district": "07",
    "incumbent_challenge_status": "challenger",
    "fec_status": "C",
}

# A Perplexity answer that the heuristic parser can extract winners from.
_CLEAN_ANSWER = (
    "Republican won by Jane Doe in the 2026 Georgia House district 7 primary. "
    "Democratic won by John Smith in the same contest."
)

# An authoritative government URL that pick_authoritative_url will accept.
_AUTH_URL = "https://sos.ga.gov/elections/results"

# Canned sources list including the authoritative URL.
_AUTH_SOURCES = [{"url": _AUTH_URL, "title": "GA SOS Results", "snippet": "Jane Doe wins"}]

# Sources that score below the authoritative threshold (no gov/ap host).
_WEAK_SOURCES = [{"url": "https://ballotpedia.org/GA-07", "title": "Ballotpedia"}]


# ---------------------------------------------------------------------------
# Helper: build a collections dict for a standard GA scenario
# ---------------------------------------------------------------------------


def _ga_cols(
    *,
    calendar_rows: list[dict] | None = None,
    races: list[dict] | None = None,
    candidates: list[dict] | None = None,
) -> dict[str, FakeCol]:
    return {
        "primary_calendar": FakeCol(calendar_rows or [GA_CALENDAR_ROW]),
        "races": FakeCol(races or [GA_RACE_DOC]),
        "candidates": FakeCol(candidates or [GA_CAND_REP, GA_CAND_DEM]),
        "race_status": FakeCol(),
        "race_status_events": FakeCol(),
        "results_citations": FakeCol(),
        "refresh_runs": FakeCol(),
    }


# ---------------------------------------------------------------------------
# Fake search / fetch helpers
# ---------------------------------------------------------------------------


def _make_search_fn(answer: str, sources: list[dict]):
    """Return an async search_fn that always returns the given canned data."""

    async def fake_search(prompt: str) -> tuple[str, list[dict]]:
        return answer, sources

    return fake_search


def _make_fetch_fn(result: tuple[str, str] | None = None):
    """Return an async fetch_fn that returns ``result`` for any URL."""

    async def fake_fetch(url: str) -> tuple[str, str] | None:
        return result

    return fake_fetch


def _make_counting_search_fn(answer: str, sources: list[dict]):
    """Return an async search_fn plus a mutable call counter (calls["n"]).

    Lets a test assert the resolver was never invoked for a skipped race.
    """
    calls = {"n": 0}

    async def fake_search(prompt: str) -> tuple[str, list[dict]]:
        calls["n"] += 1
        return answer, sources

    return fake_search, calls


# Fixed reference date: 2026-05-24 (5 days after GA's 2026-05-19 primary).
_TODAY = datetime.date(2026, 5, 24)


# ---------------------------------------------------------------------------
# Test 1: clean GA primary → confirmed + citation + event
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ga_clean_primary_confirms_race():
    """Full happy path: GA primary resolved with an authoritative source."""
    cols = _ga_cols()
    client = FakeClient(cols)

    result = await job_mod.execute_resolution(
        mongo_uri="mongodb://fake",
        today=_TODAY,
        window_days=10,
        search_fn=_make_search_fn(_CLEAN_ANSWER, _AUTH_SOURCES),
        fetch_fn=_make_fetch_fn(("Election results: Jane Doe wins", "sos.ga.gov")),
        client_factory=lambda uri: client,
    )

    assert result["status"] == "completed"
    counts = result["counts"]
    assert counts["races_checked"] == 1
    assert counts["confirmed"] == 1
    assert counts["flagged"] == 0
    assert counts["errors"] == 0

    # race_status set to confirmed
    status_docs = cols["race_status"].docs
    assert len(status_docs) == 1
    assert status_docs[0]["status"] == "confirmed"

    # One event written (pre_primary → confirmed)
    event_docs = cols["race_status_events"].docs
    assert len(event_docs) == 1
    assert event_docs[0]["to_status"] == "confirmed"

    # Citation stored
    citation_docs = cols["results_citations"].docs
    assert len(citation_docs) == 1
    assert citation_docs[0]["url"] == _AUTH_URL

    # refresh_runs completed
    run_docs = cols["refresh_runs"].docs
    assert len(run_docs) == 1
    run = run_docs[0]
    assert run["job_name"] == "resolve_nominees"
    assert run["trigger"] == "scheduled"
    assert run["status"] == "completed"
    assert run["counts"]["confirmed"] == 1
    assert client.closed is True


# ---------------------------------------------------------------------------
# Test 2: no authoritative source → provisional + no citation + uncertainty event
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_authoritative_source_flags_provisional():
    """When Perplexity returns only weak sources, the race is flagged provisional."""
    cols = _ga_cols()
    client = FakeClient(cols)

    # Weak sources only — pick_authoritative_url returns None.
    result = await job_mod.execute_resolution(
        mongo_uri="mongodb://fake",
        today=_TODAY,
        window_days=10,
        search_fn=_make_search_fn(_CLEAN_ANSWER, _WEAK_SOURCES),
        fetch_fn=_make_fetch_fn(None),
        client_factory=lambda uri: client,
    )

    assert result["status"] == "completed"
    counts = result["counts"]
    assert counts["races_checked"] == 1
    assert counts["confirmed"] == 0
    # The gate must flag provisional (no citation_id even though winners parsed).
    assert counts["flagged"] == 1
    assert counts["errors"] == 0

    status_docs = cols["race_status"].docs
    assert len(status_docs) == 1
    assert status_docs[0]["status"] == "provisional"

    event_docs = cols["race_status_events"].docs
    assert len(event_docs) == 1
    assert event_docs[0]["presentation_class"] == "genuine_uncertainty"

    # No citation stored
    assert len(cols["results_citations"].docs) == 0


# ---------------------------------------------------------------------------
# Test 3: no contests in window → zero races_checked, refresh_runs completed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_op_day_when_no_contests_in_window():
    """When no primary/runoff falls within the window, nothing is processed."""
    # Use a date far outside any calendar entry.
    out_of_window_date = datetime.date(2025, 1, 1)
    cols = _ga_cols()
    client = FakeClient(cols)

    result = await job_mod.execute_resolution(
        mongo_uri="mongodb://fake",
        today=out_of_window_date,
        window_days=10,
        search_fn=_make_search_fn(_CLEAN_ANSWER, _AUTH_SOURCES),
        fetch_fn=_make_fetch_fn(("content", "sos.ga.gov")),
        client_factory=lambda uri: client,
    )

    assert result["status"] == "completed"
    counts = result["counts"]
    assert counts["races_checked"] == 0
    assert counts["confirmed"] == 0
    assert counts["flagged"] == 0
    assert counts["errors"] == 0

    run_docs = cols["refresh_runs"].docs
    assert len(run_docs) == 1
    assert run_docs[0]["status"] == "completed"
    assert client.closed is True


# ---------------------------------------------------------------------------
# Test 4: outer exception → refresh_runs "failed" + exception propagates
# ---------------------------------------------------------------------------


class RaisingCol(FakeCol):
    """FakeCol whose find() raises — simulates a Mongo access failure."""

    def find(self, flt: dict | None = None):
        raise RuntimeError("calendar read exploded")


@pytest.mark.asyncio
async def test_outer_failure_marks_refresh_run_failed_and_reraises():
    """If a failure escapes the per-race loop (e.g. calendar load), the
    refresh_runs doc must end status='failed' and the exception must propagate."""
    cols = _ga_cols()
    cols["primary_calendar"] = RaisingCol()
    client = FakeClient(cols)

    with pytest.raises(RuntimeError, match="calendar read exploded"):
        await job_mod.execute_resolution(
            mongo_uri="mongodb://fake",
            today=_TODAY,
            window_days=10,
            search_fn=_make_search_fn(_CLEAN_ANSWER, _AUTH_SOURCES),
            fetch_fn=_make_fetch_fn(("content", "sos.ga.gov")),
            client_factory=lambda uri: client,
        )

    run_docs = cols["refresh_runs"].docs
    assert len(run_docs) == 1
    run = run_docs[0]
    assert run["status"] == "failed"
    assert run["error"] == "calendar read exploded"
    assert run["completed_at"] is not None
    assert client.closed is True


# ---------------------------------------------------------------------------
# Test 5: an already-confirmed race is skipped, never re-resolved or overwritten
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_already_confirmed_race_is_skipped():
    """A race whose race_status is already 'confirmed' must not be re-resolved.

    This protects a human-reviewed/confirmed result from being overwritten on a
    later scheduled run: the race is skipped before checking, no new event is
    appended, and the resolver (search_fn) is never invoked.
    """
    cols = _ga_cols()
    # Seed race_status with this race already confirmed (as the store would write it).
    cols["race_status"] = FakeCol(
        [
            {
                "race_key": GA_RACE_DOC["race_key"],
                "status": "confirmed",
                "winners": {"REP": "Jane Doe"},
                "citation_id": 999,
            }
        ]
    )
    client = FakeClient(cols)

    search_fn, calls = _make_counting_search_fn(_CLEAN_ANSWER, _AUTH_SOURCES)

    result = await job_mod.execute_resolution(
        mongo_uri="mongodb://fake",
        today=_TODAY,
        window_days=10,
        search_fn=search_fn,
        fetch_fn=_make_fetch_fn(("Election results: Jane Doe wins", "sos.ga.gov")),
        client_factory=lambda uri: client,
    )

    assert result["status"] == "completed"
    counts = result["counts"]
    assert counts["races_checked"] == 0
    assert counts["confirmed"] == 0
    assert counts["flagged"] == 0
    assert counts["errors"] == 0

    # The resolver must never have been called for the confirmed race.
    assert calls["n"] == 0

    # No new transition event was appended.
    assert len(cols["race_status_events"].docs) == 0

    # The pre-existing confirmed status doc is untouched (no overwrite).
    status_docs = cols["race_status"].docs
    assert len(status_docs) == 1
    assert status_docs[0]["status"] == "confirmed"
    assert status_docs[0]["citation_id"] == 999


# ---------------------------------------------------------------------------
# Test 6: main() returns 1 when MONGODB_URI missing
# ---------------------------------------------------------------------------


def test_main_returns_1_when_uri_missing(monkeypatch):
    monkeypatch.delenv("MONGODB_URI", raising=False)
    assert job_mod.main() == 1


# ---------------------------------------------------------------------------
# Test 6b: main() returns 1 when PERPLEXITY_API_KEY missing
# ---------------------------------------------------------------------------


def test_main_returns_1_when_perplexity_key_missing(monkeypatch):
    """Regression: a missing PERPLEXITY_API_KEY must fail fast at startup.

    Previously the job started successfully and only surfaced the missing key
    as per-race errors (exit 0 with all races errored — hard to diagnose).
    """
    monkeypatch.setenv("MONGODB_URI", "mongodb://fake")
    monkeypatch.delenv("PERPLEXITY_API_KEY", raising=False)
    assert job_mod.main() == 1


# ---------------------------------------------------------------------------
# Test 7: main() returns 0 on success (monkeypatches execute_resolution)
# ---------------------------------------------------------------------------


def test_main_returns_0_on_success(monkeypatch):
    monkeypatch.setenv("MONGODB_URI", "mongodb://fake")

    async def fake_execute(**kwargs):
        return {"run_id": "abc", "status": "completed", "counts": {}}

    monkeypatch.setattr(job_mod, "execute_resolution", fake_execute)
    assert job_mod.main() == 0


# ---------------------------------------------------------------------------
# Test 8: main() returns 1 on execute_resolution failure
# ---------------------------------------------------------------------------


def test_main_returns_1_on_failure(monkeypatch):
    monkeypatch.setenv("MONGODB_URI", "mongodb://fake")

    async def boom(**kwargs):
        raise RuntimeError("db exploded")

    monkeypatch.setattr(job_mod, "execute_resolution", boom)
    assert job_mod.main() == 1
