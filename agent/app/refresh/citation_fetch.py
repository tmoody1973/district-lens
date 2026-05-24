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

# Hints that indicate an authoritative primary-results source. Documentary
# reference only — scoring is done by _score_url with anchored host matching,
# NOT by naive substring search (which is spoofable; see _score_url).
AUTHORITATIVE_HINTS: tuple[str, ...] = (
    ".gov",
    "sos.",
    "apnews.com",
    "/election",
    "secretary of state",
)

# HOST authoritative signals (anchored against the hostname, never the path).
# A government .gov host is the gold standard for official election results;
# its score is kept strictly above any non-gov host signal PLUS the path bonus
# so a bare .gov always outranks AP-news-with-an-/elections-path.
_GOV_HOST_SCORE = 25
# AP Elections is an authoritative wire service.
_APNEWS_HOST_SCORE = 15
# A Secretary-of-State subdomain (sos.*). Most are also .gov, so this stacks.
_SOS_HOST_SCORE = 10

# PATH bonus ONLY — strictly additive, must NEVER alone clear the threshold.
# An "/election" path on a non-authoritative host must still fail.
_ELECTION_PATH_BONUS = 5

# Minimum total score to be considered authoritative. Set ABOVE the path-only
# bonus so that path text alone (e.g. "/elections" on a random blog) never
# qualifies — a HOST signal is required.
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


def _host_of(url: str) -> str:
    """Return the lowercased hostname (no port) of a URL, or '' on parse error."""
    try:
        netloc = urlparse(url).netloc.lower()
    except Exception:
        return ""
    # Strip any port suffix (urlparse keeps it on netloc, e.g. "host:8080").
    return netloc.split(":", 1)[0]


def _score_url(url: str) -> int:
    """Return an integer authority score for a single URL.

    Authority credit comes from the HOST (hostname), with matches anchored so
    they cannot be spoofed by attacker-controlled path or subdomain text:

    - ``host.endswith(".gov")`` (or host == "gov") — a real government TLD,
      NOT ".gov" appearing inside a path like ``evil.com/.gov/fake``.
    - ``host == "apnews.com"`` or ``host.endswith(".apnews.com")`` — AP, NOT
      ``apnews.com`` embedded in some other registrable domain.
    - Secretary-of-State subdomain: ``host.startswith("sos.")`` or
      ``".sos." in host`` — an actual subdomain label, NOT "sos." floating
      anywhere in the netloc (which ``notarealsos.com.attacker.net`` exploited).

    The PATH only contributes a small additive bonus (``/election``) that is
    strictly below ``_MIN_AUTHORITATIVE_SCORE`` on its own, so path text never
    qualifies a non-authoritative host.

    Returns 0 (not authoritative) for denied hosts and anything without a HOST
    signal.
    """
    host = _host_of(url)
    if not host:
        return 0

    # Deny aggregators / low-quality sources outright (host-based).
    if host in _DENY_LIST:
        return 0
    for substring in _DENY_SUBSTRINGS:
        if substring in host:
            return 0

    score = 0

    # HOST signals — anchored, never substring-anywhere.
    if host == "gov" or host.endswith(".gov"):
        score += _GOV_HOST_SCORE
    if host == "apnews.com" or host.endswith(".apnews.com"):
        score += _APNEWS_HOST_SCORE
    if host.startswith("sos.") or ".sos." in host:
        score += _SOS_HOST_SCORE

    # PATH bonus ONLY — additive, cannot clear the threshold by itself.
    try:
        path = urlparse(url).path.lower()
    except Exception:
        path = ""
    if "/election" in path:
        score += _ELECTION_PATH_BONUS

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
