"""Tests for the ``broad`` research tier (Ballotpedia-anchored Perplexity synthesis).

The broad tier is the rich path restored to the live brief: one open-ended,
disambiguated Perplexity call per candidate, structured into per-issue cards by
Gemini. It exists because the deep scrape tier is too slow to run live and the
shallow per-issue fan-out under-disambiguates challengers (see prompt design).

Guardrails under test:
- the broad prompt spells out the district (so it is human/news-readable) AND
  anchors on the candidate's Ballotpedia URL when present (the identity handle);
- a "no information" Perplexity answer becomes an honest empty, never a card
  (this also covers the curly-apostrophe leak the shallow filter missed);
- structuring is injected, so these tests do zero real I/O;
- the tier NEVER raises.
"""

from __future__ import annotations

import pytest

from app.services.positions.research import (
    _broad_prompt,
    _is_no_info_answer,
    research_candidate_positions,
)
from app.services.positions.schema import STATUS_EMPTY, STATUS_FOUND

CANDIDATE = {
    "candidate_id": "H6WI04071",
    "name": "Donahue, Amy",
    "party": "DEM",
    "race_key": "2026-H-WI-04",
    "ballotpedia_url": "https://ballotpedia.org/Amy_Donahue",
}


def _src(url: str) -> dict:
    return {"title": url, "url": url, "date": None, "snippet": "s"}


# ---------------------------------------------------------------------------
# Prompt disambiguation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_broad_prompt_spells_out_the_district() -> None:
    prompt = _broad_prompt(CANDIDATE)
    assert "Wisconsin's 4th Congressional District" in prompt


@pytest.mark.unit
def test_broad_prompt_anchors_on_ballotpedia_url_when_present() -> None:
    assert "ballotpedia.org/Amy_Donahue" in _broad_prompt(CANDIDATE)


@pytest.mark.unit
def test_broad_prompt_omits_anchor_when_no_ballotpedia_url() -> None:
    no_bp = {k: v for k, v in CANDIDATE.items() if k != "ballotpedia_url"}
    assert "Ballotpedia profile is" not in _broad_prompt(no_bp)


@pytest.mark.unit
def test_broad_prompt_reads_a_senate_seat_as_statewide() -> None:
    senate = {**CANDIDATE, "race_key": "2026-S-WI-00"}
    prompt = _broad_prompt(senate)
    assert "Congressional District" not in prompt
    assert "Wisconsin" in prompt


# ---------------------------------------------------------------------------
# No-info gate (also the curly-apostrophe regression)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_no_info_answer_catches_a_curly_apostrophe() -> None:
    # U+2019 apostrophe — the exact char the shallow filter missed in production.
    assert _is_no_info_answer("I couldn’t find any credible source for her stance")


@pytest.mark.unit
@pytest.mark.parametrize(
    "text",
    [
        "There is no specific, publicly documented position on health insurance",
        "There are no detailed comments available on tax rates",
        "There is no publicly documented position on K-12 education",
        "No public evidence shows that she is an announced candidate",
        "I could not find any credible source documenting her positions",
        "I was unable to locate any reliable public information about an Amy Donahue",
        "I could not identify a campaign platform for this candidate",
    ],
)
def test_no_info_answer_catches_phrasing_variants(text: str) -> None:
    assert _is_no_info_answer(text)


@pytest.mark.unit
@pytest.mark.parametrize(
    "text",
    [
        "Supports expanding access to and affordability of health care",
        "Prioritizes economic justice as a top campaign issue",
        "Backs a federal assault-weapons ban and universal background checks",
    ],
)
def test_no_info_answer_does_not_flag_a_real_stance(text: str) -> None:
    assert not _is_no_info_answer(text)


