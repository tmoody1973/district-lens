"""ADK tool: find which congressional district(s) a city falls in.

Reverse lookup over the `districts` geography collection (multikey index on
correlated_cities.ascii_name). APPROXIMATE: a city can span districts, so this is
a discovery aid, not a definitive answer — for that, use `lookup_district` with a
full street address. Returns the standard {status, data, warnings, source} envelope.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import pymongo

from app.services.districts.cities import APPROX_NOTE, find_districts_by_city

logger = logging.getLogger(__name__)

_SOURCE = "DistrictLens district geography (Census 119th CD x GeoNames, approximate)"

_mongo_client: pymongo.MongoClient | None = None  # type: ignore[type-arg]


def _get_districts_collection() -> pymongo.collection.Collection | None:  # type: ignore[type-arg]
    global _mongo_client
    uri = os.environ.get("MONGODB_URI", "")
    if not uri:
        return None
    if _mongo_client is None:
        _mongo_client = pymongo.MongoClient(uri)
    return _mongo_client["districtlens"]["districts"]


def find_district_by_city(city_name: str) -> dict[str, Any]:
    """Find the congressional district(s) a city falls in (approximate geography).

    Use this to help a user locate their race by city when they have not given a
    full address. Because a city can span multiple districts, treat the result as
    a lead — confirm with `lookup_district` using a full street address.

    Args:
        city_name: A U.S. city name (e.g. "Milwaukee").
    """
    if not city_name or not city_name.strip():
        return {
            "status": "error",
            "data": None,
            "warnings": ["Provide a city name."],
            "source": _SOURCE,
        }

    collection = _get_districts_collection()
    if collection is None:
        return {
            "status": "error",
            "data": None,
            "warnings": ["District geography is unavailable (MONGODB_URI not set)."],
            "source": _SOURCE,
        }

    try:
        matches = find_districts_by_city(collection, city_name)
    except pymongo.errors.PyMongoError as exc:
        logger.warning("find_district_by_city.query_error: %s", exc)
        return {
            "status": "error",
            "data": None,
            "warnings": [f"District geography query failed for '{city_name}'."],
            "source": _SOURCE,
        }

    if not matches:
        return {
            "status": "not_found",
            "data": None,
            "warnings": [
                f"No district geography found for '{city_name}'. "
                "Try a full street address with lookup_district."
            ],
            "source": _SOURCE,
        }

    warnings = [APPROX_NOTE]
    if len(matches) > 1:
        warnings.append(
            f"'{city_name}' spans {len(matches)} districts — confirm with a full street address."
        )
    return {
        "status": "ok",
        "data": {"city": city_name.strip(), "districts": matches},
        "warnings": warnings,
        "source": _SOURCE,
    }
