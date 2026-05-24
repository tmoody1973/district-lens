"""Tests for citation_fetch: authoritative URL selection and results page fetching.

Design contract:
- pick_authoritative_url is conservative: it returns None whenever no URL
  clearly belongs to an authoritative source, so the downstream pipeline
  flags rather than confirms on a weak citation.
- fetch_results_page injects the httpx client so tests never hit the network.
"""

from __future__ import annotations

import pytest

from app.refresh import citation_fetch as cf

# ---------------------------------------------------------------------------
# pick_authoritative_url
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_pick_authoritative_prefers_gov():
    """.gov URL must beat a Ballotpedia URL."""
    srcs = [
        {"url": "https://ballotpedia.org/x"},
        {"url": "https://sos.ga.gov/results"},
    ]
    assert cf.pick_authoritative_url(srcs) == "https://sos.ga.gov/results"


@pytest.mark.unit
def test_pick_authoritative_none_when_only_aggregators():
    """Reddit and WordPress-style aggregators must yield None (no authoritative URL)."""
    srcs = [
        {"url": "https://reddit.com/x"},
        {"url": "https://somewordpressblog.com/y"},
    ]
    assert cf.pick_authoritative_url(srcs) is None


@pytest.mark.unit
def test_pick_authoritative_apnews_is_authoritative():
    """AP News (apnews.com) must be treated as an authoritative source."""
    srcs = [
        {"url": "https://ballotpedia.org/ga"},
        {"url": "https://apnews.com/elections/georgia-2026"},
    ]
    result = cf.pick_authoritative_url(srcs)
    assert result == "https://apnews.com/elections/georgia-2026"


@pytest.mark.unit
def test_pick_authoritative_gov_with_elections_path_preferred():
    """A .gov URL that also contains /elections path should be chosen."""
    srcs = [
        {"url": "https://apnews.com/hub/election"},
        {"url": "https://sos.wi.gov/elections/results"},
    ]
    result = cf.pick_authoritative_url(srcs)
    # .gov beats AP; also has /elections path for bonus
    assert result == "https://sos.wi.gov/elections/results"


@pytest.mark.unit
def test_pick_authoritative_empty_list_returns_none():
    """Empty source list must return None without crashing."""
    assert cf.pick_authoritative_url([]) is None


@pytest.mark.unit
def test_pick_authoritative_missing_url_key_does_not_crash():
    """Source dicts missing the 'url' key must be skipped, not crash."""
    srcs = [
        {"title": "No URL here"},
        {"url": "https://sos.tx.gov/elections"},
    ]
    result = cf.pick_authoritative_url(srcs)
    assert result == "https://sos.tx.gov/elections"


@pytest.mark.unit
def test_pick_authoritative_only_wikipedia_returns_none():
    """Wikipedia is an aggregator/tertiary source and must not qualify."""
    srcs = [{"url": "https://en.wikipedia.org/wiki/2026_elections"}]
    assert cf.pick_authoritative_url(srcs) is None


@pytest.mark.unit
def test_pick_authoritative_ballotpedia_alone_returns_none():
    """Ballotpedia is an aggregator and must not qualify alone."""
    srcs = [{"url": "https://ballotpedia.org/Georgia_2026"}]
    assert cf.pick_authoritative_url(srcs) is None


@pytest.mark.unit
def test_pick_authoritative_gov_beats_apnews():
    """.gov URL must score higher than AP News."""
    srcs = [
        {"url": "https://apnews.com/elections/ga"},
        {"url": "https://elections.georgia.gov/results"},
    ]
    result = cf.pick_authoritative_url(srcs)
    assert result == "https://elections.georgia.gov/results"


@pytest.mark.unit
def test_pick_authoritative_sos_subdomain_is_authoritative():
    """A URL with 'sos.' as a hostname subdomain must qualify as authoritative."""
    srcs = [
        {"url": "https://www.somesite.com/news"},
        {"url": "https://sos.nc.gov/elections/results"},
    ]
    result = cf.pick_authoritative_url(srcs)
    assert result is not None
    assert "sos.nc.gov" in result


# ---------------------------------------------------------------------------
# Adversarial: URL-spoofing must NOT be accepted (civic-safety)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_pick_authoritative_rejects_gov_in_path_spoof():
    """'.gov' in the PATH of an attacker host must not confer authority."""
    srcs = [{"url": "https://evil.com/.gov/fake"}]
    assert cf.pick_authoritative_url(srcs) is None


@pytest.mark.unit
def test_pick_authoritative_rejects_sos_substring_spoof():
    """'sos.' as a bare substring (not a real subdomain) must not confer authority."""
    srcs = [{"url": "https://notarealsos.com.attacker.net/x"}]
    assert cf.pick_authoritative_url(srcs) is None


