"""Tests for the candidate_positions cache: schema/hashing/indexes (T1) and
the cache store get/upsert (T1).

Design contract (handoff 2026-06-04-position-search-t1-t2):
- ``positions_content_hash`` reuses ``sha256_text``; stable for identical
  positions, change-sensitive otherwise.
- ``ensure_indexes`` creates {candidate_id:1}, {race_key:1}, {researched_at:-1}
  and is idempotent.
- ``get_cached_positions`` returns the doc when fresh, else None (TTL freshness).
- ``upsert_positions`` is append-only on ``retrieval_history``: a new
  content_hash updates the positions; an unchanged hash only pushes history.
- All Mongo is a fake collection — zero live Mongo I/O.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.services.evidence.schema import sha256_text
from app.services.positions import schema
from app.services.positions.schema import (
    ensure_indexes,
    positions_content_hash,
)
from app.services.positions.store import (
    get_cached_positions,
    upsert_positions,
)

CANDIDATE_ID = "H8GA06123"
RACE_KEY = "2026-H-GA-06"


def _positions(answer: str = "Supports lowering premiums") -> list[dict]:
    return [
        {
            "issue": "health care",
            "answer": answer,
            "evidenceType": "direct_quote",
            "sources": [
                {
                    "title": "Campaign — Issues",
                    "url": "https://jane.example.com/issues",
                    "date": "2026-03-01",
                    "snippet": "We will lower premiums.",
                    "archived": True,
                    "archivedAt": "2026-03-02",
                    "sourceDocumentId": "doc-1",
                }
            ],
        }
    ]


def _doc(*, content_hash: str | None = None, answer: str = "Supports lowering premiums") -> dict:
    positions = _positions(answer)
    return {
        "candidate_id": CANDIDATE_ID,
        "race_key": RACE_KEY,
        "candidate_name": "Jane Doe",
        "researched_at": datetime.now(UTC),
        "research_tier": "deep",
        "disambiguation": "Jane Doe, DEM, U.S. House GA-06, 2026",
        "status": "found",
        "positions": positions,
        "content_hash": content_hash or positions_content_hash(positions),
        "retrieval_history": [],
    }


# ---------------------------------------------------------------------------
# Fake Mongo collection (find_one + sort, insert_one, update_one $set/$push)
# ---------------------------------------------------------------------------


class _FakeCollection:
    def __init__(self, docs: list[dict] | None = None) -> None:
        self.docs: list[dict] = [dict(d) for d in (docs or [])]
        self.inserts = 0
        self.updates = 0
        self.created: list[list[tuple[str, int]]] = []
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
                for field, value in update.get("$set", {}).items():
                    doc[field] = value
                for field, value in update.get("$push", {}).items():
                    doc.setdefault(field, []).append(value)
                self.updates += 1
                return SimpleNamespace(modified_count=1)
        return SimpleNamespace(modified_count=0)

    def create_index(self, keys, **kwargs):
        self.created.append(list(keys))
        return "idx"


class _FakeDb:
    def __init__(self, collection: _FakeCollection) -> None:
        self._collection = collection

    def __getitem__(self, name: str) -> _FakeCollection:
        return self._collection


# ---------------------------------------------------------------------------
# T1 — positions_content_hash
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_content_hash_stable_for_identical_positions():
    assert positions_content_hash(_positions()) == positions_content_hash(_positions())


@pytest.mark.unit
def test_content_hash_changes_when_a_position_changes():
    assert positions_content_hash(_positions("A")) != positions_content_hash(_positions("B"))


@pytest.mark.unit
def test_content_hash_reuses_sha256_text():
    """The hash must be a real sha256 hex digest (64 hex chars)."""
    digest = positions_content_hash(_positions())
    assert len(digest) == len(sha256_text("x"))


@pytest.mark.unit
def test_content_hash_is_order_insensitive_for_equal_content():
    """Re-serialising the same positions must not depend on dict key order."""
    a = [{"issue": "x", "answer": "y", "evidenceType": "reported", "sources": []}]
    b = [{"sources": [], "evidenceType": "reported", "answer": "y", "issue": "x"}]
    assert positions_content_hash(a) == positions_content_hash(b)


# ---------------------------------------------------------------------------
# T1 — ensure_indexes
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_ensure_indexes_creates_candidate_id_index():
    col = _FakeCollection()
    ensure_indexes(_FakeDb(col))
    assert [("candidate_id", 1)] in col.created


@pytest.mark.unit
def test_ensure_indexes_creates_race_key_index():
    col = _FakeCollection()
    ensure_indexes(_FakeDb(col))
    assert [("race_key", 1)] in col.created


@pytest.mark.unit
def test_ensure_indexes_creates_researched_at_desc_index():
    col = _FakeCollection()
    ensure_indexes(_FakeDb(col))
    assert [("researched_at", -1)] in col.created


@pytest.mark.unit
def test_ensure_indexes_is_idempotent():
    col = _FakeCollection()
    db = _FakeDb(col)
    ensure_indexes(db)
    ensure_indexes(db)  # must not raise


@pytest.mark.unit
def test_collection_name_is_candidate_positions():
    assert schema.COLLECTION_NAME == "candidate_positions"


# ---------------------------------------------------------------------------
# T1 — get_cached_positions (TTL freshness)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_cached_returns_doc_when_fresh():
    doc = _doc()
    doc["researched_at"] = datetime.now(UTC)
    col = _FakeCollection([doc])
    result = await get_cached_positions(CANDIDATE_ID, db=_FakeDb(col), ttl_days=21)
    assert result is not None
    assert result["candidate_id"] == CANDIDATE_ID


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_cached_returns_none_when_stale():
    doc = _doc()
    doc["researched_at"] = datetime.now(UTC) - timedelta(days=40)
    col = _FakeCollection([doc])
    result = await get_cached_positions(CANDIDATE_ID, db=_FakeDb(col), ttl_days=21)
    assert result is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_cached_returns_none_when_absent():
    col = _FakeCollection()
    result = await get_cached_positions(CANDIDATE_ID, db=_FakeDb(col), ttl_days=21)
    assert result is None


# ---------------------------------------------------------------------------
# T1 — upsert_positions (append-only)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_upsert_inserts_when_none_exists():
    col = _FakeCollection()
    await upsert_positions(_doc(), db=_FakeDb(col))
    assert col.inserts == 1
    assert len(col.docs) == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_upsert_seeds_retrieval_history_on_insert():
    col = _FakeCollection()
    await upsert_positions(_doc(), db=_FakeDb(col))
    assert len(col.docs[0]["retrieval_history"]) == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_upsert_same_hash_appends_history_without_new_doc():
    existing = _doc()
    col = _FakeCollection([existing])
    incoming = _doc(content_hash=existing["content_hash"])
    await upsert_positions(incoming, db=_FakeDb(col))
    assert col.inserts == 0
    assert len(col.docs) == 1
    assert len(col.docs[0]["retrieval_history"]) == 1  # one new record pushed


@pytest.mark.unit
@pytest.mark.asyncio
async def test_upsert_same_hash_leaves_positions_unchanged():
    existing = _doc(answer="ORIGINAL")
    col = _FakeCollection([existing])
    # incoming carries the SAME hash but a different answer — positions must NOT change
    incoming = _doc(answer="TAMPERED", content_hash=existing["content_hash"])
    await upsert_positions(incoming, db=_FakeDb(col))
    assert col.docs[0]["positions"][0]["answer"] == "ORIGINAL"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_upsert_changed_hash_updates_positions():
    existing = _doc(answer="OLD")
    col = _FakeCollection([existing])
    incoming = _doc(answer="NEW")  # different answer → different hash
    assert incoming["content_hash"] != existing["content_hash"]
    await upsert_positions(incoming, db=_FakeDb(col))
    assert col.docs[0]["positions"][0]["answer"] == "NEW"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_upsert_changed_hash_appends_history_not_new_doc():
    existing = _doc(answer="OLD")
    col = _FakeCollection([existing])
    await upsert_positions(_doc(answer="NEW"), db=_FakeDb(col))
    assert col.inserts == 0  # same candidate → in-place update, not a new doc
    assert len(col.docs) == 1
    assert len(col.docs[0]["retrieval_history"]) == 1
