"""Read helpers for the `districts` collection (district <-> cities geography).

This data is APPROXIMATE context — cities are practically correlated to a district
by point-in-polygon, not an official designation, and a city can span districts.
Callers must present it as such and never as a citable representation claim.

Functions take a pymongo collection so they are unit-testable with a fake.
"""

from __future__ import annotations

import re
from typing import Any

APPROX_NOTE = (
    "approximate geography — cities are practically correlated to the district, "
    "not an official designation, and a city may span multiple districts"
)

_MAX_COVERAGE_CITIES = 6


def get_district_cities(collection: Any, district_id: str) -> dict[str, Any] | None:
    """Return the city coverage for a district_id (e.g. "WI-04"), or None if absent."""
    doc = collection.find_one({"_id": district_id.strip().upper()})
    if not doc:
        return None
    cities = [c.get("name", "") for c in doc.get("correlated_cities", []) if c.get("name")]
    return {
        "district_id": doc.get("_id", ""),
        "primary_city": doc.get("primary_city", ""),
        "cities": cities,
        "is_approximate_geography": doc.get("is_approximate_geography", True),
    }


def build_city_query(city_name: str) -> dict[str, Any] | None:
    """Build the case-insensitive exact-match query on a correlated city's ascii name.

    Returns None for blank input so callers can short-circuit without a DB hit.
    """
    needle = city_name.strip()
    if not needle:
        return None
    return {
        "correlated_cities.ascii_name": {
            "$regex": f"^{re.escape(needle)}$",
            "$options": "i",
        }
    }


def find_districts_by_city(
    collection: Any, city_name: str, limit: int = 10
) -> list[dict[str, Any]]:
    """Find district(s) whose correlated cities include `city_name` (approximate)."""
    query = build_city_query(city_name)
    if query is None:
        return []
    projection = {"state": 1, "state_name": 1, "primary_city": 1}
    cursor = collection.find(query, projection).limit(limit)
    return [
        {
            "district_id": doc.get("_id", ""),
            "state": doc.get("state", ""),
            "state_name": doc.get("state_name", ""),
            "primary_city": doc.get("primary_city", ""),
        }
        for doc in cursor
    ]


def format_city_coverage_line(cities_info: dict[str, Any]) -> str:
    """One-line "Covers (approx.): A, B, C …" summary, or "" when no cities."""
    cities = cities_info.get("cities", [])
    if not cities:
        return ""
    shown = ", ".join(cities[:_MAX_COVERAGE_CITIES])
    overflow = len(cities) - _MAX_COVERAGE_CITIES
    more = f" (+{overflow} more)" if overflow > 0 else ""
    return f"Covers (approx.): {shown}{more}"