@pytest.mark.unit
def test_pick_authoritative_rejects_aggregator_with_sos_query_param():
    """A denied aggregator must stay denied regardless of a 'sos.gov' query param."""
    srcs = [{"url": "https://ballotpedia.org/results?ref=sos.gov"}]
    assert cf.pick_authoritative_url(srcs) is None


@pytest.mark.unit
def test_pick_authoritative_rejects_election_path_only():
    """A non-gov host with an '/elections' path alone must NOT qualify.

    The path bonus is strictly additive and below the threshold, so a HOST
    signal is required — path text can never qualify a source by itself.
    """
    srcs = [{"url": "https://randomblog.com/elections/2026"}]
    assert cf.pick_authoritative_url(srcs) is None


@pytest.mark.unit
def test_pick_authoritative_rejects_apnews_embedded_in_other_domain():
    """'apnews.com' embedded as a label in another registrable domain must fail."""
    srcs = [{"url": "https://apnews.com.attacker.net/results"}]
    assert cf.pick_authoritative_url(srcs) is None


@pytest.mark.unit
def test_pick_authoritative_positive_regressions_still_qualify():
    """Genuine authoritative hosts must still be accepted after the spoof fixes."""
    assert (
        cf.pick_authoritative_url([{"url": "https://apnews.com/article/x"}])
        == "https://apnews.com/article/x"
    )
    assert (
        cf.pick_authoritative_url([{"url": "https://elections.maryland.gov/results"}])
        == "https://elections.maryland.gov/results"
    )


@pytest.mark.unit
def test_pick_authoritative_gov_wins_over_spoof_and_aggregator():
    """Among a real .gov, a .gov-in-path spoof, and an aggregator, the .gov wins."""
    srcs = [
        {"url": "https://evil.com/.gov/fake"},
        {"url": "https://ballotpedia.org/x"},
        {"url": "https://sos.ga.gov/elections/results"},
    ]
    assert (
        cf.pick_authoritative_url(srcs) == "https://sos.ga.gov/elections/results"
    )


# ---------------------------------------------------------------------------
# fetch_results_page — injected fake clients (no network)
# ---------------------------------------------------------------------------


class _FakeResponse:
    """Minimal httpx.Response stand-in."""

    def __init__(self, status_code: int, text: str = "") -> None:
        self.status_code = status_code
        self.text = text


class _FakeClient:
    """Synchronous-style fake that works as an async context manager."""

    def __init__(self, response: _FakeResponse) -> None:
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def get(self, url: str, **kwargs) -> _FakeResponse:
        return self._response


class _TimeoutClient:
    """Client that raises httpx.TimeoutException on every GET."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def get(self, url: str, **kwargs):
        import httpx

        raise httpx.TimeoutException("timed out")


class _ErrorClient:
    """Client that raises a generic exception on every GET."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def get(self, url: str, **kwargs):
        raise RuntimeError("network failure")


def _fake_factory(response: _FakeResponse):
    """Return a callable that ignores kwargs and returns the fake client."""

    def _factory(**kwargs):
        return _FakeClient(response)

    return _factory


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_results_page_200_returns_text_and_publisher():
    """HTTP 200 must return (body_text, publisher_host)."""
    fake_resp = _FakeResponse(200, "<html>Official GA results page</html>")
    text, publisher = await cf.fetch_results_page(
        "https://sos.ga.gov/results",
        client_factory=_fake_factory(fake_resp),
    )
    assert "Official GA results page" in text
    assert publisher == "sos.ga.gov"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_results_page_404_returns_none():
    """HTTP 404 must return None (no citation stored for a missing page)."""
    fake_resp = _FakeResponse(404, "Not Found")
    result = await cf.fetch_results_page(
        "https://sos.ga.gov/bad-path",
        client_factory=_fake_factory(fake_resp),
    )
    assert result is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_results_page_500_returns_none():
    """HTTP 500 must return None."""
    fake_resp = _FakeResponse(500, "Internal Server Error")
    result = await cf.fetch_results_page(
        "https://sos.ga.gov/results",
        client_factory=_fake_factory(fake_resp),
    )
    assert result is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_results_page_timeout_returns_none():
    """A timeout exception must be caught and return None (no crash)."""

    def _factory(**kwargs):
        return _TimeoutClient()

    result = await cf.fetch_results_page(
        "https://sos.ga.gov/results",
        client_factory=_factory,
    )
    assert result is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_results_page_generic_error_returns_none():
    """Any unexpected exception must be caught and return None (no crash)."""

    def _factory(**kwargs):
        return _ErrorClient()

    result = await cf.fetch_results_page(
        "https://sos.ga.gov/results",
        client_factory=_factory,
    )
    assert result is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_results_page_publisher_is_hostname():
    """publisher must be the bare hostname extracted from the URL."""
    fake_resp = _FakeResponse(200, "body text")
    _, publisher = await cf.fetch_results_page(
        "https://apnews.com/elections/georgia-2026",
        client_factory=_fake_factory(fake_resp),
    )
    assert publisher == "apnews.com"
