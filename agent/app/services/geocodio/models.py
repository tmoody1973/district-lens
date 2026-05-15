from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class CongressionalDistrict:
    district_number: int
    state_abbreviation: str
    proportion: float
    congress_number: str  # e.g. "120th"
    field_source: str     # "cd120" | "cd"
    race_key: str         # e.g. "WI-04", "DC-00"


@dataclass(frozen=True)
class DistrictResult:
    formatted_address: str
    lat: float
    lng: float
    accuracy: float
    accuracy_type: str
    districts: tuple[CongressionalDistrict, ...]
    # True when the input was a ZIP and the ZIP spans multiple districts.
    # The agent should ask for a full address to disambiguate.
    is_zip_ambiguous: bool

    @property
    def primary_district(self) -> CongressionalDistrict | None:
        """Highest-proportion district, or None when no districts are present."""
        if not self.districts:
            return None
        return max(self.districts, key=lambda d: d.proportion)
