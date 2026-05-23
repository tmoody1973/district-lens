"""Unit tests for GeocodioClient._parse_result (no real HTTP calls)."""


from app.services.geocodio.client import GeocodioClient

# Minimal raw Geocod.io result matching the White House test from the A3 session
_WHITE_HOUSE_RAW = {
    "address_components": {"state": "DC"},
    "formatted_address": "1600 Pennsylvania Ave NW, Washington, DC 20500",
    "location": {"lat": 38.897675, "lng": -77.036547},
    "accuracy": 1.0,
    "accuracy_type": "rooftop",
    "fields": {
        "congressional_districts": [
            {
                "district_number": 98,
                "congress_number": "120th",
                "proportion": 1.0,
            }
        ]
    },
}

_WISCONSIN_4_RAW = {
    "address_components": {"state": "WI"},
    "formatted_address": "1 Main St, Milwaukee, WI 53202",
    "location": {"lat": 43.0389, "lng": -87.9065},
    "accuracy": 0.9,
    "accuracy_type": "rooftop",
    "fields": {
        "congressional_districts": [
            {
                "district_number": 4,
                "congress_number": "120th",
                "proportion": 1.0,
            }
        ]
    },
}

_ZIP_AMBIGUOUS_RAW = {
    "address_components": {"state": "WI"},
    "formatted_address": "53202",
    "location": {"lat": 43.05, "lng": -87.95},
    "accuracy": 0.5,
    "accuracy_type": "zip_centroid",
    "fields": {
        "congressional_districts": [
            {"district_number": 4, "congress_number": "120th", "proportion": 0.7},
            {"district_number": 5, "congress_number": "120th", "proportion": 0.3},
        ]
    },
}

_CD_FALLBACK_RAW = {
    "address_components": {"state": "WI"},
    "formatted_address": "1 Main St, Milwaukee, WI 53202",
    "location": {"lat": 43.0389, "lng": -87.9065},
    "accuracy": 0.9,
    "accuracy_type": "rooftop",
    "fields": {
        # cd120 field is empty; cd is populated → should use cd
        "congressional_districts": [
            {"district_number": 4, "congress_number": "119th", "proportion": 1.0},
        ]
    },
}


def test_parse_white_house() -> None:
    result = GeocodioClient._parse_result(_WHITE_HOUSE_RAW)
    assert result.formatted_address == "1600 Pennsylvania Ave NW, Washington, DC 20500"
    assert result.accuracy_type == "rooftop"
    assert len(result.districts) == 1
    d = result.districts[0]
    assert d.race_key == "DC-00"
    assert d.field_source == "cd120"
    assert not result.is_zip_ambiguous


def test_parse_wisconsin_district() -> None:
    result = GeocodioClient._parse_result(_WISCONSIN_4_RAW)
    primary = result.primary_district
    assert primary is not None
    assert primary.race_key == "WI-04"
    assert primary.field_source == "cd120"


def test_parse_zip_ambiguous() -> None:
    result = GeocodioClient._parse_result(_ZIP_AMBIGUOUS_RAW)
    assert result.is_zip_ambiguous
    keys = {d.race_key for d in result.districts}
    assert keys == {"WI-04", "WI-05"}
    primary = result.primary_district
    assert primary is not None
    assert primary.race_key == "WI-04"  # highest proportion


def test_parse_cd_fallback() -> None:
    result = GeocodioClient._parse_result(_CD_FALLBACK_RAW)
    primary = result.primary_district
    assert primary is not None
    assert primary.field_source == "cd"   # fell back to current cd


def test_parse_no_districts() -> None:
    raw = {
        "address_components": {"state": "WI"},
        "formatted_address": "Middle of Ocean",
        "location": {"lat": 0.0, "lng": 0.0},
        "accuracy": 0.0,
        "accuracy_type": "unknown",
        "fields": {},
    }
    result = GeocodioClient._parse_result(raw)
    assert len(result.districts) == 0
    assert result.primary_district is None
