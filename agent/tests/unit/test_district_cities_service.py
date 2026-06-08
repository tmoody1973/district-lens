"""Unit tests for the district<->cities geography service (fake collection)."""

from __future__ import annotations

import pytest

from app.services.districts.cities import (
    build_city_query,
    find_districts_by_city,
    format_city_coverage_line,
    get_district_cities,
)

pytestmark = pytest.mark.unit


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def limit(self, n):
        return self._docs[:n]


class _FakeCollection:
    """Records the last query; returns canned docs regardless of query semantics."""

    def __init__(self, one=None, many=None):
        self._one = one
        self._many = many or []
        self.last_find_query = None
        self.last_limit_docs = None

    def find_one(self, query):
        self.last_find_query = query
        return self._one

    def find(self, query, projection=None):
        self.last_find_query = query
        return _FakeCursor(self._many)


def test_get_district_cities_shapes_doc_and_uppercases_id():
    col = _FakeCollection(
        one={
            "_id": "WI-04",
            "primary_city": "Milwaukee",
            "is_approximate_geography": True,
            "correlated_cities": [{"name": "Milwaukee"}, {"name": "West Allis"}, {"name": ""}],
        }
    )
    out = get_district_cities(col, "wi-04")
    assert col.last_find_query == {"_id": "WI-04"}       # normalized
    assert out["district_id"] == "WI-04"
    assert out["cities"] == ["Milwaukee", "West Allis"]  # blanks dropped
    assert out["primary_city"] == "Milwaukee"


def test_get_district_cities_returns_none_when_absent():
    assert get_district_cities(_FakeCollection(one=None), "ZZ-99") is None


def test_build_city_query_blank_is_none():
    assert build_city_query("   ") is None


def test_build_city_query_is_case_insensitive_anchored_escaped():
    q = build_city_query("St. Paul")
    regex = q["correlated_cities.ascii_name"]
    assert regex["$options"] == "i"
    assert regex["$regex"].startswith("^") and regex["$regex"].endswith("$")
    assert r"\." in regex["$regex"]  # special char escaped


def test_find_districts_by_city_blank_returns_empty_no_db():
    col = _FakeCollection(many=[{"_id": "X"}])
    assert find_districts_by_city(col, "") == []
    assert col.last_find_query is None  # short-circuited before query


def test_find_districts_by_city_shapes_results():
    col = _FakeCollection(
        many=[
            {"_id": "WI-04", "state": "WI", "state_name": "Wisconsin", "primary_city": "Milwaukee"},
            {"_id": "WI-05", "state": "WI", "state_name": "Wisconsin", "primary_city": "Waukesha"},
        ]
    )
    out = find_districts_by_city(col, "Milwaukee", limit=5)
    assert [d["district_id"] for d in out] == ["WI-04", "WI-05"]
    assert out[0]["state_name"] == "Wisconsin"


def test_format_city_coverage_line_empty():
    assert format_city_coverage_line({"cities": []}) == ""


def test_format_city_coverage_line_truncates_with_overflow():
    cities = [f"City{i}" for i in range(9)]
    line = format_city_coverage_line({"cities": cities})
    assert line.startswith("Covers (approx.): City0, City1")
    assert "(+3 more)" in line  # 9 - 6 shown