# ---------------------------------------------------------------------------
# The broad tier
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_broad_tier_returns_structured_positions() -> None:
    async def fake_search(prompt: str) -> tuple[str, list[dict]]:
        return ("Amy Donahue supports Medicare for All. [1]", [_src("https://amydonahueforcongress.com")])

    async def fake_structure(name: str, answer: str, sources: list[dict]) -> list[dict]:
        return [
            {"candidateName": name, "issue": "health care", "answer": "Supports Medicare for All",
             "evidenceType": "direct_quote", "sources": sources},
        ]

    doc = await research_candidate_positions(
        CANDIDATE, tier="broad", search_fn=fake_search, broad_structure_fn=fake_structure
    )
    assert doc["research_tier"] == "broad"
    assert doc["status"] == STATUS_FOUND
    assert doc["positions"][0]["issue"] == "health care"
    assert doc["positions"][0]["evidenceType"] == "direct_quote"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_broad_tier_no_info_answer_is_an_honest_empty() -> None:
    async def fake_search(prompt: str) -> tuple[str, list[dict]]:
        return ("I could not find any credible source documenting her positions.", [_src("https://x")])

    async def fake_structure(name: str, answer: str, sources: list[dict]) -> list[dict]:
        raise AssertionError("structure must not run on a no-info answer")

    doc = await research_candidate_positions(
        CANDIDATE, tier="broad", search_fn=fake_search, broad_structure_fn=fake_structure
    )
    assert doc["status"] == STATUS_EMPTY
    assert doc["positions"] == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_broad_tier_keeps_a_rich_answer_that_only_notes_some_gaps() -> None:
    # A real multi-issue answer that mentions "no clear position" as a meta-note must
    # NOT be nuked — only a TOTAL non-answer (leading / short) is an honest empty.
    rich = (
        "Gwen Moore supports expanding health care access. "
        + "She backs clean-energy and climate action. " * 20
        + "Where no clear position tied to a topic is found, that is noted."
    )

    async def fake_search(prompt: str) -> tuple[str, list[dict]]:
        return (rich, [_src("https://gwenmoore.house.gov")])

    async def fake_structure(name: str, answer: str, sources: list[dict]) -> list[dict]:
        return [{"candidateName": name, "issue": "health care", "answer": "Supports expanding access",
                 "evidenceType": "reported", "sources": sources}]

    doc = await research_candidate_positions(
        CANDIDATE, tier="broad", search_fn=fake_search, broad_structure_fn=fake_structure
    )
    assert doc["status"] == STATUS_FOUND
    assert doc["positions"][0]["issue"] == "health care"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_broad_tier_drops_a_no_info_fallback_card() -> None:
    # If structuring falls back to a single card whose answer is itself a no-info
    # narration, it must be dropped post-structure (the curly-apostrophe leak).
    async def fake_search(prompt: str) -> tuple[str, list[dict]]:
        return ("A long substantive-looking answer. " * 20, [_src("https://x")])

    # structure_positions emits a single "key positions" fallback card (issue sentinel)
    # whenever Gemini can't structure the answer — always an unstructured blob, often a
    # non-answer. The broad tier shows only real per-issue cards, so it is dropped.
    async def fake_structure(name: str, answer: str, sources: list[dict]) -> list[dict]:
        return [{"candidateName": name, "issue": "key positions",
                 "answer": "Some long blob of text that Gemini could not break into issues.",
                 "evidenceType": "reported", "sources": sources}]

    doc = await research_candidate_positions(
        CANDIDATE, tier="broad", search_fn=fake_search, broad_structure_fn=fake_structure
    )
    assert doc["status"] == STATUS_EMPTY
    assert doc["positions"] == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_broad_tier_never_raises_on_search_failure() -> None:
    async def boom(prompt: str) -> tuple[str, list[dict]]:
        raise RuntimeError("perplexity down")

    async def fake_structure(name: str, answer: str, sources: list[dict]) -> list[dict]:
        return []

    doc = await research_candidate_positions(
        CANDIDATE, tier="broad", search_fn=boom, broad_structure_fn=fake_structure
    )
    assert doc["status"] == STATUS_EMPTY
    assert doc["positions"] == []
