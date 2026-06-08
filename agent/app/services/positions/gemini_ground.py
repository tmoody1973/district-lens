"""``gemini_grounded_search`` — the broad-tier retrieval engine on Gemini grounding.

One grounded ``gemini-3.5-flash`` call (Google Search grounding) retrieves a
candidate's positions AND returns the real named sources behind the answer. Each
grounding chunk carries a ``vertexaisearch.cloud.google.com`` redirect; we resolve
it to its real page and archive that page via the evidence store BEFORE it can be
cited (citations.md). The result is the ``(answer, sources)`` pair the broad tier's
structurer already expects, so this drops into ``_broad_research`` as a ``SearchFn``.

Why grounding over the Perplexity API: it finds low-profile challengers the
Perplexity API cannot, at ~1/43rd the cost, faster, with citable named domains, on
the pure Google stack (verified: docs/handoffs/2026-06-08-gemini-grounding-positions.md).

Every external call (``generate_fn`` / ``resolve_fn`` / ``scrape_fn``) is injected so
unit tests run network-free. ``generate_fn`` failures propagate so the caller
(``_broad_research``) degrades to an honest empty; per-source resolve/archive failures
degrade gracefully (that one source is skipped or kept un-archived).
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Awaitable, Callable

import httpx

from app.services.evidence.schema import SourceDocumentRef
from app.services.evidence.store import fetch_and_store_source

logger = logging.getLogger(__name__)

_MODEL = "gemini-3.5-flash"  # grounded retrieval ONLY (project mandate); never for reasoning
_DEFAULT_LOCATION = "global"
_THINKING_LEVEL = "MEDIUM"
_RESOLVE_TIMEOUT_SECONDS = 15.0

# A grounding chunk reduced to (real-domain title, redirect uri).
GroundedChunk = tuple[str, str]
GenerateFn = Callable[[str], Awaitable[tuple[str, list[GroundedChunk]]]]
ResolveFn = Callable[[str], Awaitable[str | None]]
ScrapeFn = Callable[[str], Awaitable[SourceDocumentRef | None]]


# ---------------------------------------------------------------------------
# Network defaults (replaced by injected fakes in tests)
# ---------------------------------------------------------------------------


def _extract_chunks(response: object) -> list[GroundedChunk]:
    """Pull (title, uri) grounding chunks out of a genai response, defensively.

    The shape is ``response.candidates[0].grounding_metadata.grounding_chunks[i].web``
    with ``.title`` (the real domain) and ``.uri`` (the redirect). Any missing layer
    yields an empty list rather than raising.
    """
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return []
    metadata = getattr(candidates[0], "grounding_metadata", None)
    chunks = getattr(metadata, "grounding_chunks", None) or []
    pairs: list[GroundedChunk] = []
    for chunk in chunks:
        web = getattr(chunk, "web", None)
        uri = getattr(web, "uri", None)
        if web and uri:
            pairs.append((getattr(web, "title", "") or "", uri))
    return pairs


def _generate_sync(prompt: str) -> tuple[str, list[GroundedChunk]]:
    """Blocking grounded ``gemini-3.5-flash`` call. Returns (answer, chunks)."""
    import google.genai as genai
    from google.genai import types

    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project:
        raise ValueError("GOOGLE_CLOUD_PROJECT environment variable is not set")
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", _DEFAULT_LOCATION)

    client = genai.Client(vertexai=True, project=project, location=location)
    config = types.GenerateContentConfig(
        tools=[types.Tool(google_search=types.GoogleSearch())],
        thinking_config=types.ThinkingConfig(thinking_level=_THINKING_LEVEL),
    )
    response = client.models.generate_content(model=_MODEL, contents=prompt, config=config)
    return response.text or "", _extract_chunks(response)


async def _default_generate(prompt: str) -> tuple[str, list[GroundedChunk]]:
    """Offload the blocking grounded SDK call so it runs under asyncio.gather."""
    return await asyncio.to_thread(_generate_sync, prompt)


async def _default_resolve(uri: str) -> str | None:
    """Resolve a grounding redirect to its real page URL. None on any failure."""
    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=_RESOLVE_TIMEOUT_SECONDS
        ) as client:
            response = await client.get(uri)
        return str(response.url)
    except Exception as exc:  # transport error → this source is dropped
        logger.warning("gemini_ground: redirect resolve failed for %s: %s", uri, exc)
        return None


# ---------------------------------------------------------------------------
# Source assembly
# ---------------------------------------------------------------------------


def _build_source(title: str, url: str, ref: SourceDocumentRef | None) -> dict:
    """Build a T4 source dict; carry ``sourceDocumentId`` only when archived."""
    source: dict = {
        "title": title or url,
        "url": url,
        "date": None,
        "snippet": "",
        "archived": ref is not None,
    }
    if ref is not None:
        source["archivedAt"] = ref.fetched_at.isoformat() if ref.fetched_at else None
        source["sourceDocumentId"] = ref.id
        source["contentLength"] = ref.content_length
    return source


async def _resolve_and_archive(
    title: str, uri: str, resolve_fn: ResolveFn, scrape_fn: ScrapeFn
) -> dict | None:
    """Resolve one redirect, archive the real page, return its source dict.

    A redirect that won't resolve is dropped (None). A resolve that succeeds but
    fails to archive is KEPT with ``archived: False`` (no ``sourceDocumentId``) — the
    URL is still a real, citable handle and the brief pipeline archives lazily later.
    """
    real_url = await resolve_fn(uri)
    if not real_url:
        return None
    try:
        ref = await scrape_fn(real_url)
    except Exception as exc:  # archive failure must not drop a real source
        logger.warning("gemini_ground: archive failed for %s: %s", real_url, exc)
        ref = None
    return _build_source(title, real_url, ref)


async def gemini_grounded_search(
    prompt: str,
    *,
    generate_fn: GenerateFn = _default_generate,
    resolve_fn: ResolveFn = _default_resolve,
    scrape_fn: ScrapeFn = fetch_and_store_source,
) -> tuple[str, list[dict]]:
    """Grounded retrieve → resolve+archive each source → (answer, citable sources).

    ``SearchFn``-compatible so it slots straight into ``_broad_research``. A
    ``generate_fn`` failure propagates (the caller turns it into an honest empty);
    per-source failures degrade. Sources are deduped by resolved URL.
    """
    answer, chunks = await generate_fn(prompt)
    results = await asyncio.gather(
        *(_resolve_and_archive(title, uri, resolve_fn, scrape_fn) for title, uri in chunks)
    )

    sources: list[dict] = []
    seen: set[str] = set()
    for source in results:
        if source is None or source["url"] in seen:
            continue
        seen.add(source["url"])
        sources.append(source)
    return answer, sources
