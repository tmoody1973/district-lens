"""Tests for the Gemini-grounding broad-tier retrieval engine.

``gemini_grounded_search`` is the new broad-tier engine: one grounded
``gemini-3.5-flash`` call retrieves a candidate's positions and returns the real
named sources behind the answer. Each grounding chunk's redirect URL is resolved
to its real page and archived via the evidence store before it is cited
(citations.md), so the returned sources carry ``sourceDocumentId``.

Every external call (generate / resolve / scrape) is injected, so these tests do
zero network I/O.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.services.evidence.schema import SourceDocumentRef
from app.services.positions.gemini_ground import gemini_grounded_search

_REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc"
_REAL_URL = "https://ballotpedia.org/Amy_Donahue"


def _ref(url: str, doc_id: str = "doc123") -> SourceDocumentRef:
    return SourceDocumentRef(
        id=doc_id,
        url=url,
        fetched_at=datetime(2026, 6, 8, tzinfo=UTC),
        content_hash="h",
        content_length=42,
    )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_grounded_search_returns_answer_and_archived_sources() -> None:
    async def fake_generate(prompt: str) -> tuple[str, list[tuple[str, str]]]:
        return ("Amy Donahue supports Medicare for All.", [("ballotpedia.org", _REDIRECT)])

    async def fake_resolve(uri: str) -> str | None:
        return _REAL_URL

    async def fake_scrape(url: str) -> SourceDocumentRef | None:
        return _ref(url)

    answer, sources = await gemini_grounded_search(
        "research Amy Donahue",
        generate_fn=fake_generate,
        resolve_fn=fake_resolve,
        scrape_fn=fake_scrape,
    )

    assert "Medicare for All" in answer
    assert len(sources) == 1
    assert sources[0]["url"] == _REAL_URL
    assert sources[0]["sourceDocumentId"] == "doc123"
    assert sources[0]["archived"] is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_unresolvable_redirect_is_skipped() -> None:
    async def fake_generate(prompt: str) -> tuple[str, list[tuple[str, str]]]:
        return ("answer", [("ballotpedia.org", _REDIRECT)])

    async def fake_resolve(uri: str) -> str | None:
        return None  # redirect won't resolve

    async def fake_scrape(url: str) -> SourceDocumentRef | None:
        raise AssertionError("scrape must not run on an unresolved redirect")

    answer, sources = await gemini_grounded_search(
        "p", generate_fn=fake_generate, resolve_fn=fake_resolve, scrape_fn=fake_scrape
    )
    assert answer == "answer"
    assert sources == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_archive_failure_keeps_source_unarchived() -> None:
    async def fake_generate(prompt: str) -> tuple[str, list[tuple[str, str]]]:
        return ("answer", [("ballotpedia.org", _REDIRECT)])

    async def fake_resolve(uri: str) -> str | None:
        return _REAL_URL

    async def fake_scrape(url: str) -> SourceDocumentRef | None:
        raise RuntimeError("firecrawl down")

    _answer, sources = await gemini_grounded_search(
        "p", generate_fn=fake_generate, resolve_fn=fake_resolve, scrape_fn=fake_scrape
    )
    assert len(sources) == 1
    assert sources[0]["url"] == _REAL_URL
    assert sources[0]["archived"] is False
    assert "sourceDocumentId" not in sources[0]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sources_are_deduped_by_resolved_url() -> None:
    async def fake_generate(prompt: str) -> tuple[str, list[tuple[str, str]]]:
        return ("answer", [("ballotpedia.org", _REDIRECT), ("ballotpedia.org", _REDIRECT + "2")])

    async def fake_resolve(uri: str) -> str | None:
        return _REAL_URL  # both redirects resolve to the same page

    async def fake_scrape(url: str) -> SourceDocumentRef | None:
        return _ref(url)

    _answer, sources = await gemini_grounded_search(
        "p", generate_fn=fake_generate, resolve_fn=fake_resolve, scrape_fn=fake_scrape
    )
    assert len(sources) == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_generate_failure_propagates() -> None:
    async def boom(prompt: str) -> tuple[str, list[tuple[str, str]]]:
        raise RuntimeError("grounding call failed")

    with pytest.raises(RuntimeError):
        await gemini_grounded_search("p", generate_fn=boom)
