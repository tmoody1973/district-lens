"""Fetch and classify authoritative election-results pages for citations.

Two public functions:

  pick_authoritative_url(sources) -> str | None
      Scores each source URL and returns the highest-scoring authoritative URL,
      or None if none qualify.  Bias is toward None: when uncertain, the
      pipeline should flag the race rather than confirm on a weak citation.

  fetch_results_page(url, *, client_factory) -> (text, publisher) | None
      GETs the page with a timeout; returns (body_text, hostname) on HTTP 200
      or None on any non-200 status, timeout, or unexpected error.

No network access in tests — inject client_factory with a fake async client.
"""

from __future__ import annotations

import logging
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# URL scoring constants
# ---------------------------------------------------------------------------

# Hints that indicate an authoritative primary-results source.
# Each hint that matches the URL's netloc or path adds _HINT_SCORE points.
AUTHORITATIVE_HINTS: tuple[str, ...] = (
    ".gov",
    "sos.",
    "apnews.com",
    "/elections",
    "secretary of state",  # unlikely in a URL, but kept for completeness
)

# Each hint match earns this score.
_HINT_SCORE = 10

# Extra bonus for a .gov domain — state/federal government sources outrank
# wire services and other authoritative-but-non-government sources.
_GOV_DOMAIN_BONUS = 15

# A .gov domain AND an /elections path is a particularly strong signal.
_GOV_ELECTIONS_BONUS = 5

# Minimum total score required to be considered authoritative.
# A single hint match (score = 10) qualifies; a score of 0 does not.
_MIN_AUTHORITATIVE_SCORE = 10

# Aggregators / secondary sources that should be denied even if they happen
# to match a hint (none currently should, but belt-and-suspenders).
_DENY_LIST: frozenset[str] = frozenset(
    {
        "ballotpedia.org",
        "wikipedia.org",
        "reddit.com",
        "facebook.com",
        "twitter.com",
        "x.com",
        "wordpress.com",
    }
)

# Substrings in a hostname that suggest a low-quality aggregator or blog.
_DENY_SUBSTRINGS: tuple[str, ...] = (
    "wordpress",
    "blogspot",
    "tumblr",
    "medium.com",
    "substack.com",
)

# ---------------------------------------------------------------------------
# HTTP fetch constants (mirroring position_search.py conventions)
# ---------------------------------------------------------------------------

_TIMEOUT_SECONDS = 30.0
_HEADERS = {
    "User-Agent": (
        "DistrictLens/1.0 (+https://github.com/districtlens) "
        "Mozilla/5.0 (compatible; civic-data-bot)"
    ),
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _score_url(url: str) -> int:
    """Return an integer authority score for a single URL.

    Higher is more authoritative.  0 means clearly not authoritative.
    Negative scores are not used — denied URLs simply score 0.
    """
    try:
        parsed = urlparse(url)
    except Exception:
        return 0

    netloc = parsed.netloc.lower()
    path = parsed.path.lower()

    # Deny aggregators / low-quality sources outright.
    if netloc in _DENY_LIST:
        return 0
    for substring in _DENY_SUBSTRINGS:
        if substring in netloc:
            return 0

    score = 0

    # Check each authoritative hint against both netloc and path.
    for hint in AUTHORITATIVE_HINTS:
        if hint in netloc or hint in path:
            score += _HINT_SCORE

    # Extra bonus for .gov TLD — government domains are the gold standard
    # for official state election results and must outscore wire services.
    if ".gov" in netloc:
        score += _GOV_DOMAIN_BONUS

    # Additional bonus for .gov + /elections combination.
    if ".gov" in netloc and "/elections" in path:
        score += _GOV_ELECTIONS_BONUS

    return score


# ---------------------------------------------------------------------------
# Public: pick_authoritative_url
# ---------------------------------------------------------------------------


def pick_authoritative_url(sources: list[dict]) -> str | None:
    """Return the most authoritative URL from a Perplexity source list, or None.

    Each source is expected to be a dict with at least a 'url' key (as
    produced by position_search._normalize_sources).  Dicts missing 'url'
    are silently skipped.

    Returns None when:
    - sources is empty.
    - No URL reaches the minimum authority score.
    - All URLs belong to denied aggregators (Ballotpedia, Wikipedia, etc.).

    This conservative design means the downstream gate receives None and
    marks the race provisional rather than confirming on a weak source.
    """
    best_url: str | None = None
    best_score = 0

    for source in sources:
        url = source.get("url")
        if not url or not isinstance(url, str):
            continue

        score = _score_url(url)
        if score > best_score:
            best_score = score
            best_url = url

    if best_score < _MIN_AUTHORITATIVE_SCORE:
        return None

    return best_url


# ---------------------------------------------------------------------------
# Public: fetch_results_page
# ---------------------------------------------------------------------------


async def fetch_results_page(
    url: str,
    *,
    client_factory=httpx.AsyncClient,
) -> tuple[str, str] | None:
    """GET the results page and return (body_text, publisher_hostname) on success.

    Args:
        url:            The URL to fetch.
        client_factory: Callable that returns an async context-manager HTTP
                        client.  Defaults to httpx.AsyncClient.  Inject a
                        fake in tests to avoid network I/O.

    Returns:
        (text, publisher) where publisher is the bare hostname (e.g.
        "sos.ga.gov"), or None on HTTP non-200, timeout, or any error.

    This mirrors the httpx usage pattern in position_search._perplexity_search
    (AsyncClient as context manager, explicit timeout, structured headers).
    """
    try:
        parsed = urlparse(url)
        publisher = parsed.netloc.lower()

        async with client_factory(timeout=_TIMEOUT_SECONDS, headers=_HEADERS) as client:
            response = await client.get(url)

        if response.status_code != 200:
            logger.warning(
                "fetch_results_page: non-200 for %s (status=%d)",
                url,
                response.status_code,
            )
            return None

        return response.text, publisher

    except httpx.TimeoutException as exc:
        logger.warning("fetch_results_page: timeout for %s: %s", url, exc)
        return None
    except Exception as exc:
        logger.warning("fetch_results_page: error for %s: %s", url, exc)
        return None
