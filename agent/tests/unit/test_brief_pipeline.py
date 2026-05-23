"""Unit tests for the deterministic Voter Brief pipeline.

The pipeline must run every step in a fixed order regardless of model whim,
emit one state_delta Event per step (so the live receipt streams), and never
abort the brief when a single slow/failed step (e.g. positions) raises.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

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

    monkeypatch.setattr(brief_pipeline, "resolve_race_from_address", fake_resolve)
    monkeypatch.setattr(brief_pipeline, "fetch_candidate_cards", fake_candidates)
    monkeypatch.setattr(brief_pipeline, "fetch_finance_summaries", fake_finance)
    monkeypatch.setattr(brief_pipeline, "fetch_legislation_records", fake_legislation)
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
    assert stages == ["district", "candidates", "finance", "legislation", "complete"]


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
