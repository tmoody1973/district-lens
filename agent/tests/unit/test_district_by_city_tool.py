"""Unit tests for the find_district_by_city ADK tool (envelope behavior)."""

from __future__ import annotations

import pytest

from app.tools import district_by_city as tool

pytestmark = pytest.mark.unit

_SENTINEL_COLLECTION = object()  # stand-in; the real query is monkeypatched out


def _patch(monkeypatch, *, collection, matches):
    monkeypatch.setattr(tool, "_get_districts_collection", lambda: collection)
    monkeypatch.setattr(tool, "find_districts_by_city", lambda col, city: matches)


def test_blank_city_is_error(monkeypatch):
    out = tool.find_district_by_city("   ")
    assert out["status"] == "error"


def test_no_collection_is_error(monkeypatch):
    _patch(monkeypatch, collection=None, matches=[])
    out = tool.find_district_by_city("Milwaukee")
    assert out["status"] == "error"
    assert "MONGODB_URI" in out["warnings"][0]


def test_no_matches_is_not_found(monkeypatch):
    _patch(monkeypatch, collection=_SENTINEL_COLLECTION, matches=[])
    out = tool.find_district_by_city("Nowheresville")
    assert out["status"] == "not_found"


def test_single_match_ok_envelope(monkeypatch):
    match = {"district_id": "WI-04", "state": "WI", "state_name": "Wisconsin", "primary_city": "Milwaukee"}
    _patch(monkeypatch, collection=_SENTINEL_COLLECTION, matches=[match])
    out = tool.find_district_by_city("Milwaukee")
    assert out["status"] == "ok"
    assert out["data"]["districts"] == [match]
    assert any("approximate" in w.lower() for w in out["warnings"])


def test_multi_match_adds_span_warning(monkeypatch):
    matches = [
        {"district_id": "TX-32", "state": "TX", "state_name": "Texas", "primary_city": "Dallas"},
        {"district_id": "TX-30", "state": "TX", "state_name": "Texas", "primary_city": "Dallas"},
    ]
    _patch(monkeypatch, collection=_SENTINEL_COLLECTION, matches=matches)
    out = tool.find_district_by_city("Dallas")
    assert out["status"] == "ok"
    assert any("spans 2 districts" in w for w in out["warnings"])
