"""Ballot-measure parsing must capture Ballotpedia's Subject column as a distinct
field so the generative-UI card can group measures by subject.

See docs/plans/2026-06-08-ballotpedia-generative-ui-design.md.
"""

from __future__ import annotations

import importlib.util

from bs4 import BeautifulSoup

from app.tools import ballotpedia_mcp_toolset as bp


def _load_server():
    spec = importlib.util.spec_from_file_location(
        "ballotpedia_server_under_test", bp._DEFAULT_SERVER_PATH
    )
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


_MEASURES_HTML = """
<table class="wikitable">
  <tr><th>Title</th><th>Type</th><th>Subject</th><th>Description</th></tr>
  <tr>
    <td><a href="/Question_1">Question 1</a></td>
    <td>Constitutional amendment</td>
    <td>Elections and campaigns</td>
    <td>Requires photo ID to vote.</td>
  </tr>
</table>
"""


def test_parse_measures_page_captures_subject_distinct_from_description():
    server = _load_server()
    soup = BeautifulSoup(_MEASURES_HTML, "html.parser")

    measures = server._parse_measures_page(soup, "Wisconsin", 2026)

    assert len(measures) == 1
    measure = measures[0]
    assert measure["subject"] == "Elections and campaigns"
    assert measure["description"] == "Requires photo ID to vote."
    assert measure["title"] == "Question 1"
