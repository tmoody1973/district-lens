"""Unit tests for the district→cities import (key normalization + doc shape)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from scripts.import_district_cities import build_district_doc, normalize_district_id

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("AK-AL", "AK-01"),   # at-large -> repo's -01 convention
        ("VT-AL", "VT-01"),
        ("WY-AL", "WY-01"),
        ("AL-01", "AL-01"),   # already padded numbered district
        ("TX-3", "TX-03"),    # defensive zero-pad
        ("ca-12", "CA-12"),   # state upper-cased
    ],
)
def test_normalize_district_id(raw, expected):
    assert normalize_district_id(raw) == expected


def test_build_district_doc_maps_fields_and_flags_approximate():
    now = datetime.now(UTC)
    raw = {
        "district_id": "AK-AL",
        "state": "AK",
        "state_name": "Alaska",
        "state_fips": "02",
        "district_number": "At-large",
        "cd119": "00",
        "district_name": "Congressional District (at Large)",
        "primary_city": "Anchorage",
        "correlated_cities": [{"name": "Anchorage", "ascii_name": "Anchorage"}],
    }
    source_meta = {"important_caveat": "practical correlation, not official"}

    doc = build_district_doc(raw, source_meta, now)

    assert doc["_id"] == "AK-01"           # normalized join key
    assert doc["district_id"] == "AK-01"
    assert doc["district_number"] == "At-large"  # original label preserved
    assert doc["primary_city"] == "Anchorage"
    assert doc["correlated_cities"][0]["ascii_name"] == "Anchorage"
    assert doc["is_approximate_geography"] is True  # governance flag
    assert doc["source"] is source_meta             # provenance carried through
    assert doc["imported_at"] == now
