from __future__ import annotations

# Geocod.io codes DC's at-large delegate seat as district 98.
# All other at-large territories use the same convention.
# DECISIONS_LOG §3.5 + FEC/Congress.gov both use "00" for at-large seats.
_GEOCODIO_AT_LARGE_CODE = 98
_AT_LARGE_DISTRICT = 0


def build_race_key(state_abbreviation: str, district_number: int) -> str:
    """Return the canonical race key for a congressional district.

    Args:
        state_abbreviation: Two-letter postal code, e.g. "WI".
        district_number: Geocod.io district number. 98 means at-large.

    Returns:
        Race key in "{STATE}-{NN:02d}" format, e.g. "WI-04", "DC-00".

    Examples:
        >>> build_race_key("WI", 4)
        'WI-04'
        >>> build_race_key("DC", 98)
        'DC-00'
        >>> build_race_key("AK", 1)
        'AK-01'
    """
    district = _AT_LARGE_DISTRICT if district_number == _GEOCODIO_AT_LARGE_CODE else district_number
    return f"{state_abbreviation.upper()}-{district:02d}"
