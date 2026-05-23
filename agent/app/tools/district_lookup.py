"""ADK tool: resolve an address to a congressional district.

Replaces the lookup_district_placeholder stub. Wires GeocodioClient with:
  - MongoDB cache (DECISIONS_LOG §4.3 TTLs: 30d fresh, 7d cd120-empty)
  - Privacy hashing: HMAC-SHA256 of the raw address with ADDRESS_HASH_SALT
  - cd120→cd fallback (DECISIONS_LOG §3.5)
  - ZIP-ambiguity response for multi-district ZIPs (DECISIONS_LOG §1.5)
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import os
from datetime import UTC, datetime, timedelta

import pymongo
import pymongo.errors

from google.adk.tools import ToolContext

from app.services.geocodio import GeocodioClient, GeocodioError
from app.services.geocodio.models import DistrictResult

logger = logging.getLogger(__name__)

# Cache TTLs per DECISIONS_LOG §4.3
_FRESH_TTL = timedelta(days=30)
_CD120_EMPTY_TTL = timedelta(days=7)

_mongo_client: pymongo.MongoClient | None = None  # type: ignore[type-arg]
_geocodio_client: GeocodioClient | None = None


def _get_mongo_collection() -> pymongo.collection.Collection | None:  # type: ignore[type-arg]
    global _mongo_client
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        logger.warning("MONGODB_URI not set; district lookup cache disabled")
        return None
    if _mongo_client is None:
        _mongo_client = pymongo.MongoClient(uri)
    return _mongo_client["districtlens"]["district_lookups"]


def _get_geocodio_client() -> GeocodioClient:
    global _geocodio_client
    if _geocodio_client is None:
        api_key = os.environ.get("GEOCODIO_API_KEY", "")
        if not api_key:
            raise RuntimeError("GEOCODIO_API_KEY is not set")
        _geocodio_client = GeocodioClient(api_key=api_key)
    return _geocodio_client


def _hash_address(raw_address: str) -> str:
    """HMAC-SHA256 of the address with ADDRESS_HASH_SALT (DECISIONS_LOG §4.3 R1-R2)."""
    salt = os.environ.get("ADDRESS_HASH_SALT", "")
    return hmac.new(salt.encode(), raw_address.encode(), hashlib.sha256).hexdigest()


def _format_response(result: DistrictResult) -> str:
    """Format a DistrictResult into the string the agent puts in context."""
    primary = result.primary_district

    if result.is_zip_ambiguous:
        lines = [f"ZIP code spans multiple districts for {result.formatted_address}:"]
        for d in sorted(result.districts, key=lambda x: -x.proportion):
            lines.append(f"  {d.race_key} — {d.proportion * 100:.0f}% coverage")
        lines.append(
            "Please ask the user for a full street address to get a definitive district."
        )
        return "\n".join(lines)

    if primary is None:
        return (
            f"No congressional district found for {result.formatted_address}. "
            "The address may be outside a congressional district (e.g. a US territory "
            "without voting representation)."
        )

    boundary_note = (
        "2026 election boundaries (cd120)"
        if primary.field_source == "cd120"
        else "current 119th Congress boundaries (cd); 2026 boundaries not yet published for this state"
    )
    return (
        f"District resolved: {primary.race_key}\n"
        f"Address: {result.formatted_address}\n"
        f"Coverage: {primary.proportion * 100:.0f}%\n"
        f"Geocode: {result.accuracy_type} accuracy "
        f"(lat {result.lat:.4f}, lng {result.lng:.4f})\n"
        f"Boundary source: {boundary_note}"
    )


def _extract_race_key_from_text(text: str) -> str | None:
    """Extract a race key like '2026-H-WI-04' from a formatted response string."""
    import re
    match = re.search(r"(2026-[HS]-[A-Z]{2}-\d{2})", text)
    return match.group(1) if match else None


def _extract_state_from_race_key(race_key: str) -> str | None:
    """Extract two-letter state code from '2026-H-WI-04' → 'WI'."""
    parts = race_key.split("-")
    return parts[2] if len(parts) >= 3 else None


def _push_district_state(tool_context: ToolContext, response_text: str) -> None:
    """Push district stage to canvas from a cached response string."""
    race_key = _extract_race_key_from_text(response_text)
    if race_key:
        state_code = _extract_state_from_race_key(race_key)
        tool_context.state["stage"] = "district"
        tool_context.state["currentRaceKey"] = race_key
        if state_code:
            tool_context.state["mapFocus"] = state_code


def _push_district_state_from_result(tool_context: ToolContext, result: DistrictResult) -> None:
    """Push district stage to canvas from a live DistrictResult."""
    primary = result.primary_district
    if primary and not result.is_zip_ambiguous:
        state_code = _extract_state_from_race_key(primary.race_key)
        tool_context.state["stage"] = "district"
        tool_context.state["currentRaceKey"] = primary.race_key
        if state_code:
            tool_context.state["mapFocus"] = state_code


def _resolve_race_sync(address_or_zip: str) -> dict[str, str | None]:
    """Resolve an address to a race key + state code. Returns {raceKey, stateCode}.

    Used by the deterministic brief pipeline. Reuses the same geocode + cache
    path as lookup_district but returns structured data instead of prose. On any
    failure or ambiguous result, raceKey/stateCode are None so the pipeline can
    continue and report the gap rather than aborting.
    """
    lookup_hash = _hash_address(address_or_zip)

    collection = _get_mongo_collection()
    if collection is not None:
        try:
            cached = collection.find_one(
                {"lookup_hash": lookup_hash, "expires_at": {"$gt": datetime.now(UTC)}}
            )
            if cached:
                race_key = _extract_race_key_from_text(cached.get("response_text", ""))
                return {
                    "raceKey": race_key,
                    "stateCode": _extract_state_from_race_key(race_key) if race_key else None,
                }
        except pymongo.errors.PyMongoError as exc:
            logger.warning("resolve_race.cache_read_error: %s", exc)

    client = _get_geocodio_client()
    results = client.geocode(address_or_zip)
    if not results:
        return {"raceKey": None, "stateCode": None}

    result = results[0]
    primary = result.primary_district
    if primary is None or result.is_zip_ambiguous:
        return {"raceKey": None, "stateCode": None}

    return {
        "raceKey": primary.race_key,
        "stateCode": _extract_state_from_race_key(primary.race_key),
    }


async def resolve_race_from_address(address_or_zip: str) -> dict[str, str | None]:
    """Async data core: resolve an address to {raceKey, stateCode} for the pipeline."""
    return await asyncio.to_thread(_resolve_race_sync, address_or_zip)


def lookup_district(address_or_zip: str, tool_context: ToolContext) -> str:
    """Resolve a street address or ZIP code to a congressional district.

    Returns the district race key (e.g. "WI-04"), geocode details, and
    boundary source. For ZIP codes spanning multiple districts, returns all
    candidates and asks for a full street address.

    Args:
        address_or_zip: A full street address, ZIP code, or "lat,lng" pair.
    """
    tool_context.state["status_message"] = f"Looking up district for {address_or_zip}…"
    lookup_hash = _hash_address(address_or_zip)

    # Check cache first (DECISIONS_LOG §4.3 R6)
    collection = _get_mongo_collection()
    if collection is not None:
        try:
            cached = collection.find_one(
                {"lookup_hash": lookup_hash, "expires_at": {"$gt": datetime.now(UTC)}}
            )
            if cached:
                logger.info("district_lookup.cache_hit", extra={"hash": lookup_hash[:8]})
                _push_district_state(tool_context, cached.get("response_text", ""))
                return cached["response_text"]
        except pymongo.errors.PyMongoError as exc:
            logger.warning("district_lookup.cache_read_error: %s", exc)

    # Call Geocod.io
    try:
        client = _get_geocodio_client()
        results = client.geocode(address_or_zip)
    except GeocodioError as exc:
        logger.error("district_lookup.geocodio_error: %s", exc)
        return (
            "I was unable to look up the district for that address. "
            "The geocoding service returned an error. Please try again or rephrase the address."
        )
    except RuntimeError as exc:
        logger.error("district_lookup.config_error: %s", exc)
        return "District lookup is not configured (missing API key)."

    if not results:
        return (
            f"No results found for '{address_or_zip}'. "
            "Please try a full street address including city and state."
        )

    result = results[0]
    response_text = _format_response(result)
    _push_district_state_from_result(tool_context, result)

    # Write to cache (DECISIONS_LOG §4.3 R3, R6)
    if collection is not None:
        primary = result.primary_district
        ttl = _FRESH_TTL if (primary and primary.field_source == "cd120") else _CD120_EMPTY_TTL
        lat_truncated = round(result.lat, 2)   # ~1 km precision (R3)
        lng_truncated = round(result.lng, 2)
        try:
            collection.update_one(
                {"lookup_hash": lookup_hash},
                {
                    "$set": {
                        "lookup_hash": lookup_hash,
                        "response_text": response_text,
                        "lat": lat_truncated,
                        "lng": lng_truncated,
                        "accuracy_type": result.accuracy_type,
                        "field_source": primary.field_source if primary else "none",
                        "expires_at": datetime.now(UTC) + ttl,
                        "updated_at": datetime.now(UTC),
                    }
                },
                upsert=True,
            )
        except pymongo.errors.PyMongoError as exc:
            logger.warning("district_lookup.cache_write_error: %s", exc)

    return response_text
