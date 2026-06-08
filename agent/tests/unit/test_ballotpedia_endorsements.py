"""Endorsement extraction must drop Ballotpedia's boilerplate framing.

The "Endorsements" section text reads, e.g.:
  "Moore received the following endorsements. To send us additional
   endorsements, click here. Sierra Club"
Only "Sierra Club" is a real endorsement; the rest is page furniture.
"""

from __future__ import annotations

import importlib.util

from app.tools import ballotpedia_mcp_toolset as bp


def _load_server():
    spec = importlib.util.spec_from_file_location(
        "ballotpedia_server_endorse_test", bp._DEFAULT_SERVER_PATH
    )
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_strips_intro_and_instruction_boilerplate():
    server = _load_server()
    text = (
        "Moore received the following endorsements. "
        "To send us additional endorsements, click here. Sierra Club"
    )
    assert server._parse_endorsements(text) == ["Sierra Club"]


def test_keeps_multiple_real_endorsements_drops_boilerplate():
    server = _load_server()
    text = (
        "Smith received the following endorsements.\n"
        "Sierra Club\n"
        "AFL-CIO\n"
        "To send us additional endorsements, click here."
    )
    assert server._parse_endorsements(text) == ["Sierra Club", "AFL-CIO"]


def test_returns_empty_for_blank_or_pure_boilerplate():
    server = _load_server()
    assert server._parse_endorsements("") == []
    assert server._parse_endorsements(
        "To send us additional endorsements, click here."
    ) == []


def test_does_not_split_org_names_with_internal_periods():
    server = _load_server()
    # "U.S. Chamber of Commerce" must survive as one entry (no period over-split).
    text = "Jones received the following endorsements. U.S. Chamber of Commerce"
    assert server._parse_endorsements(text) == ["U.S. Chamber of Commerce"]
