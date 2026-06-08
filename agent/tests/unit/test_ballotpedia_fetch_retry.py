"""fetch_page must not silently parse a bot-challenge page.

Ballotpedia returns HTTP 202 (Cloudflare-style challenge) to Cloud Run's IP.
raise_for_status() ignores 202, so the old fetch_page returned a challenge page
that downstream parsers read as "no results". fetch_page now retries non-200 and
raises on a persistent non-200 so callers fail honestly.
"""

from __future__ import annotations

import asyncio
import importlib.util

import httpx
import pytest

from app.tools import ballotpedia_mcp_toolset as bp


def _load_server():
    spec = importlib.util.spec_from_file_location(
        "ballotpedia_server_fetch_test", bp._DEFAULT_SERVER_PATH
    )
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


async def _instant_sleep(*_args, **_kwargs):
    return None


def _transport_returning(status_codes):
    """MockTransport that returns the given status codes in sequence."""
    sequence = iter(status_codes)

    def handler(request: httpx.Request) -> httpx.Response:
        code = next(sequence)
        body = (
            "<div id='mw-content-text'><h2>Offices on the ballot</h2></div>"
            if code == 200
            else "<html><body>Just a moment…</body></html>"
        )
        return httpx.Response(code, text=body)

    return httpx.MockTransport(handler)


def test_fetch_page_retries_non_200_then_succeeds(monkeypatch):
    server = _load_server()
    monkeypatch.setattr(server.asyncio, "sleep", _instant_sleep)

    transport = _transport_returning([202, 202, 200])
    soup = asyncio.run(
        server.fetch_page("https://ballotpedia.org/x", transport=transport)
    )
    assert soup.find("h2") is not None  # got the real page, not the challenge


def test_fetch_page_raises_on_persistent_bot_challenge(monkeypatch):
    server = _load_server()
    monkeypatch.setattr(server.asyncio, "sleep", _instant_sleep)
    monkeypatch.delenv("FIRECRAWL_API_KEY", raising=False)  # no fallback → raise

    transport = _transport_returning([202, 202, 202])
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(
            server.fetch_page("https://ballotpedia.org/x", transport=transport)
        )


def test_fetch_page_still_raises_on_404(monkeypatch):
    server = _load_server()
    monkeypatch.setattr(server.asyncio, "sleep", _instant_sleep)
    monkeypatch.delenv("FIRECRAWL_API_KEY", raising=False)

    transport = _transport_returning([404, 404, 404])
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(
            server.fetch_page("https://ballotpedia.org/missing", transport=transport)
        )


def _firecrawl_post_returning(rawhtml: str | None, *, success: bool = True, status: int = 200):
    """An injectable stand-in for the Firecrawl POST call."""

    async def post(endpoint, json=None, headers=None):
        body = {"success": success, "data": {"rawHtml": rawhtml} if rawhtml is not None else {}}
        return httpx.Response(status, json=body)

    return post


def test_fetch_page_falls_back_to_firecrawl_on_persistent_non_200(monkeypatch):
    server = _load_server()
    monkeypatch.setattr(server.asyncio, "sleep", _instant_sleep)
    monkeypatch.setenv("FIRECRAWL_API_KEY", "fc-test")

    transport = _transport_returning([202, 202, 202])  # direct stays challenged
    firecrawl = _firecrawl_post_returning(
        "<div id='mw-content-text'><h2>Offices on the ballot</h2></div>"
    )
    soup = asyncio.run(
        server.fetch_page(
            "https://ballotpedia.org/x", transport=transport, firecrawl_post=firecrawl
        )
    )
    assert soup.find("h2").get_text() == "Offices on the ballot"


def test_fetch_page_skips_firecrawl_when_direct_succeeds(monkeypatch):
    server = _load_server()
    monkeypatch.setattr(server.asyncio, "sleep", _instant_sleep)
    monkeypatch.setenv("FIRECRAWL_API_KEY", "fc-test")

    async def _explode(*_a, **_k):
        raise AssertionError("Firecrawl must not be called when direct fetch succeeds")

    transport = _transport_returning([200])
    soup = asyncio.run(
        server.fetch_page(
            "https://ballotpedia.org/x", transport=transport, firecrawl_post=_explode
        )
    )
    assert soup is not None


def test_fetch_page_raises_when_direct_and_firecrawl_both_fail(monkeypatch):
    server = _load_server()
    monkeypatch.setattr(server.asyncio, "sleep", _instant_sleep)
    monkeypatch.setenv("FIRECRAWL_API_KEY", "fc-test")

    transport = _transport_returning([202, 202, 202])
    firecrawl = _firecrawl_post_returning(None, success=False, status=500)
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(
            server.fetch_page(
                "https://ballotpedia.org/x", transport=transport, firecrawl_post=firecrawl
            )
        )
