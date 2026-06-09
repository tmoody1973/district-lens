"""Ballotpedia has no scrapeable search endpoint, so search_candidates resolves a
name to its page directly and verifies the page exists (a MediaWiki redlink page
means "not found"). These cover the pure helpers behind that.
"""

from __future__ import annotations

import importlib.util

from bs4 import BeautifulSoup

from app.tools import ballotpedia_mcp_toolset as bp


def _load_server():
    spec = importlib.util.spec_from_file_location(
        "ballotpedia_server_candidate_test", bp._DEFAULT_SERVER_PATH
    )
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


_REAL_PAGE = """
<h1 id="firstHeading">Gwen Moore</h1>
<div id="mw-content-text">
  <p>Gwen Moore (Democratic Party) is a member of the U.S. House, representing
     Wisconsin's 4th Congressional District. She assumed office in 2005.</p>
</div>
"""

_REDLINK_PAGE = """
<h1 id="firstHeading">Zzqxnobody Fake</h1>
<div id="mw-content-text">
  <div class="noarticletext">There is currently no text in this page. This page does not exist.</div>
</div>
"""


def test_page_exists_true_for_real_page():
    server = _load_server()
    assert server._page_exists(BeautifulSoup(_REAL_PAGE, "html.parser")) is True


def test_page_exists_false_for_redlink_page():
    server = _load_server()
    assert server._page_exists(BeautifulSoup(_REDLINK_PAGE, "html.parser")) is False


def test_candidate_from_profile_page_extracts_fields():
    server = _load_server()
    soup = BeautifulSoup(_REAL_PAGE, "html.parser")
    c = server._candidate_from_profile_page(
        soup, "Gwen Moore", "https://ballotpedia.org/Gwen_Moore", "Wisconsin"
    )
    assert c["name"] == "Gwen Moore"
    assert c["party"] == "DEM"  # normalized from "Democratic Party"
    assert c["office"] == "U.S. House"
    assert c["state"] == "Wisconsin"
    assert c["status"] == "found"
    assert "Democratic Party" in c["snippet"]


def test_normalize_party_maps_common_parties():
    server = _load_server()
    assert server._normalize_party("Democratic Party") == "DEM"
    assert server._normalize_party("Republican Party") == "REP"
    assert server._normalize_party("Independent") == "IND"
    assert server._normalize_party("Green Party") == "Green Party"  # passthrough
