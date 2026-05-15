from __future__ import annotations

import logging

import httpx

from app.services.geocodio.models import CongressionalDistrict, DistrictResult
from app.services.geocodio.race_key import build_race_key

logger = logging.getLogger(__name__)

# DECISIONS_LOG §3.5: request both cd120 (2026 election) and cd (current 119th)
# boundaries in one call to avoid a second round-trip.
_GEOCODIO_FIELDS = "cd120,cd"
_GEOCODIO_BASE_URL = "https://api.geocod.io/v1.12"
_REQUEST_TIMEOUT_S = 10.0


class GeocodioError(Exception):
    """Raised when the Geocod.io API returns an error."""


class GeocodioClient:
    """Sync Geocod.io client for congressional-district lookups."""

    def __init__(self, api_key: str, base_url: str = _GEOCODIO_BASE_URL) -> None:
        self._api_key = api_key
        self._base_url = base_url
        self._http = httpx.Client(timeout=_REQUEST_TIMEOUT_S)

    def geocode(self, address: str) -> list[DistrictResult]:
        """Geocode an address and return congressional district info.

        Args:
            address: Full address, ZIP code, or "lat,lng" pair.

        Returns:
            List of DistrictResult (empty if nothing matched).

        Raises:
            GeocodioError: On non-200 HTTP responses or malformed payloads.
        """
        try:
            response = self._http.get(
                f"{self._base_url}/geocode",
                params={"q": address, "fields": _GEOCODIO_FIELDS, "api_key": self._api_key},
            )
        except httpx.RequestError as exc:
            raise GeocodioError(f"Network error contacting Geocod.io: {exc}") from exc

        if response.status_code != 200:
            raise GeocodioError(
                f"Geocod.io returned {response.status_code}: {response.text[:200]}"
            )

        try:
            payload = response.json()
        except Exception as exc:
            raise GeocodioError("Geocod.io returned non-JSON body") from exc

        return [self._parse_result(r) for r in payload.get("results", [])]

    @staticmethod
    def _parse_result(raw: dict) -> DistrictResult:
        location = raw.get("location", {})
        address_components = raw.get("address_components", {})
        state_abbr = address_components.get("state", "")
        fields = raw.get("fields", {})
        accuracy_type = raw.get("accuracy_type", "")

        # DECISIONS_LOG §3.5: prefer cd120; fall back to cd.
        cd_list = fields.get("congressional_districts", [])
        field_source = "none"
        if cd_list:
            first = cd_list[0]
            congress_num = first.get("congress_number", "")
            # cd120 entries carry "120th"; cd entries carry "119th"
            field_source = "cd120" if "120" in congress_num else "cd"
        else:
            # Try cd if cd120 was empty
            cd_list = fields.get("cd", [])
            if cd_list:
                field_source = "cd"

        districts = tuple(
            CongressionalDistrict(
                district_number=d.get("district_number", 0),
                state_abbreviation=state_abbr,
                proportion=d.get("proportion", 1.0),
                congress_number=d.get("congress_number", ""),
                field_source=field_source,
                race_key=build_race_key(state_abbr, d.get("district_number", 0)),
            )
            for d in cd_list
        )

        # A ZIP input covering multiple districts is flagged so the agent can
        # prompt for a full street address (DECISIONS_LOG §1.5).
        is_zip_ambiguous = (
            accuracy_type in ("zip_centroid", "approximate", "place")
            and len(districts) > 1
        )

        return DistrictResult(
            formatted_address=raw.get("formatted_address", ""),
            lat=location.get("lat", 0.0),
            lng=location.get("lng", 0.0),
            accuracy=raw.get("accuracy", 0.0),
            accuracy_type=accuracy_type,
            districts=districts,
            is_zip_ambiguous=is_zip_ambiguous,
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> GeocodioClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
