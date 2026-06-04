"""Tests for the evidence store: schema/hashing/indexes (T1) and
``fetch_and_store_source`` (T2).

Design contract:
- ``sha256_text`` is deterministic and change-sensitive.
- ``ensure_indexes`` is idempotent (safe to call repeatedly).
- ``fetch_and_store_source`` is graceful: every failure returns ``None`` and
  stores nothing; it never raises into callers.
- Append-only: changed content inserts a new doc; prior markdown is untouched.
- All network is injected via ``client_factory`` and all Mongo is a fake
  collection — there is zero real network or live Mongo I/O in these tests.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.services.evidence import schema
from app.services.evidence.schema import (
    SourceDocumentRef,
    ensure_indexes,
    sha256_text,
)

# ---------------------------------------------------------------------------
# T1 — sha256_text
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_sha256_text_is_stable_for_identical_input():
    """Identical input must always produce the same hash."""
    assert sha256_text("hello world") == sha256_text("hello world")


@pytest.mark.unit
def test_sha256_text_differs_for_different_input():
    """Different input must produce different hashes."""
    assert sha256_text("hello world") != sha256_text("hello  world")


# ---------------------------------------------------------------------------
# T1 — ensure_indexes (idempotent)
# ---------------------------------------------------------------------------


class _SpyCollection:
    """Records every create_index call so the test can assert the index specs."""

    def __init__(self) -> None:
        self.created: list[list[tuple[str, int]]] = []

    def create_index(self, keys, **kwargs):
        self.created.append(list(keys))
        return "idx"


class _SpyDb:
    """dict-like fake db that hands back one spy collection per name."""

    def __init__(self) -> None:
        self._collections: dict[str, _SpyCollection] = {}

    def __getitem__(self, name: str) -> _SpyCollection:
        return self._collections.setdefault(name, _SpyCollection())


@pytest.mark.unit
def test_ensure_indexes_creates_both_indexes():
    """ensure_indexes must create the dedup and latest-by-url indexes."""
    db = _SpyDb()
    ensure_indexes(db)
    created = db[schema.COLLECTION_NAME].created
    assert [("url", 1), ("content_hash", 1)] in created
    assert [("url", 1), ("fetched_at", -1)] in created


@pytest.mark.unit
def test_ensure_indexes_is_idempotent():
    """Calling ensure_indexes twice must not raise."""
    db = _SpyDb()
    ensure_indexes(db)
    ensure_indexes(db)  # must not raise


# ---------------------------------------------------------------------------
# T2 — fixtures: fake Mongo + fake async Firecrawl client (no real I/O)
# ---------------------------------------------------------------------------

from types import SimpleNamespace  # noqa: E402

from app.services.evidence.store import fetch_and_store_source  # noqa: E402

URL = "https://candidate.example.gov/positions"


class _FakeCollection:
    """In-memory stand-in for a pymongo collection (the subset store.py uses)."""

    def __init__(self, docs: list[dict] | None = None) -> None:
        self.docs: list[dict] = [dict(d) for d in (docs or [])]
        self.inserts = 0
        self._next_id = len(self.docs) + 1

    @staticmethod
    def _match(doc: dict, filt: dict) -> bool:
        return all(doc.get(key) == value for key, value in filt.items())

    def find_one(self, filt: dict, sort=None):
        matches = [d for d in self.docs if self._match(d, filt)]
        if sort:
            key, direction = sort[0]
            matches.sort(key=lambda d: d.get(key), reverse=(direction == -1))
        return matches[0] if matches else None

    def insert_one(self, doc: dict):
        stored = dict(doc)
        stored["_id"] = self._next_id
        self._next_id += 1
        self.docs.append(stored)
        self.inserts += 1
        return SimpleNamespace(inserted_id=stored["_id"])

    def update_one(self, filt: dict, update: dict):
        for doc in self.docs:
            if self._match(doc, filt):
                for field, value in update.get("$push", {}).items():
                    doc.setdefault(field, []).append(value)
                return SimpleNamespace(modified_count=1)
        return SimpleNamespace(modified_count=0)


class _FakeDb:
    """dict-like db that always returns the one fake collection."""

    def __init__(self, collection: _FakeCollection) -> None:
        self._collection = collection

    def __getitem__(self, name: str) -> _FakeCollection:
        return self._collection


class _FakeResponse:
    def __init__(self, status_code: int, json_data=None, raise_json: bool = False) -> None:
        self.status_code = status_code
        self._json_data = json_data
        self._raise_json = raise_json

    def json(self):
        if self._raise_json:
            raise ValueError("unparseable body")
        return self._json_data


class _FakePostClient:
    """Async-context-manager fake whose POST returns a fixed response."""

    def __init__(self, response: _FakeResponse) -> None:
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def post(self, endpoint: str, json=None, headers=None):
        return self._response


class _TimeoutPostClient:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def post(self, endpoint: str, json=None, headers=None):
        raise httpx.TimeoutException("timed out")


def _factory(client):
    def _make(**kwargs):
        return client
    return _make


def _ok_response(markdown: str, *, status: int = 200) -> _FakeResponse:
    return _FakeResponse(
        200,
        {
            "success": True,
            "data": {
                "markdown": markdown,
                "metadata": {
                    "title": "Candidate Positions",
                    "sourceURL": URL,
                    "url": "https://candidate.example.gov/positions/final",
                    "statusCode": status,
                },
            },
        },
    )


@pytest.fixture
def _firecrawl_key(monkeypatch):
    monkeypatch.setenv("FIRECRAWL_API_KEY", "fc-test-key")
    return "fc-test-key"


def _stale_doc(markdown: str) -> dict:
    """A previously-stored doc older than the default TTL (forces a re-fetch)."""
    old = datetime.now(UTC) - timedelta(days=40)
    h = sha256_text(markdown)
    return {
        "_id": 1,
        "url": URL,
        "final_url": URL,
        "title": "old",
        "markdown": markdown,
        "content_hash": h,
        "http_status": 200,
        "first_seen_at": old,
        "fetched_at": old,
        "retrieval_history": [{"fetched_at": old, "content_hash": h, "http_status": 200}],
    }


# ---------------------------------------------------------------------------
# T2 — happy path (first fetch)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_first_fetch_inserts_one_doc(_firecrawl_key):
    col = _FakeCollection()
    db = _FakeDb(col)
    await fetch_and_store_source(
        URL, db=db, client_factory=_factory(_FakePostClient(_ok_response("Body A")))
    )
    assert col.inserts == 1
    assert len(col.docs) == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_first_fetch_content_hash_matches_markdown(_firecrawl_key):
    col = _FakeCollection()
    db = _FakeDb(col)
    await fetch_and_store_source(
        URL, db=db, client_factory=_factory(_FakePostClient(_ok_response("Body A")))
    )
    assert col.docs[0]["content_hash"] == sha256_text("Body A")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_first_fetch_stamps_fetched_and_first_seen(_firecrawl_key):
    col = _FakeCollection()
    db = _FakeDb(col)
    await fetch_and_store_source(
        URL, db=db, client_factory=_factory(_FakePostClient(_ok_response("Body A")))
    )
    doc = col.docs[0]
    assert isinstance(doc["fetched_at"], datetime)
    assert isinstance(doc["first_seen_at"], datetime)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_first_fetch_seeds_retrieval_history(_firecrawl_key):
    col = _FakeCollection()
    db = _FakeDb(col)
    await fetch_and_store_source(
        URL, db=db, client_factory=_factory(_FakePostClient(_ok_response("Body A")))
    )
    assert len(col.docs[0]["retrieval_history"]) == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_returns_ref_with_all_fields(_firecrawl_key):
    col = _FakeCollection()
    db = _FakeDb(col)
    ref = await fetch_and_store_source(
        URL, db=db, client_factory=_factory(_FakePostClient(_ok_response("Body A")))
    )
    assert isinstance(ref, SourceDocumentRef)
    assert ref.url == URL
    assert ref.content_hash == sha256_text("Body A")
    assert isinstance(ref.fetched_at, datetime)
    assert ref.id  # non-empty id


# ---------------------------------------------------------------------------
# T2 — freshness short-circuit, dedup, versioning
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_freshness_short_circuit_skips_fetch(_firecrawl_key):
    """A doc younger than ttl_days returns its ref without scraping."""
    fresh = datetime.now(UTC)
    col = _FakeCollection(
        [{"_id": 7, "url": URL, "markdown": "x", "content_hash": "h",
          "fetched_at": fresh, "first_seen_at": fresh, "retrieval_history": []}]
    )
    db = _FakeDb(col)

    called = {"fetched": False}

    def _spy_factory(**kwargs):
        called["fetched"] = True
        return _FakePostClient(_ok_response("x"))

    ref = await fetch_and_store_source(URL, db=db, client_factory=_spy_factory, ttl_days=30)
    assert called["fetched"] is False
    assert col.inserts == 0
    assert ref is not None and ref.id == "7"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_same_content_inserts_no_new_doc(_firecrawl_key):
    col = _FakeCollection([_stale_doc("Body A")])
    db = _FakeDb(col)
    await fetch_and_store_source(
        URL, db=db, client_factory=_factory(_FakePostClient(_ok_response("Body A"))), ttl_days=30
    )
    assert col.inserts == 0
    assert len(col.docs) == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_same_content_grows_retrieval_history(_firecrawl_key):
    col = _FakeCollection([_stale_doc("Body A")])
    db = _FakeDb(col)
    await fetch_and_store_source(
        URL, db=db, client_factory=_factory(_FakePostClient(_ok_response("Body A"))), ttl_days=30
    )
    assert len(col.docs[0]["retrieval_history"]) == 2


@pytest.mark.unit
@pytest.mark.asyncio
async def test_changed_content_inserts_new_doc(_firecrawl_key):
    col = _FakeCollection([_stale_doc("Body A")])
    db = _FakeDb(col)
    await fetch_and_store_source(
        URL, db=db, client_factory=_factory(_FakePostClient(_ok_response("Body B"))), ttl_days=30
    )
    assert col.inserts == 1
    assert len(col.docs) == 2


@pytest.mark.unit
@pytest.mark.asyncio
async def test_changed_content_leaves_prior_markdown_untouched(_firecrawl_key):
    col = _FakeCollection([_stale_doc("Body A")])
    db = _FakeDb(col)
    await fetch_and_store_source(
        URL, db=db, client_factory=_factory(_FakePostClient(_ok_response("Body B"))), ttl_days=30
    )
    prior = next(d for d in col.docs if d["_id"] == 1)
    assert prior["markdown"] == "Body A"


# ---------------------------------------------------------------------------
# T2 — graceful failure (returns None, stores nothing, never raises)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_timeout_returns_none_stores_nothing(_firecrawl_key):
    col = _FakeCollection()
    db = _FakeDb(col)
    result = await fetch_and_store_source(
        URL, db=db, client_factory=_factory(_TimeoutPostClient())
    )
    assert result is None
    assert col.inserts == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_non_2xx_returns_none_stores_nothing(_firecrawl_key):
    col = _FakeCollection()
    db = _FakeDb(col)
    result = await fetch_and_store_source(
        URL, db=db, client_factory=_factory(_FakePostClient(_FakeResponse(402, {})))
    )
    assert result is None
    assert col.inserts == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_success_false_returns_none_stores_nothing(_firecrawl_key):
    col = _FakeCollection()
    db = _FakeDb(col)
    resp = _FakeResponse(200, {"success": False, "error": "blocked"})
    result = await fetch_and_store_source(URL, db=db, client_factory=_factory(_FakePostClient(resp)))
    assert result is None
    assert col.inserts == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_empty_markdown_returns_none_stores_nothing(_firecrawl_key):
    col = _FakeCollection()
    db = _FakeDb(col)
    result = await fetch_and_store_source(
        URL, db=db, client_factory=_factory(_FakePostClient(_ok_response("")))
    )
    assert result is None
    assert col.inserts == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_missing_api_key_returns_none_and_warns(monkeypatch, caplog):
    monkeypatch.delenv("FIRECRAWL_API_KEY", raising=False)
    col = _FakeCollection()
    db = _FakeDb(col)
    with caplog.at_level(logging.WARNING):
        result = await fetch_and_store_source(
            URL, db=db, client_factory=_factory(_FakePostClient(_ok_response("Body A")))
        )
    assert result is None
    assert col.inserts == 0
    assert any("FIRECRAWL_API_KEY" in rec.message for rec in caplog.records)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_api_key_never_appears_in_logs(monkeypatch, caplog):
    secret = "fc-super-secret-123"
    monkeypatch.setenv("FIRECRAWL_API_KEY", secret)
    col = _FakeCollection()
    db = _FakeDb(col)
    with caplog.at_level(logging.WARNING):
        # non-2xx triggers a warning log on a path that has the key in scope
        await fetch_and_store_source(
            URL, db=db, client_factory=_factory(_FakePostClient(_FakeResponse(500, {})))
        )
    assert all(secret not in rec.getMessage() for rec in caplog.records)
