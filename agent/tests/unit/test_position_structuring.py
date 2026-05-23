"""Unit tests for the second-pass position structuring in position_search.

Covers structure_positions (Gemini JSON → per-issue EvidenceCard dicts),
its fallback on bad JSON, source_indices mapping, and the parallel
gather_candidate_positions orchestration (one failing candidate must not
abort the others).
"""

from __future__ import annotations

import json

import pytest

from app.tools import position_search
from app.tools.position_search import (
    _search_name,
    gather_candidate_positions,
    structure_positions,
)


@pytest.mark.parametrize(
    "fec_name, expected",
    [
        ("Donahue, Amy", "Amy Donahue"),
        ("Keith, Purnima", "Purnima Keith"),
        ("Moore, Gwen S", "Gwen S Moore"),
        ("Gwen Moore", "Gwen Moore"),  # already natural, unchanged
    ],
)
def test_search_name_normalizes_fec_format(fec_name: str, expected: str) -> None:
    # Regression: FEC "Last, First" names search Perplexity poorly; normalize
    # to natural order so stance/news lookups actually find the candidate.
    assert _search_name(fec_name) == expected

_SOURCES = [
    {"title": "Campaign site", "url": "https://x", "date": "2026-03-01", "snippet": "a"},
    {"title": "Press release", "url": "https://y", "date": "2026-02-01", "snippet": "b"},
]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_structures_broad_answer_into_issue_cards(monkeypatch):
    fake_json = json.dumps(
        {
            "positions": [
                {
                    "issue": "housing",
                    "statement": "Backs the Housing Affordability Act",
                    "source_indices": [0],
                },
                {
                    "issue": "economy",
                    "statement": "Supports small-business tax relief",
                    "source_indices": [1],
                },
            ]
        }
    )
    monkeypatch.setattr(
        position_search, "_structure_with_gemini", lambda *a, **k: fake_json
    )

    cards = await structure_positions("Gwen Moore", "broad answer text", _SOURCES)

    assert len(cards) == 2
    housing = cards[0]
    assert housing["issue"] == "housing"
    assert housing["candidateName"] == "Gwen Moore"
    assert housing["answer"] == "Backs the Housing Affordability Act"
    assert housing["sources"][0]["url"] == "https://x"
    assert cards[1]["sources"][0]["url"] == "https://y"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_falls_back_to_single_card_on_bad_json(monkeypatch):
    monkeypatch.setattr(
        position_search, "_structure_with_gemini", lambda *a, **k: "not json at all"
    )

    cards = await structure_positions("Gwen Moore", "the broad answer", _SOURCES)

    assert len(cards) == 1
    card = cards[0]
    assert card["candidateName"] == "Gwen Moore"
    assert card["issue"] == "key positions"
    assert card["answer"] == "the broad answer"
    assert card["sources"] == _SOURCES


@pytest.mark.unit
@pytest.mark.asyncio
async def test_falls_back_when_gemini_raises(monkeypatch):
    def boom(*_args, **_kwargs):
        raise RuntimeError("gemini exploded")

    monkeypatch.setattr(position_search, "_structure_with_gemini", boom)

    cards = await structure_positions("Gwen Moore", "broad", _SOURCES)

    assert len(cards) == 1
    assert cards[0]["issue"] == "key positions"
    assert cards[0]["answer"] == "broad"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_out_of_range_source_indices_are_skipped(monkeypatch):
    fake_json = json.dumps(
        {
            "positions": [
                {"issue": "housing", "statement": "s", "source_indices": [0, 9]},
            ]
        }
    )
    monkeypatch.setattr(
        position_search, "_structure_with_gemini", lambda *a, **k: fake_json
    )

    cards = await structure_positions("Gwen Moore", "broad", _SOURCES)

    assert len(cards[0]["sources"]) == 1
    assert cards[0]["sources"][0]["url"] == "https://x"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_gather_skips_failing_candidate(monkeypatch):
    async def fake_broad(name, state_code):
        if name == "Bad Candidate":
            raise RuntimeError("perplexity down")
        return ("broad answer", _SOURCES)

    monkeypatch.setattr(position_search, "_broad_search", fake_broad)
    monkeypatch.setattr(
        position_search,
        "_structure_with_gemini",
        lambda *a, **k: json.dumps(
            {"positions": [{"issue": "housing", "statement": "s", "source_indices": [0]}]}
        ),
    )

    candidates = [{"name": "Good Candidate"}, {"name": "Bad Candidate"}]
    cards = await gather_candidate_positions(candidates, "WI")

    names = {c["candidateName"] for c in cards}
    assert "Good Candidate" in names
    assert "Bad Candidate" not in names
    assert len(cards) == 1
