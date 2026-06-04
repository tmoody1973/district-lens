"""Schema, hashing, and indexes for the ``source_documents`` evidence collection.

A ``source_documents`` doc is an append-only archive of a single fetched page:
its clean markdown, a content hash, the timestamp WE stamped at fetch time
(Firecrawl gives no reliable publish date), and a retrieval history recording
every time we re-fetched the same URL.

Indexes mirror the idempotent ``create_index`` pattern used elsewhere in the
agent: ``create_index`` is safe to call repeatedly, so ``ensure_indexes`` can
run on every startup without error.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime
from typing import Any, TypedDict

COLLECTION_NAME = "source_documents"


class RetrievalRecord(TypedDict):
    """One entry in a document's retrieval history."""

    fetched_at: datetime
    content_hash: str
    http_status: int | None


class SourceDocument(TypedDict):
    """An archived source page stored in ``source_documents`` (append-only)."""

    url: str
    final_url: str | None
    title: str | None
    markdown: str
    content_hash: str
    http_status: int | None
    first_seen_at: datetime
    fetched_at: datetime
    retrieval_history: list[RetrievalRecord]


@dataclass(frozen=True)
class SourceDocumentRef:
    """Lightweight, immutable handle to a stored source document.

    Returned by the store so callers can cite the evidence without carrying the
    full markdown around.
    """

    id: str
    url: str
    fetched_at: datetime
    content_hash: str
    # Size of the archived markdown. Lets callers tell a rich page (extraction
    # genuinely found no stance) from a thin JS-shell page (a real browser might
    # do better) when a scrape succeeds but extraction comes back empty.
    content_length: int = 0


def sha256_text(text: str) -> str:
    """Return the hex SHA-256 of ``text`` (UTF-8 encoded).

    Deterministic: identical input always yields the same hash; any change in
    the text yields a different hash. This is the dedup/versioning key for
    archived evidence.
    """
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def ensure_indexes(db: Any) -> None:
    """Create the ``source_documents`` indexes idempotently.

    ``{url, content_hash}`` backs dedup lookups; ``{url, fetched_at: -1}`` backs
    latest-by-url freshness queries. ``create_index`` is a no-op when an index
    already exists, so this is safe to call on every startup.
    """
    collection = db[COLLECTION_NAME]
    # TODO(T3): when the brief pipeline archives sources concurrently via
    # asyncio.gather, make the dedup index unique and catch DuplicateKeyError as
    # a dedup hit, so racing inserts of the same (url, content_hash) stay
    # graceful instead of creating benign duplicate docs.
    collection.create_index([("url", 1), ("content_hash", 1)])
    collection.create_index([("url", 1), ("fetched_at", -1)])
