"""Tests for the refresh_positions Cloud Run Job (position-search redesign T3).

Covers the priority-set selection, the Firecrawl budget guard (deep→shallow
downgrade), the orchestration loop, the refresh_runs audit, and main(). All
Mongo is a fake collection and every network call (research/upsert/usage) is
injected — zero real I/O.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.jobs import refresh_positions
from app.jobs.refresh_positions import (
    DEFAULT_DOWNGRADE_PCT,
    DEFAULT_MONTHLY_CAP,
    _choose_tier,
    count_monthly_fetches,
    execute_refresh_positions,
    select_priority_candidates,
)
from app.services.positions.schema import STATUS_EMPTY, STATUS_FOUND

NOW = datetime(2026, 6, 4, 12, 0, tzinfo=UTC)


# ---------------------------------------------------------------------------
# Fake Mongo
# ---------------------------------------------------------------------------


class FakeCol:
    def __init__(self, seed: list[dict] | None = None) -> None:
        self.docs: list[dict] = [dict(d) for d in (seed or [])]

    @staticmethod
    def _matches(doc: dict, flt: dict) -> bool:
        for key, cond in flt.items():
            if isinstance(cond, dict) and "$in" in cond:
                if doc.get(key) not in cond["$in"]:
                    return False
            elif doc.get(key) != cond:
                return False
        return True

    def find(self, flt: dict | None = None, projection=None):
        flt = flt or {}
        return [dict(d) for d in self.docs if self._matches(d, flt)]

    def find_one(self, flt: dict, sort=None):
        matches = [d for d in self.docs if self._matches(d, flt)]
        if sort:
            key, direction = sort[0]
            matches.sort(key=lambda d: d.get(key), reverse=(direction == -1))
        return matches[0] if matches else None

    def insert_one(self, doc: dict):
        self.docs.append(dict(doc))
        return type("R", (), {"inserted_id": len(self.docs)})()

    def update_one(self, flt: dict, update: dict, upsert: bool = False):
        doc = self.find_one(flt)
        if doc is None and upsert:
            doc = dict(flt)
            self.docs.append(doc)
        target = next((d for d in self.docs if self._matches(d, flt)), None)
        if target is not None:
            target.update(update.get("$set", {}))
            for field, value in update.get("$push", {}).items():
                target.setdefault(field, []).append(value)
        return type("R", (), {"modified_count": 1 if target else 0})()


class FakeDB:
    def __init__(self, cols: dict[str, FakeCol]) -> None:
        self._cols = cols

    def __getitem__(self, name: str) -> FakeCol:
        return self._cols.setdefault(name, FakeCol())

    def __getattr__(self, name: str) -> FakeCol:
        return self._cols.setdefault(name, FakeCol())


class FakeClient:
    def __init__(self, cols: dict[str, FakeCol]) -> None:
        self._db = FakeDB(cols)
        self.closed = False

    def __getitem__(self, name: str) -> FakeDB:
        assert name == "districtlens"
        return self._db

    def close(self) -> None:
        self.closed = True


def _client_factory(cols: dict[str, FakeCol]):
    def _make(uri: str) -> FakeClient:
        return FakeClient(cols)

    return _make


# ---------------------------------------------------------------------------
# Budget guard
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_choose_tier_deep_below_threshold():
    assert _choose_tier(3999, monthly_cap=5000, downgrade_pct=0.8) == "deep"


@pytest.mark.unit
def test_choose_tier_shallow_at_threshold():
    assert _choose_tier(4000, monthly_cap=5000, downgrade_pct=0.8) == "shallow"


@pytest.mark.unit
def test_defaults_are_5000_and_80pct():
    assert DEFAULT_MONTHLY_CAP == 5000
    assert DEFAULT_DOWNGRADE_PCT == 0.8


@pytest.mark.unit
def test_count_monthly_fetches_counts_current_month():
    this_month = {"fetched_at": datetime(2026, 6, 1, tzinfo=UTC), "content_hash": "a"}
    col = FakeCol([{"url": "u1", "retrieval_history": [this_month, this_month]}])
    db = FakeDB({"source_documents": col})
    assert count_monthly_fetches(db, now=NOW) == 2


@pytest.mark.unit
def test_count_monthly_fetches_excludes_prior_month():
    last_month = {"fetched_at": datetime(2026, 5, 20, tzinfo=UTC), "content_hash": "a"}
    this_month = {"fetched_at": datetime(2026, 6, 2, tzinfo=UTC), "content_hash": "b"}
    col = FakeCol([{"url": "u1", "retrieval_history": [last_month, this_month]}])
    db = FakeDB({"source_documents": col})
    assert count_monthly_fetches(db, now=NOW) == 1


# ---------------------------------------------------------------------------
# Priority-set selection
# ---------------------------------------------------------------------------


def _selection_db() -> FakeDB:
    candidates = FakeCol(
        [
            {"candidate_id": "INC1", "name": "Roe, Sam", "party": "REP",
             "race_key": "2026-H-TX-01", "incumbent_challenge_status": "incumbent"},
            {"candidate_id": "NOM1", "name": "Doe, Jane", "party": "DEM",
             "race_key": "2026-H-GA-06", "incumbent_challenge_status": "challenger"},
            {"candidate_id": "LOSE1", "name": "Lim, Pat", "party": "REP",
             "race_key": "2026-H-GA-06", "incumbent_challenge_status": "challenger"},
            {"candidate_id": "RICH1", "name": "Gold, Ann", "party": "DEM",
             "race_key": "2026-S-CA-00", "incumbent_challenge_status": "open_seat"},
            {"candidate_id": "POOR1", "name": "Few, Bob", "party": "REP",
             "race_key": "2026-S-CA-00", "incumbent_challenge_status": "open_seat"},
        ]
    )
    race_status = FakeCol(
        [{"race_key": "2026-H-GA-06", "status": "confirmed",
          "winners": {"DEM": "Jane Doe"}, "losers": ["Pat Lim"]}]
    )
    finance = FakeCol(
        [
            {"candidate_id": "RICH1", "receipts": 5_000_000},
            {"candidate_id": "POOR1", "receipts": 1_000},
            {"candidate_id": "INC1", "receipts": 200_000},
        ]
    )
    return FakeDB(
        {"candidates": candidates, "race_status": race_status, "finance_summaries": finance}
    )


@pytest.mark.unit
def test_selection_includes_incumbents():
    picked = {c["candidate_id"] for c in select_priority_candidates(_selection_db())}
    assert "INC1" in picked


@pytest.mark.unit
def test_selection_includes_confirmed_nominee_by_name():
    picked = {c["candidate_id"] for c in select_priority_candidates(_selection_db())}
    assert "NOM1" in picked  # matched winner "Jane Doe" → FEC "Doe, Jane"


@pytest.mark.unit
def test_selection_excludes_confirmed_race_loser():
    picked = {c["candidate_id"] for c in select_priority_candidates(_selection_db())}
    assert "LOSE1" not in picked  # not a winner, not funded, not incumbent


@pytest.mark.unit
def test_selection_includes_top_funded():
    picked = {c["candidate_id"] for c in select_priority_candidates(_selection_db(), top_funded_limit=1)}
    assert "RICH1" in picked


@pytest.mark.unit
def test_selection_dedups_across_buckets():
    ids = [c["candidate_id"] for c in select_priority_candidates(_selection_db())]
    assert len(ids) == len(set(ids))


@pytest.mark.unit
def test_selection_returns_research_fields():
    cand = next(c for c in select_priority_candidates(_selection_db()) if c["candidate_id"] == "INC1")
    for key in ("candidate_id", "name", "party", "race_key"):
        assert key in cand


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def _research_recorder(status: str = STATUS_FOUND):
    calls = []

    async def _fn(candidate: dict, *, tier: str):
        calls.append((candidate["candidate_id"], tier))
        return {
            "candidate_id": candidate["candidate_id"],
            "status": status,
            "positions": (
                [{"sources": [{"sourceDocumentId": "d1"}]}] if status == STATUS_FOUND else []
            ),
        }

    _fn.calls = calls  # type: ignore[attr-defined]
    return _fn


def _upsert_recorder():
    saved = []

    async def _fn(doc: dict, *, db=None):
        saved.append(doc)

    _fn.saved = saved  # type: ignore[attr-defined]
    return _fn


def _two_candidates():
    return [
        {"candidate_id": "A", "name": "A, A", "party": "DEM", "race_key": "2026-H-GA-06"},
        {"candidate_id": "B", "name": "B, B", "party": "REP", "race_key": "2026-H-GA-07"},
    ]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_run_calls_research_and_upsert_per_candidate():
    research = _research_recorder()
    upsert = _upsert_recorder()
    cols: dict[str, FakeCol] = {}
    result = await execute_refresh_positions(
        mongo_uri="mongodb://x",
        research_fn=research,
        upsert_fn=upsert,
        usage_fn=lambda db, *, now: 0,
        select_fn=lambda db, **kw: _two_candidates(),
        client_factory=_client_factory(cols),
        now_fn=lambda: NOW,
    )
    assert len(research.calls) == 2  # type: ignore[attr-defined]
    assert len(upsert.saved) == 2  # type: ignore[attr-defined]
    assert result["status"] == "completed"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_run_passes_shallow_tier_when_over_budget():
    research = _research_recorder()
    cols: dict[str, FakeCol] = {}
    await execute_refresh_positions(
        mongo_uri="mongodb://x",
        research_fn=research,
        upsert_fn=_upsert_recorder(),
        usage_fn=lambda db, *, now: 4000,  # at 80% of 5000
        select_fn=lambda db, **kw: _two_candidates(),
        client_factory=_client_factory(cols),
        now_fn=lambda: NOW,
    )
    assert all(tier == "shallow" for _, tier in research.calls)  # type: ignore[attr-defined]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_run_uses_deep_tier_when_under_budget():
    research = _research_recorder()
    cols: dict[str, FakeCol] = {}
    await execute_refresh_positions(
        mongo_uri="mongodb://x",
        research_fn=research,
        upsert_fn=_upsert_recorder(),
        usage_fn=lambda db, *, now: 0,
        select_fn=lambda db, **kw: _two_candidates(),
        client_factory=_client_factory(cols),
        now_fn=lambda: NOW,
    )
    assert all(tier == "deep" for _, tier in research.calls)  # type: ignore[attr-defined]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_run_tallies_found_and_empty():
    cols: dict[str, FakeCol] = {}
    result = await execute_refresh_positions(
        mongo_uri="mongodb://x",
        research_fn=_research_recorder(status=STATUS_EMPTY),
        upsert_fn=_upsert_recorder(),
        usage_fn=lambda db, *, now: 0,
        select_fn=lambda db, **kw: _two_candidates(),
        client_factory=_client_factory(cols),
        now_fn=lambda: NOW,
    )
    assert result["counts"]["no_positions"] == 2
    assert result["counts"]["found"] == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_run_tallies_deep_vs_shallow():
    cols: dict[str, FakeCol] = {}
    result = await execute_refresh_positions(
        mongo_uri="mongodb://x",
        research_fn=_research_recorder(),
        upsert_fn=_upsert_recorder(),
        usage_fn=lambda db, *, now: 0,
        select_fn=lambda db, **kw: _two_candidates(),
        client_factory=_client_factory(cols),
        now_fn=lambda: NOW,
    )
    assert result["counts"]["deep"] == 2
    assert result["counts"]["shallow"] == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_run_one_candidate_error_does_not_abort():
    calls = {"n": 0}

    async def _flaky(candidate: dict, *, tier: str):
        calls["n"] += 1
        if candidate["candidate_id"] == "A":
            raise RuntimeError("boom")
        return {"candidate_id": "B", "status": STATUS_FOUND, "positions": []}

    cols: dict[str, FakeCol] = {}
    result = await execute_refresh_positions(
        mongo_uri="mongodb://x",
        research_fn=_flaky,
        upsert_fn=_upsert_recorder(),
        usage_fn=lambda db, *, now: 0,
        select_fn=lambda db, **kw: _two_candidates(),
        client_factory=_client_factory(cols),
        now_fn=lambda: NOW,
    )
    assert calls["n"] == 2  # both attempted
    assert result["counts"]["errors"] == 1
    assert result["status"] == "completed"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_run_per_run_limit_caps_candidates():
    research = _research_recorder()
    cols: dict[str, FakeCol] = {}
    await execute_refresh_positions(
        mongo_uri="mongodb://x",
        research_fn=research,
        upsert_fn=_upsert_recorder(),
        usage_fn=lambda db, *, now: 0,
        select_fn=lambda db, **kw: _two_candidates(),
        client_factory=_client_factory(cols),
        now_fn=lambda: NOW,
        per_run_limit=1,
    )
    assert len(research.calls) == 1  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Audit doc + client lifecycle
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_audit_doc_written_and_completed():
    cols: dict[str, FakeCol] = {}
    await execute_refresh_positions(
        mongo_uri="mongodb://x",
        research_fn=_research_recorder(),
        upsert_fn=_upsert_recorder(),
        usage_fn=lambda db, *, now: 0,
        select_fn=lambda db, **kw: _two_candidates(),
        client_factory=_client_factory(cols),
        now_fn=lambda: NOW,
    )
    runs = cols["refresh_runs"].docs
    assert len(runs) == 1
    assert runs[0]["job_name"] == "refresh_positions"
    assert runs[0]["status"] == "completed"
    assert runs[0]["counts"]["candidates"] == 2


@pytest.mark.unit
@pytest.mark.asyncio
async def test_failure_records_failed_audit_and_reraises():
    def _bad_select(db, **kw):
        raise RuntimeError("selection blew up")

    cols: dict[str, FakeCol] = {}
    with pytest.raises(RuntimeError):
        await execute_refresh_positions(
            mongo_uri="mongodb://x",
            research_fn=_research_recorder(),
            upsert_fn=_upsert_recorder(),
            usage_fn=lambda db, *, now: 0,
            select_fn=_bad_select,
            client_factory=_client_factory(cols),
            now_fn=lambda: NOW,
        )
    assert cols["refresh_runs"].docs[0]["status"] == "failed"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_client_always_closed():
    cols: dict[str, FakeCol] = {}
    client_holder = {}

    def _factory(uri: str):
        client = FakeClient(cols)
        client_holder["c"] = client
        return client

    await execute_refresh_positions(
        mongo_uri="mongodb://x",
        research_fn=_research_recorder(),
        upsert_fn=_upsert_recorder(),
        usage_fn=lambda db, *, now: 0,
        select_fn=lambda db, **kw: _two_candidates(),
        client_factory=_factory,
        now_fn=lambda: NOW,
    )
    assert client_holder["c"].closed is True


# ---------------------------------------------------------------------------
# main()
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_main_returns_1_without_mongo_uri(monkeypatch):
    monkeypatch.delenv("MONGODB_URI", raising=False)
    assert refresh_positions.main() == 1


# ---------------------------------------------------------------------------
# Warm-mode additions: bp_url threading, race scoping, forced broad tier,
# freshness skip (position-search broad-tier warm job)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_research_view_threads_ballotpedia_url():
    from app.jobs.refresh_positions import _research_view

    view = _research_view(
        {"candidate_id": "X", "name": "Doe, Jane", "party": "DEM",
         "race_key": "2026-H-WI-04", "ballotpedia_profile_url": "https://ballotpedia.org/Jane_Doe"}
    )
    assert view["ballotpedia_url"] == "https://ballotpedia.org/Jane_Doe"


@pytest.mark.unit
def test_select_race_candidates_returns_every_candidate_in_the_races():
    from app.jobs.refresh_positions import select_race_candidates

    db = _selection_db()
    picked = {c["candidate_id"] for c in select_race_candidates(db, ["2026-H-GA-06"])}
    assert picked == {"NOM1", "LOSE1"}  # all of the race, incl. the challenger


@pytest.mark.unit
@pytest.mark.parametrize("value", ["true", "1", "yes", "on", "TRUE"])
def test_force_env_disables_freshness_skip(monkeypatch, value):
    from app.jobs.refresh_positions import _cached_fn_from_env

    monkeypatch.setenv("POSITIONS_REFRESH_FORCE", value)
    assert _cached_fn_from_env() is None  # None => no skip, re-research everything


@pytest.mark.unit
def test_no_force_env_keeps_freshness_cache(monkeypatch):
    from app.jobs.refresh_positions import _cached_fn_from_env, get_cached_positions

    monkeypatch.delenv("POSITIONS_REFRESH_FORCE", raising=False)
    assert _cached_fn_from_env() is get_cached_positions


@pytest.mark.unit
@pytest.mark.asyncio
async def test_run_forces_broad_tier_for_every_candidate():
    research = _research_recorder()
    result = await execute_refresh_positions(
        mongo_uri="mongodb://x",
        research_fn=research,
        upsert_fn=_upsert_recorder(),
        usage_fn=lambda db, *, now: 0,
        select_fn=lambda db, **kw: _two_candidates(),
        client_factory=_client_factory({}),
        now_fn=lambda: NOW,
        force_tier="broad",
        cached_fn=None,
    )
    assert {tier for _cid, tier in research.calls} == {"broad"}  # type: ignore[attr-defined]
    assert result["counts"]["broad"] == 2


@pytest.mark.unit
@pytest.mark.asyncio
async def test_run_skips_candidates_already_freshly_cached():
    research = _research_recorder()

    async def fake_cached(cid, *, db=None):
        return {"candidate_id": cid} if cid == "A" else None  # A is fresh, B is not

    result = await execute_refresh_positions(
        mongo_uri="mongodb://x",
        research_fn=research,
        upsert_fn=_upsert_recorder(),
        usage_fn=lambda db, *, now: 0,
        select_fn=lambda db, **kw: _two_candidates(),
        client_factory=_client_factory({}),
        now_fn=lambda: NOW,
        force_tier="broad",
        cached_fn=fake_cached,
    )
    researched = {cid for cid, _tier in research.calls}  # type: ignore[attr-defined]
    assert researched == {"B"}  # A was skipped as fresh
    assert result["counts"]["skipped"] == 1
