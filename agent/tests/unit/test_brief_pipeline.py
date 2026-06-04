"""Unit tests for the deterministic Voter Brief pipeline.

The pipeline must run every step in a fixed order regardless of model whim,
emit one state_delta Event per step (so the live receipt streams), and never
abort the brief when a single slow/failed step (e.g. positions) raises.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.services.evidence.schema import SourceDocumentRef
from app.tools import brief_pipeline
from app.tools.brief_pipeline import VoterBriefPipeline


class _FakeState(dict):
    """Mimics ctx.session.state — a dict that records update() calls."""


def _make_ctx(user_text: str) -> SimpleNamespace:
    session = SimpleNamespace(state=_FakeState())
    content = SimpleNamespace(parts=[SimpleNamespace(text=user_text)])
    return SimpleNamespace(session=session, user_content=content)


def _patch_fetchers(monkeypatch, *, positions_raises: bool = False) -> None:
    async def fake_resolve(address):
        return {"raceKey": "2026-H-WI-04", "stateCode": "WI"}

    async def fake_candidates(race_key):
        return [{"candidateId": "H1", "name": "A", "raceKey": race_key}]

    async def fake_finance(race_key):
        return [{"candidateId": "H1", "name": "A"}]

    async def fake_legislation(race_key):
        return [{"billId": "hr1", "title": "T", "memberName": "A"}]

    async def fake_positions(candidates, state_code):
        if positions_raises:
            raise RuntimeError("perplexity timeout")
        return [{"candidateName": "A", "issue": "housing", "answer": "x", "sources": []}]

    async def fake_voting_record(race_key):
        return {"raceKey": race_key, "incumbentName": "A", "votes": []}

    async def fake_mcp_count(collection, query):
        return 4

    monkeypatch.setattr(brief_pipeline, "resolve_race_from_address", fake_resolve)
    monkeypatch.setattr(brief_pipeline, "fetch_candidate_cards", fake_candidates)
    monkeypatch.setattr(brief_pipeline, "fetch_finance_summaries", fake_finance)
    monkeypatch.setattr(brief_pipeline, "fetch_legislation_records", fake_legislation)
    monkeypatch.setattr(brief_pipeline, "fetch_voting_record", fake_voting_record)
    monkeypatch.setattr(brief_pipeline, "mongodb_mcp_count", fake_mcp_count)
    monkeypatch.setattr(brief_pipeline, "gather_candidate_positions", fake_positions)


async def _collect_deltas(pipeline, ctx) -> list[dict]:
    deltas: list[dict] = []
    async for event in pipeline._run_async_impl(ctx):
        deltas.append(event.actions.state_delta)
    return deltas


@pytest.mark.unit
@pytest.mark.asyncio
async def test_pipeline_runs_every_step_in_fixed_order(monkeypatch):
    _patch_fetchers(monkeypatch)
    pipeline = VoterBriefPipeline(name="voter_brief_pipeline")
    ctx = _make_ctx("Build a complete voter brief for: 123 Oak St, Racine WI")

    deltas = await _collect_deltas(pipeline, ctx)

    stages = [d["stage"] for d in deltas if "stage" in d]
    assert stages == [
        "district", "candidates", "mcp", "finance", "legislation",
        "positions", "archiving", "complete",
    ]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mcp_step_reports_partner_count(monkeypatch):
    _patch_fetchers(monkeypatch)
    pipeline = VoterBriefPipeline(name="voter_brief_pipeline")
    ctx = _make_ctx("Build a complete voter brief for: 123 Oak St, Racine WI")

    deltas = await _collect_deltas(pipeline, ctx)

    mcp = next(d for d in deltas if d.get("stage") == "mcp")
    assert "MongoDB MCP confirmed 4 candidate filings" in mcp["status_message"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_each_step_writes_expected_keys(monkeypatch):
    _patch_fetchers(monkeypatch)
    pipeline = VoterBriefPipeline(name="voter_brief_pipeline")
    ctx = _make_ctx("Build a complete voter brief for: 123 Oak St, Racine WI")

    deltas = await _collect_deltas(pipeline, ctx)

    by_stage = {d["stage"]: d for d in deltas if "stage" in d}
    assert by_stage["district"]["currentRaceKey"] == "2026-H-WI-04"
    assert by_stage["district"]["mapFocus"] == "WI"
    assert "candidates" in by_stage["candidates"]
    assert "finance" in by_stage["finance"]
    assert "legislation" in by_stage["legislation"]
    assert "positions" in by_stage["complete"]
    assert by_stage["complete"]["briefReady"] is True
    assert by_stage["complete"]["status_message"] == ""


@pytest.mark.unit
@pytest.mark.asyncio
async def test_session_state_is_updated_per_step(monkeypatch):
    _patch_fetchers(monkeypatch)
    pipeline = VoterBriefPipeline(name="voter_brief_pipeline")
    ctx = _make_ctx("Build a complete voter brief for: 123 Oak St, Racine WI")

    await _collect_deltas(pipeline, ctx)

    assert ctx.session.state["currentRaceKey"] == "2026-H-WI-04"
    assert ctx.session.state["briefReady"] is True
    assert ctx.session.state["stage"] == "complete"


@pytest.mark.unit
def test_trigger_detection_address_vs_race_key():
    assert brief_pipeline.extract_brief_address("Build a complete voter brief for: 123 Oak St")
    assert brief_pipeline.extract_brief_address("Build a complete voter brief for race: 2026-H-WI-04") is None
    assert (
        brief_pipeline.extract_brief_race_key("Build a complete voter brief for race: 2026-H-WI-04")
        == "2026-H-WI-04"
    )
    assert brief_pipeline.extract_brief_race_key("Build a complete voter brief for: 123 Oak St") is None
    assert brief_pipeline.is_brief_trigger("Build a complete voter brief for race: 2026-S-GA-00")
    assert not brief_pipeline.is_brief_trigger("Show me all 2026 congressional races in WI")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_race_key_trigger_skips_geocoding(monkeypatch):
    _patch_fetchers(monkeypatch)

    async def fail_resolve(address):
        raise AssertionError("must not geocode when a race key is supplied")

    monkeypatch.setattr(brief_pipeline, "resolve_race_from_address", fail_resolve)
    pipeline = VoterBriefPipeline(name="voter_brief_pipeline")
    ctx = _make_ctx("Build a complete voter brief for race: 2026-H-WI-04")

    deltas = await _collect_deltas(pipeline, ctx)

    by_stage = {d["stage"]: d for d in deltas if "stage" in d}
    assert by_stage["district"]["currentRaceKey"] == "2026-H-WI-04"
    assert by_stage["district"]["mapFocus"] == "WI"
    assert by_stage["complete"]["briefReady"] is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_failing_positions_step_does_not_abort_brief(monkeypatch):
    _patch_fetchers(monkeypatch, positions_raises=True)
    pipeline = VoterBriefPipeline(name="voter_brief_pipeline")
    ctx = _make_ctx("Build a complete voter brief for: 123 Oak St, Racine WI")

    deltas = await _collect_deltas(pipeline, ctx)

    stages = [d["stage"] for d in deltas if "stage" in d]
    assert "complete" in stages
    complete = next(d for d in deltas if d.get("stage") == "complete")
    assert complete["briefReady"] is True
    assert complete["positions"] == []


@pytest.mark.unit
def test_pipeline_imports_voting_record_fetcher():
    # The deterministic pipeline must call the voting-record core as a step.
    import app.tools.brief_pipeline as bp
    assert hasattr(bp, "fetch_voting_record")


# ---------------------------------------------------------------------------
# T3 — source archival wired into the pipeline
# ---------------------------------------------------------------------------


def _ref(doc_id: str) -> SourceDocumentRef:
    return SourceDocumentRef(
        id=doc_id,
        url="stored",
        fetched_at=datetime(2026, 6, 4, tzinfo=UTC),
        content_hash="hash",
    )


def _src(url: str, **extra) -> dict:
    return {"title": "T", "url": url, "date": None, "snippet": "s", **extra}


def _card(sources: list[dict]) -> dict:
    return {
        "candidateName": "A",
        "issue": "housing",
        "answer": "x",
        "evidenceType": "reported",
        "sources": sources,
    }


async def _complete_delta(monkeypatch, cards: list[dict], fetch):
    """Run the brief with archival; return (complete_delta, all_deltas)."""
    _patch_fetchers(monkeypatch)

    async def fake_positions(candidates, state_code):
        return cards

    monkeypatch.setattr(brief_pipeline, "gather_candidate_positions", fake_positions)
    monkeypatch.setattr(brief_pipeline, "fetch_and_store_source", fetch)

    pipeline = VoterBriefPipeline(name="voter_brief_pipeline")
    ctx = _make_ctx("Build a complete voter brief for: 123 Oak St, Racine WI")
    deltas = await _collect_deltas(pipeline, ctx)
    complete = next(d for d in deltas if d.get("stage") == "complete")
    return complete, deltas


@pytest.mark.unit
def test_pipeline_imports_evidence_store():
    """T3 wiring: the pipeline must reference the evidence-store entry points."""
    assert hasattr(brief_pipeline, "fetch_and_store_source")
    assert hasattr(brief_pipeline, "SourceDocumentRef")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_archiving_stage_precedes_complete(monkeypatch):
    async def fetch(url):
        return _ref("doc1")

    _, deltas = await _complete_delta(monkeypatch, [_card([_src("https://a.gov/p")])], fetch)
    stages = [d["stage"] for d in deltas if "stage" in d]
    assert stages.index("archiving") < stages.index("complete")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_archived_source_carries_archival_fields(monkeypatch):
    async def fetch(url):
        return _ref("doc1")

    complete, _ = await _complete_delta(monkeypatch, [_card([_src("https://a.gov/p")])], fetch)
    src = complete["positions"][0]["sources"][0]
    assert src["archived"] is True
    assert src["archivedAt"] == "2026-06-04T00:00:00+00:00"
    assert src["sourceDocumentId"] == "doc1"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_unarchived_source_keeps_original_fields(monkeypatch):
    async def fetch(url):
        return None  # e.g. Firecrawl key unset / over budget

    complete, _ = await _complete_delta(monkeypatch, [_card([_src("https://a.gov/p")])], fetch)
    src = complete["positions"][0]["sources"][0]
    assert "archived" not in src
    assert src["url"] == "https://a.gov/p"
    assert complete["briefReady"] is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_duplicate_urls_fetched_once(monkeypatch):
    url = "https://a.gov/p"
    calls: list[str] = []

    async def fetch(u):
        calls.append(u)
        return _ref("doc1")

    cards = [_card([_src(url)]), _card([_src(url)])]
    await _complete_delta(monkeypatch, cards, fetch)
    assert len(calls) == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_archive_fetches_capped_at_12(monkeypatch):
    calls: list[str] = []

    async def fetch(u):
        calls.append(u)
        return _ref("doc1")

    sources = [_src(f"https://a.gov/p{i}") for i in range(15)]
    await _complete_delta(monkeypatch, [_card(sources)], fetch)
    assert len(calls) == 12


@pytest.mark.unit
@pytest.mark.asyncio
async def test_slow_source_times_out_gracefully(monkeypatch):
    monkeypatch.setattr(brief_pipeline, "_ARCHIVE_TIMEOUT_SECONDS", 0.01)

    async def slow_fetch(url):
        await asyncio.sleep(1)
        return _ref("doc1")

    complete, _ = await _complete_delta(monkeypatch, [_card([_src("https://a.gov/p")])], slow_fetch)
    src = complete["positions"][0]["sources"][0]
    assert "archived" not in src
    assert complete["briefReady"] is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_archive_fetch_raising_does_not_abort_brief(monkeypatch):
    async def boom(url):
        raise RuntimeError("firecrawl down")

    complete, _ = await _complete_delta(monkeypatch, [_card([_src("https://a.gov/p")])], boom)
    assert complete["briefReady"] is True
    assert "archived" not in complete["positions"][0]["sources"][0]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_enrich_does_not_mutate_input_sources(monkeypatch):
    original = _src("https://a.gov/p")

    async def fetch(url):
        return _ref("doc1")

    await _complete_delta(monkeypatch, [_card([original])], fetch)
    assert "archived" not in original  # the input source dict is untouched


@pytest.mark.unit
@pytest.mark.asyncio
async def test_empty_positions_archiving_is_noop(monkeypatch):
    async def fetch(url):
        raise AssertionError("must not fetch when there are no positions")

    _patch_fetchers(monkeypatch)

    async def no_positions(candidates, state_code):
        return []

    monkeypatch.setattr(brief_pipeline, "gather_candidate_positions", no_positions)
    monkeypatch.setattr(brief_pipeline, "fetch_and_store_source", fetch)

    pipeline = VoterBriefPipeline(name="voter_brief_pipeline")
    ctx = _make_ctx("Build a complete voter brief for: 123 Oak St, Racine WI")
    deltas = await _collect_deltas(pipeline, ctx)

    stages = [d["stage"] for d in deltas if "stage" in d]
    complete = next(d for d in deltas if d.get("stage") == "complete")
    assert "archiving" in stages
    assert complete["positions"] == []
    assert complete["briefReady"] is True
