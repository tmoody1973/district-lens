"""``fetch_and_store_source(url)`` — scrape a page via Firecrawl and archive it.

This is a pure data layer (nothing calls it yet). It fetches a URL through
Firecrawl's HTTP scrape API, content-hashes the markdown, and stores it in the
append-only ``source_documents`` collection with a retrieval timestamp.

Two design rules dominate this module:

- **Graceful always.** A missing API key, timeout, non-2xx, ``success != true``,
  or empty markdown returns ``None`` and stores nothing. It never raises into a
  caller, so the (future) brief pipeline keeps working with the key unset.
- **Append-only.** Identical content appends to the existing doc's retrieval
  history; changed content inserts a NEW doc and never touches the prior
  markdown.

The httpx client is injected via ``client_factory`` (mirroring
``refresh/citation_fetch.py``) so tests run with zero network I/O. The returned
markdown is untrusted data — it is stored and later quoted, never executed as
agent instructions.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app.services.evidence.schema import (
    COLLECTION_NAME,
    SourceDocumentRef,
    sha256_text,
)

logger = logging.getLogger(__name__)

_SCRAPE_ENDPOINT = "https://api.firecrawl.dev/v2/scrape"
_TIMEOUT_SECONDS = 8.0
_DEFAULT_TTL_DAYS = 30


def _coerce_object(value: Any) -> Any:
    """Return ``value`` as a parsed object, decoding a JSON string if needed.

    Firecrawl occasionally serializes nested objects as JSON strings; normalize
    them the same way the frontend FinanceToolCard does (object-or-JSON-string).
    """
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


def _normalize_title(raw: Any) -> str | None:
    """Firecrawl ``metadata.title`` may be a string or a list of strings."""
    if isinstance(raw, str):
        return raw
    if isinstance(raw, list) and raw:
        first = raw[0]
        return first if isinstance(first, str) else None
    return None


def _is_fresh(fetched_at: datetime, now: datetime, ttl_days: int) -> bool:
    """True if ``fetched_at`` is younger than ``ttl_days`` relative to ``now``."""
    if fetched_at.tzinfo is None:
        fetched_at = fetched_at.replace(tzinfo=UTC)
    return (now - fetched_at) < timedelta(days=ttl_days)


def _ref_from_doc(doc: dict[str, Any]) -> SourceDocumentRef:
    """Build an immutable ref from a stored ``source_documents`` doc."""
    return SourceDocumentRef(
        id=str(doc.get("_id")),
        url=doc["url"],
        fetched_at=doc["fetched_at"],
        content_hash=doc["content_hash"],
        content_length=len(doc.get("markdown") or ""),
    )


async def _scrape(
    url: str, api_key: str, client_factory: Any
) -> tuple[str, str | None, str | None, int | None] | None:
    """POST to Firecrawl and return (markdown, final_url, title, http_status).

    Returns ``None`` on timeout, non-2xx, malformed body, or ``success != true``.
    Never logs the API key.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {"url": url, "formats": [{"type": "markdown"}]}

    try:
        async with client_factory(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.post(_SCRAPE_ENDPOINT, json=body, headers=headers)
    except httpx.TimeoutException as exc:
        logger.warning("fetch_and_store_source: Firecrawl timeout for %s: %s", url, exc)
        return None
    except Exception as exc:  # any transport error degrades to None
        logger.warning("fetch_and_store_source: Firecrawl error for %s: %s", url, exc)
        return None

    if response.status_code // 100 != 2:
        logger.warning(
            "fetch_and_store_source: Firecrawl non-2xx for %s (status=%d)",
            url,
            response.status_code,
        )
        return None

    try:
        payload = response.json()
    except (ValueError, TypeError):
        logger.warning("fetch_and_store_source: unparseable Firecrawl body for %s", url)
        return None

    if not isinstance(payload, dict) or payload.get("success") is not True:
        logger.warning("fetch_and_store_source: Firecrawl success!=true for %s", url)
        return None

    data = _coerce_object(payload.get("data"))
    if not isinstance(data, dict):
        return None

    markdown = data.get("markdown") or ""
    metadata = _coerce_object(data.get("metadata"))
    if not isinstance(metadata, dict):
        metadata = {}

    final_url = metadata.get("url") or metadata.get("sourceURL")
    title = _normalize_title(metadata.get("title"))
    http_status = metadata.get("statusCode")
    return markdown, final_url, title, http_status


async def fetch_and_store_source(
    url: str,
    *,
    db: Any = None,
    client_factory: Any = httpx.AsyncClient,
    ttl_days: int = _DEFAULT_TTL_DAYS,
) -> SourceDocumentRef | None:
    """Fetch ``url`` via Firecrawl and archive it as dated evidence.

    Flow: freshness short-circuit → key check → scrape → validate → hash →
    dedup-append-or-insert → return a ``SourceDocumentRef``. Returns ``None`` on
    any failure, storing nothing.
    """
    if db is None:
        from app.tools.mongodb_tools import _get_db

        db = _get_db()
    collection = db[COLLECTION_NAME]
    now = datetime.now(UTC)

    latest = await asyncio.to_thread(
        collection.find_one, {"url": url}, sort=[("fetched_at", -1)]
    )
    if latest is not None:
        fetched_at = latest.get("fetched_at")
        if isinstance(fetched_at, datetime) and _is_fresh(fetched_at, now, ttl_days):
            return _ref_from_doc(latest)

    api_key = os.environ.get("FIRECRAWL_API_KEY", "")
    if not api_key:
        logger.warning(
            "fetch_and_store_source: FIRECRAWL_API_KEY unset; skipping %s", url
        )
        return None

    scraped = await _scrape(url, api_key, client_factory)
    if scraped is None:
        return None
    markdown, final_url, title, http_status = scraped
    if not markdown:
        logger.warning("fetch_and_store_source: empty markdown for %s", url)
        return None

    content_hash = sha256_text(markdown)
    record = {"fetched_at": now, "content_hash": content_hash, "http_status": http_status}

    existing = await asyncio.to_thread(
        collection.find_one, {"url": url, "content_hash": content_hash}
    )
    if existing is not None:
        await asyncio.to_thread(
            collection.update_one,
            {"_id": existing["_id"]},
            {"$push": {"retrieval_history": record}},
        )
        return _ref_from_doc(existing)

    doc = {
        "url": url,
        "final_url": final_url,
        "title": title,
        "markdown": markdown,
        "content_hash": content_hash,
        "http_status": http_status,
        "first_seen_at": now,
        "fetched_at": now,
        "retrieval_history": [record],
    }
    result = await asyncio.to_thread(collection.insert_one, doc)
    doc["_id"] = result.inserted_id
    return _ref_from_doc(doc)
