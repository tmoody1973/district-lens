import pytest

from app.services.geocodio.race_key import build_race_key


@pytest.mark.parametrize(
    "state, district_number, expected",
    [
        ("WI", 4, "WI-04"),
        ("WI", 1, "WI-01"),
        ("CA", 12, "CA-12"),
        ("CA", 53, "CA-53"),
        # DC at-large: Geocod.io uses 98 → should map to 00
        ("DC", 98, "DC-00"),
        # At-large single-rep states use district 1 (not 98)
        ("AK", 1, "AK-01"),
        ("WY", 1, "WY-01"),
        ("VT", 1, "VT-01"),
        # Lowercase state is normalised
        ("wi", 4, "WI-04"),
    ],
)
def test_build_race_key(state: str, district_number: int, expected: str) -> None:
    assert build_race_key(state, district_number) == expected


def test_zero_district_number() -> None:
    # district_number=0 is technically invalid but should not crash
    assert build_race_key("WI", 0) == "WI-00"
