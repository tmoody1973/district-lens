"""Tests for the pure (non-network) helpers in the positions extractor.

The Gemini call itself is network-bound and exercised via the injected
``structure_fn`` in ``test_positions_research``; here we lock down the pure
provenance-tagging and stance-mapping logic that drives the no-inference shape.
"""

from __future__ import annotations

import pytest

from app.services.positions.extract import _evidence_type_for, _to_position


@pytest.mark.unit
def test_questionnaire_host_tags_questionnaire():
    assert _evidence_type_for("https://www.vote411.org/jane-doe") == "questionnaire"


@pytest.mark.unit
def test_ballotpedia_host_tags_questionnaire():
    assert _evidence_type_for("https://ballotpedia.org/Jane_Doe") == "questionnaire"


@pytest.mark.unit
def test_own_site_tags_direct_quote():
    assert _evidence_type_for("https://janedoe.com/issues") == "direct_quote"


@pytest.mark.unit
def test_to_position_maps_source_index():
    sources = [{"url": "https://janedoe.com/issues", "archived": True, "sourceDocumentId": "d1"}]
    raw = {"issue": "health care", "statement": "Supports lowering premiums.", "source_index": 0}
    position = _to_position(raw, sources)
    assert position is not None
    assert position["issue"] == "health care"
    assert position["sources"][0]["sourceDocumentId"] == "d1"
    assert position["evidenceType"] == "direct_quote"


@pytest.mark.unit
def test_to_position_rejects_out_of_range_index():
    sources = [{"url": "https://janedoe.com/issues"}]
    raw = {"issue": "x", "statement": "y", "source_index": 7}
    assert _to_position(raw, sources) is None
