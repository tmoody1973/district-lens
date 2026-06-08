"""get_elections_by_state must extract REAL races (the "Offices on the ballot"
link list), not the page's section headings.

Root cause + fix: docs handoff + memory districtlens_ballotpedia_elections_scrape_gap.
The fixture mirrors the live Wisconsin_elections,_2026 structure verified 2026-06-08.
"""

from __future__ import annotations

import importlib.util

from bs4 import BeautifulSoup

from app.tools import ballotpedia_mcp_toolset as bp


def _load_server():
    spec = importlib.util.spec_from_file_location(
        "ballotpedia_server_elections_test", bp._DEFAULT_SERVER_PATH
    )
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


# Mirrors the real page: an "Offices on the ballot" section whose div holds office
# links each followed by a duplicate "Click here", plus an editorial "scope" link
# without the year; surrounded by noise section headings.
_ELECTIONS_HTML = """
<div id="mw-content-text">
  <h2>Election dates</h2>
  <p>Statewide election dates info.</p>

  <h2>Offices on the ballot</h2>
  <div>
    Below is a list of Wisconsin elections covered by Ballotpedia in 2026.
    <a href="/United_States_House_of_Representatives_elections_in_Wisconsin,_2026">U.S. House</a>
    <a href="/United_States_House_of_Representatives_elections_in_Wisconsin,_2026">Click here</a>
    <a href="/Wisconsin_gubernatorial_and_lieutenant_gubernatorial_election,_2026">Governor</a>
    <a href="/Wisconsin_gubernatorial_and_lieutenant_gubernatorial_election,_2026">Click here</a>
    <a href="/Wisconsin_State_Senate_elections,_2026">State Senate</a>
    <a href="/Wisconsin_State_Senate_elections,_2026">Click here</a>
    <a href="/Elections_editorial_approach">Ballotpedia's scope</a>
  </div>

  <h2>What's on your ballot?</h2>
  <p><a href="/Sample_Ballot_Lookup">Sample Ballot Lookup</a></p>

  <h2>List of candidates</h2>
  <p><a href="/List_of_candidates">click here</a></p>
</div>
"""


def test_extracts_real_offices_not_section_headings():
    server = _load_server()
    soup = BeautifulSoup(_ELECTIONS_HTML, "html.parser")

    races = server._parse_state_elections_page(soup, 2026)
    titles = [r["title"] for r in races]

    assert "U.S. House" in titles
    assert "Governor" in titles
    assert "State Senate" in titles
    # Section headings must NOT appear as races.
    assert "What's on your ballot?" not in titles
    assert "List of candidates" not in titles
    assert "Offices on the ballot" not in titles


def test_excludes_click_here_and_editorial_links():
    server = _load_server()
    soup = BeautifulSoup(_ELECTIONS_HTML, "html.parser")

    races = server._parse_state_elections_page(soup, 2026)
    titles = [r["title"] for r in races]

    assert "Click here" not in titles
    assert "Ballotpedia's scope" not in titles  # editorial link lacks the year


def test_dedupes_by_url_and_sets_fields():
    server = _load_server()
    soup = BeautifulSoup(_ELECTIONS_HTML, "html.parser")

    races = server._parse_state_elections_page(soup, 2026)

    # Exactly the 3 real offices, deduped (office link + "Click here" → one race).
    assert len(races) == 3
    gov = next(r for r in races if r["title"] == "Governor")
    assert gov["office_type"] == "Governor"
    assert gov["url"].startswith("https://ballotpedia.org/")
    assert gov["date"] == "November 3, 2026"
    assert "candidates_preview" in gov


def test_returns_empty_when_offices_section_absent():
    server = _load_server()
    soup = BeautifulSoup(
        "<div id='mw-content-text'><h2>Election dates</h2><p>nope</p></div>",
        "html.parser",
    )
    assert server._parse_state_elections_page(soup, 2026) == []


def test_classify_office_distinguishes_state_house_from_us_house():
    server = _load_server()
    assert server._classify_office("U.S. House") == "U.S. House"
    assert server._classify_office("State House") == "State Assembly"
    assert server._classify_office("State Senate") == "State Senate"
    assert server._classify_office("Governor") == "Governor"
