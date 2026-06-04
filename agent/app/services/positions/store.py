"""Read/write the ``candidate_positions`` cache (one doc per candidate).

Two functions, both graceful and append-only on ``retrieval_history``:

- ``get_cached_positions`` returns the cached doc only if it is fresher than
  ``ttl_days`` (drives the scheduled refresh + lazy on-demand TTL).
- ``upsert_positions`` writes a freshly-researched doc: a new ``content_hash``
  updates the stored positions; an unchanged hash only pushes an audit record —
  unchanged research never churns the cache (mirrors the evidence store's
  dedup/append discipline).

Every pymongo call runs inside ``asyncio.to_thread`` so the sync driver never
blocks the event loop (the repo's sync-pymongo-in-async pattern).
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

from app.services.positions.schema import COLLECTION_NAME

_DEFAULT_TTL_DAYS = 21


def _resolve_db(db: Any) -> Any:
    if db is not None:
        return db
    from app.tools.mongodb_tools import _get_db

    return _get_db()


def _is_fresh(researched_at: Any, now: datetime, ttl_days: int) -> bool:
    if not isinstance(researched_at, datetime):
        return False
    if researched_at.tzinfo is None:
        researched_at = researched_at.replace(tzinfo=UTC)
    return (now - researched_at) < timedelta(days=ttl_days)


def _history_record(doc: dict[str, Any]) -> dict[str, Any]:
    """Build the append-only audit record for one research pass."""
    return {
        "researched_at": doc.get("researched_at"),
        "content_hash": doc.get("content_hash"),
        "research_tier": doc.get("research_tier"),
        "status": doc.get("status"),
    }


async def get_cached_positions(
    candidate_id: str, *, db: Any = None, ttl_days: int = _DEFAULT_TTL_DAYS
) -> dict[str, Any] | None:
    """Return the cached positions doc for ``candidate_id`` if fresh, else None."""
    collection = _resolve_db(db)[COLLECTION_NAME]
    now = datetime.now(UTC)

    doc = await asyncio.to_thread(
        collection.find_one,
        {"candidate_id": candidate_id},
        sort=[("researched_at", -1)],
    )
    if doc is None:
        return None
    if _is_fresh(doc.get("researched_at"), now, ttl_days):
        return doc
    return None


async def upsert_positions(doc: dict[str, Any], *, db: Any = None) -> dict[str, Any]:
    """Write ``doc`` into the cache, append-only on ``retrieval_history``.

    No prior doc → insert (seed history). Same ``content_hash`` → push an audit
    record only; the stored positions are left untouched. Changed hash → update
    positions/hash/status/disambiguation and push the audit record. One doc per
    candidate (updated in place), so a change is never a new doc.
    """
    collection = _resolve_db(db)[COLLECTION_NAME]
    record = _history_record(doc)

    existing = await asyncio.to_thread(
        collection.find_one,
        {"candidate_id": doc["candidate_id"]},
        sort=[("researched_at", -1)],
    )

    if existing is None:
        to_insert = dict(doc)
        to_insert["retrieval_history"] = [record]
        await asyncio.to_thread(collection.insert_one, to_insert)
        return to_insert

    if existing.get("content_hash") == doc.get("content_hash"):
        await asyncio.to_thread(
            collection.update_one,
            {"candidate_id": doc["candidate_id"]},
            {"$push": {"retrieval_history": record}},
        )
        return existing

    await asyncio.to_thread(
        collection.update_one,
        {"candidate_id": doc["candidate_id"]},
        {
            "$set": {
                "positions": doc.get("positions"),
                "content_hash": doc.get("content_hash"),
                "status": doc.get("status"),
                "research_tier": doc.get("research_tier"),
                "disambiguation": doc.get("disambiguation"),
                "researched_at": doc.get("researched_at"),
                "candidate_name": doc.get("candidate_name"),
                "race_key": doc.get("race_key"),
            },
            "$push": {"retrieval_history": record},
        },
    )
    return doc
