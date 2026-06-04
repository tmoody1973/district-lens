"""Tests for ``research_candidate_positions`` (position-search redesign T2).

The pipeline disambiguates → discovers sources (Perplexity) → ranks → scrapes the
top N (evidence store, archived ✓) → extracts per-issue stances from the scraped
page text (Gemini) → degrades gracefully. Every network dependency is INJECTED
(``search_fn``, ``scrape_fn``, ``structure_fn``) so these tests do zero real I/O.

Guardrails under test:
- disambiguation carries office/district/state/party/cycle (the identity fix);
- the positions ranker prefers own-site > questionnaire > news and denies
  aggregators as primary;
- extraction that finds no supported stance yields ``no_positions_found`` (no
  inference) — it does NOT fan out;
- no primary sources / all scrapes failing degrades to a shallow ``reported``
  fan-out, and a fully empty result is an honest empty;
- the function NEVER raises.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.services.evidence.schema import SourceDocumentRef
from app.services.positions.research import (
    build_disambiguation,
    rank_sources,
    research_candidate_positions,
)
from app.services.positions.schema import STATUS_EMPTY, STATUS_FOUND

CANDIDATE = {
    "candidate_id": "H8GA06123",
    "name": "Doe, Jane",
    "party": "DEM",
    "race_key": "2026-H-GA-06",
    "incumbent_challenge_status": "C",
}


def _ref(url: str, doc_id: str) -> SourceDocumentRef:
    return SourceDocumentRef(
        id=doc_id, url=url, fetched_at=datetime.now(UTC), content_hash="h-" + doc_id
    )


def _src(url: str, title: str = "") -> dict:
    return {"title": title or url, "url": url, "date": None, "snippet": "snippet"}


# ---------------------------------------------------------------------------
# Disambiguation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_disambiguation_strips_honorific():
    out = build_disambiguation({**CANDIDATE, "name": "Doe, Dr. Jane"})
    assert "Dr." not in out
    assert "Jane Doe" in out


@pytest.mark.unit
def test_disambiguation_includes_office():
    assert "House" in build_disambiguation(CANDIDATE)


@pytest.mark.unit
def test_disambiguation_senate_office():
    senate = {**CANDIDATE, "race_key": "2026-S-WI-00"}
    assert "Senate" in build_disambiguation(senate)


@pytest.mark.unit
def test_disambiguation_includes_district():
    assert "06" in build_disambiguation(CANDIDATE)


@pytest.mark.unit
def test_disambiguation_includes_state():
    assert "GA" in build_disambiguation(CANDIDATE)


@pytest.mark.unit
def test_disambiguation_includes_party():
    assert "DEM" in build_disambiguation(CANDIDATE)


@pytest.mark.unit
def test_disambiguation_includes_cycle():
    assert "2026" in build_disambiguation(CANDIDATE)


# ---------------------------------------------------------------------------
# Source ranking
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_ranker_own_site_beats_questionnaire():
    own = _src("https://janedoe.com/issues")
    quiz = _src("https://www.vote411.org/jane-doe")
    ranked = rank_sources([quiz, own], CANDIDATE)
    assert ranked[0]["url"] == own["url"]


@pytest.mark.unit
def test_ranker_questionnaire_beats_news():
    quiz = _src("https://www.vote411.org/jane-doe")
    news = _src("https://apnews.com/article/jane-doe")
    ranked = rank_sources([news, quiz], CANDIDATE)
    assert ranked[0]["url"] == quiz["url"]


@pytest.mark.unit
def test_ranker_denies_aggregator_as_primary():
    wiki = _src("https://en.wikipedia.org/wiki/Jane_Doe")
    news = _src("https://apnews.com/article/jane-doe")
    ranked = rank_sources([wiki, news], CANDIDATE)
    assert all("wikipedia.org" not in s["url"] for s in ranked)


# ---------------------------------------------------------------------------
# Injected fakes
# ---------------------------------------------------------------------------


def _discovery_search(sources: list[dict]):
    async def _fn(query: str):
        return "discovery summary", sources

    return _fn


def _substantive_search():
    """search_fn that returns a substantive reported answer for any query."""

    async def _fn(query: str):
        return ("The candidate supports lowering costs. " * 10, [_src("https://news.example/x")])

    return _fn


def _empty_search():
    async def _fn(query: str):
        return "", []

    return _fn


def _raising_search():
    async def _fn(query: str):
        raise RuntimeError("PERPLEXITY_API_KEY missing")

    return _fn


def _scrape_returning(refs: dict[str, SourceDocumentRef]):
    calls = {"n": 0}

    async def _fn(url: str):
        calls["n"] += 1
        return refs.get(url)

    _fn.calls = calls  # type: ignore[attr-defined]
    return _fn


def _scrape_all_fail():
    async def _fn(url: str):
        return None

    return _fn


def _structure_echo():
    """Extractor that asserts a stance, echoing the scraped sources it was given."""

    async def _fn(candidate_name: str, scraped_sources: list[dict]):
        return [
            {
                "issue": "health care",
                "answer": "Supports lowering premiums.",
                "evidenceType": "direct_quote",
                "sources": scraped_sources,
            }
        ]

    return _fn


def _structure_no_support():
    """Extractor that finds no supported stance in the page text."""

    async def _fn(candidate_name: str, scraped_sources: list[dict]):
        return []

    return _fn


# ---------------------------------------------------------------------------
# Happy path: discover → scrape → extract
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_happy_path_yields_positions():
    own = _src("https://janedoe.com/issues")
    refs = {own["url"]: _ref(own["url"], "doc-1")}
    doc = await research_candidate_positions(
        CANDIDATE,
        tier="deep",
        search_fn=_discovery_search([own]),
        scrape_fn=_scrape_returning(refs),
        structure_fn=_structure_echo(),
    )
    assert doc["status"] == STATUS_FOUND
    assert len(doc["positions"]) >= 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_happy_path_sources_are_archived():
    own = _src("https://janedoe.com/issues")
    refs = {own["url"]: _ref(own["url"], "doc-1")}
    doc = await research_candidate_positions(
        CANDIDATE,
        tier="deep",
        search_fn=_discovery_search([own]),
        scrape_fn=_scrape_returning(refs),
        structure_fn=_structure_echo(),
    )
    source = doc["positions"][0]["sources"][0]
    assert source["archived"] is True
    assert source["sourceDocumentId"] == "doc-1"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_returns_candidate_positions_shape():
    own = _src("https://janedoe.com/issues")
    refs = {own["url"]: _ref(own["url"], "doc-1")}
    doc = await research_candidate_positions(
        CANDIDATE,
        tier="deep",
        search_fn=_discovery_search([own]),
        scrape_fn=_scrape_returning(refs),
        structure_fn=_structure_echo(),
    )
    for key in (
        "candidate_id",
        "race_key",
        "candidate_name",
        "researched_at",
        "research_tier",
        "disambiguation",
        "status",
        "positions",
        "content_hash",
        "retrieval_history",
    ):
        assert key in doc


# ---------------------------------------------------------------------------
# Guardrail: scraped but no supported stance → honest no_positions_found
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_no_supported_stance_is_no_positions_found():
    own = _src("https://janedoe.com/issues")
    refs = {own["url"]: _ref(own["url"], "doc-1")}
    doc = await research_candidate_positions(
        CANDIDATE,
        tier="deep",
        search_fn=_discovery_search([own]),
        scrape_fn=_scrape_returning(refs),
        structure_fn=_structure_no_support(),
    )
    assert doc["status"] == STATUS_EMPTY
    assert doc["positions"] == []


# ---------------------------------------------------------------------------
# Degrade: all scrapes fail → shallow reported fan-out
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_all_scrapes_fail_falls_back_to_reported():
    doc = await research_candidate_positions(
        CANDIDATE,
        tier="deep",
        search_fn=_substantive_search(),
        scrape_fn=_scrape_all_fail(),
        structure_fn=_structure_echo(),
    )
    assert doc["status"] == STATUS_FOUND
    assert doc["positions"]
    assert all(p["evidenceType"] == "reported" for p in doc["positions"])


# ---------------------------------------------------------------------------
# Degrade: nothing anywhere → honest empty
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_empty_discovery_is_honest_empty():
    doc = await research_candidate_positions(
        CANDIDATE,
        tier="deep",
        search_fn=_empty_search(),
        scrape_fn=_scrape_all_fail(),
        structure_fn=_structure_echo(),
    )
    assert doc["status"] == STATUS_EMPTY
    assert doc["positions"] == []


# ---------------------------------------------------------------------------
# Graceful: missing keys / raising network never raises
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_raising_search_degrades_without_raising():
    doc = await research_candidate_positions(
        CANDIDATE,
        tier="deep",
        search_fn=_raising_search(),
        scrape_fn=_scrape_all_fail(),
        structure_fn=_structure_echo(),
    )
    assert doc["status"] == STATUS_EMPTY


@pytest.mark.unit
@pytest.mark.asyncio
async def test_raising_scrape_degrades_without_raising():
    async def _boom(url: str):
        raise RuntimeError("firecrawl down")

    doc = await research_candidate_positions(
        CANDIDATE,
        tier="deep",
        search_fn=_substantive_search(),
        scrape_fn=_boom,
        structure_fn=_structure_echo(),
    )
    # scrape raised → treated as failure → shallow reported fan-out, no raise
    assert doc["status"] in (STATUS_FOUND, STATUS_EMPTY)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_raising_structure_degrades_to_empty():
    own = _src("https://janedoe.com/issues")
    refs = {own["url"]: _ref(own["url"], "doc-1")}

    async def _boom(candidate_name, scraped_sources):
        raise RuntimeError("gemini down")

    doc = await research_candidate_positions(
        CANDIDATE,
        tier="deep",
        search_fn=_discovery_search([own]),
        scrape_fn=_scrape_returning(refs),
        structure_fn=_boom,
    )
    assert doc["status"] == STATUS_EMPTY


# ---------------------------------------------------------------------------
# Cost: deep tier caps scrapes at 3
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_deep_tier_caps_scrapes_at_three():
    sources = [_src(f"https://janedoe.com/p{i}") for i in range(5)]
    refs = {s["url"]: _ref(s["url"], f"doc-{i}") for i, s in enumerate(sources)}
    scrape = _scrape_returning(refs)
    await research_candidate_positions(
        CANDIDATE,
        tier="deep",
        search_fn=_discovery_search(sources),
        scrape_fn=scrape,
        structure_fn=_structure_echo(),
    )
    assert scrape.calls["n"] <= 3  # type: ignore[attr-defined]
