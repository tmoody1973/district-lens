"""Import U.S. House district → correlated-cities geography into MongoDB.

Source file: a JSON export (Census 119th CD polygons × GeoNames populated places,
point-in-polygon). Loads into the `districts` collection keyed by the repo's
district_id convention so it joins to candidates/races.

GOVERNANCE: this is APPROXIMATE geography context, never a citable claim about who
represents a city (the source itself flags this — see metadata.important_caveat).
Every doc carries `is_approximate_geography: true` plus full source provenance, per
the data-integrity rule (cache with timestamps + source).

Idempotent: upserts by `_id`. Usage:
    MONGODB_URI=... python scripts/import_district_cities.py --file path/to.json
    add --dry-run to build + report without writing.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pymongo
from pymongo import ASCENDING, UpdateOne

logger = logging.getLogger("import_district_cities")

_COLLECTION = "districts"

# Single-district ("at-large") states are labelled "-AL" in the source but use the
# "-01" district_id convention everywhere in this repo (e.g. AK-01, VT-01, WY-01).
_AT_LARGE_SUFFIX = "AL"
_AT_LARGE_NUMBER = "01"


def normalize_district_id(raw_id: str) -> str:
    """Map a source district_id to the repo's STATE-NN convention.

    "AK-AL" -> "AK-01" (at-large), "AL-1"/"AL-01" -> "AL-01", state upper-cased.
    """
    state, _, suffix = raw_id.strip().upper().partition("-")
    if suffix == _AT_LARGE_SUFFIX:
        number = _AT_LARGE_NUMBER
    elif suffix.isdigit():
        number = suffix.zfill(2)
    else:
        number = suffix
    return f"{state}-{number}"


def build_district_doc(
    raw: dict[str, Any], source_meta: dict[str, Any], imported_at: datetime
) -> dict[str, Any]:
    """Build one `districts` document from a source district record."""
    district_id = normalize_district_id(raw["district_id"])
    return {
        "_id": district_id,
        "district_id": district_id,
        "state": raw.get("state", ""),
        "state_name": raw.get("state_name", ""),
        "state_fips": raw.get("state_fips", ""),
        "district_number": raw.get("district_number", ""),
        "cd119": raw.get("cd119", ""),
        "district_name": raw.get("district_name", ""),
        "primary_city": raw.get("primary_city", ""),
        "correlated_cities": raw.get("correlated_cities", []),
        "is_approximate_geography": True,
        "source": source_meta,
        "imported_at": imported_at,
    }


def _load_payload(file_path: Path) -> dict[str, Any]:
    """Read and validate the source file at the system boundary."""
    with file_path.open(encoding="utf-8") as fh:
        payload = json.load(fh)
    if not isinstance(payload, dict) or "districts" not in payload:
        raise ValueError(f"{file_path} is not a districts export (missing 'districts').")
    return payload


def _ensure_indexes(collection: pymongo.collection.Collection) -> None:  # type: ignore[type-arg]
    collection.create_index([("correlated_cities.ascii_name", ASCENDING)], name="city_ascii_name")
    collection.create_index([("state", ASCENDING)], name="state")


def run_import(uri: str, file_path: Path, dry_run: bool = False) -> dict[str, Any]:
    """Upsert every district from the file into the `districts` collection."""
    payload = _load_payload(file_path)
    source_meta = payload.get("metadata", {})
    imported_at = datetime.now(UTC)

    ops = [
        UpdateOne(
            {"_id": doc["_id"]},
            {"$set": doc, "$setOnInsert": {"created_at": imported_at}},
            upsert=True,
        )
        for doc in (build_district_doc(d, source_meta, imported_at) for d in payload["districts"])
    ]

    if dry_run:
        logger.info("[dry-run] %d district docs built; no write.", len(ops))
        return {"built": len(ops), "written": 0, "dry_run": True}

    client: pymongo.MongoClient = pymongo.MongoClient(uri)
    try:
        collection = client["districtlens"][_COLLECTION]
        result = collection.bulk_write(ops, ordered=False)
        _ensure_indexes(collection)
    finally:
        client.close()
    return {
        "built": len(ops),
        "upserted": result.upserted_count,
        "modified": result.modified_count,
        "dry_run": False,
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Import district→cities geography into MongoDB.")
    parser.add_argument("--file", required=True, type=Path, help="Path to the districts JSON export.")
    parser.add_argument("--dry-run", action="store_true", help="Build + report without writing.")
    args = parser.parse_args()

    uri = os.environ.get("MONGODB_URI", "")
    if not uri and not args.dry_run:
        logger.error("MONGODB_URI not set")
        sys.exit(1)

    counts = run_import(uri, args.file, dry_run=args.dry_run)
    print("District cities import:")
    for key, value in counts.items():
        print(f"  {key}: {value}")


if __name__ == "__main__":
    main()
