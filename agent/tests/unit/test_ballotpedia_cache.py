"""fetch_page caches rendered HTML in Mongo so repeat Ballotpedia lookups don't
re-pay the Firecrawl stealth fallback (~5 credits + seconds each).

The cache is gated on MONGODB_URI and pluggable for tests via cache_collection.
"""

from __future__ import annotations

import asyncio
import importlib.util
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.tools import ballotpedia_mcp_toolset as bp


def _load_server():
    spec = importlib.util.spec_from_file_location(
        "ballotpedia_server_cache_test", bp._DEFAULT_SERVER_PATH
    )
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


class FakeCollection:
    """Minimal pymongo-collection stand-in (sync, called via asyncio.to_thread)."""

    def __init__(self):
        self.docs: dict[str, dict] = {}

    def find_one(self, query):
        return self.docs.get(query["url"])

    def update_one(self, query, update, upsert=False):
        self.docs[query["url"]] = dict(update["$set"])


async def _instant_sleep(*_a, **_k):
    return None


def _explode_transport():
    def handler(_req):
        raise AssertionError("direct fetch must not run on a cache hit")

    return httpx.MockTransport(handler)


def _ok_transport(html):
    return httpx.MockTransport(lambda _req: httpx.Response(200, text=html))


def test_cache_hit_returns_without_fetching(monkeypatch):
    server = _load_server()
    cache = FakeCollection()
    cache.docs["https://ballotpedia.org/x"] = {
        "url": "https://ballotpedia.org/x",
        "html": "<div id='mw-content-text'><h2>Cached</h2></div>",
        "fetched_at": datetime.now(timezone.utc),
    }
    soup = asyncio.run(
        server.fetch_page(
            "https://ballotpedia.org/x",
            transport=_explode_transport(),
            cache_collection=cache,
        )
    )
    assert soup.find("h2").get_text() == "Cached"


def test_cache_miss_fetches_then_stores(monkeypatch):
    server = _load_server()
    monkeypatch.setattr(server.asyncio, "sleep", _instant_sleep)
    cache = FakeCollection()
    soup = asyncio.run(
        server.fetch_page(
            "https://ballotpedia.org/x",
            transport=_ok_transport("<div id='mw-content-text'><h2>Fresh</h2></div>"),
            cache_collection=cache,
        )
    )
    assert soup.find("h2").get_text() == "Fresh"
    assert "https://ballotpedia.org/x" in cache.docs
    assert "Fresh" in cache.docs["https://ballotpedia.org/x"]["html"]


def test_stale_cache_refetches(monkeypatch):
    server = _load_server()
    monkeypatch.setattr(server.asyncio, "sleep", _instant_sleep)
    cache = FakeCollection()
    cache.docs["https://ballotpedia.org/x"] = {
        "url": "https://ballotpedia.org/x",
        "html": "<div id='mw-content-text'><h2>Old</h2></div>",
        "fetched_at": datetime.now(timezone.utc) - timedelta(days=365),
    }
    soup = asyncio.run(
        server.fetch_page(
            "https://ballotpedia.org/x",
            transport=_ok_transport("<div id='mw-content-text'><h2>New</h2></div>"),
            cache_collection=cache,
        )
    )
    assert soup.find("h2").get_text() == "New"


def test_cache_disabled_when_no_collection(monkeypatch):
    server = _load_server()
    monkeypatch.setattr(server.asyncio, "sleep", _instant_sleep)
    soup = asyncio.run(
        server.fetch_page(
            "https://ballotpedia.org/x",
            transport=_ok_transport("<div id='mw-content-text'><h2>NoCache</h2></div>"),
            cache_collection=None,
        )
    )
    assert soup.find("h2").get_text() == "NoCache"
