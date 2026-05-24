"""Idempotent seed of the primary_calendar collection from the FVAP 2026 table."""

from __future__ import annotations

import datetime
import logging
import os
import sys

import pymongo
from pymongo import UpdateOne

from app.refresh.calendar import FVAP_2026_ROWS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def seed(mongo_uri: str) -> int:
    now = datetime.datetime.now(datetime.UTC)
    client: pymongo.MongoClient = pymongo.MongoClient(mongo_uri)
    col = client["districtlens"]["primary_calendar"]
    col.create_index([("state", 1), ("cycle", 1)], unique=True)
    ops = []
    for row in FVAP_2026_ROWS:
        # store datetimes (pymongo needs datetime, not date)
        doc = dict(row)
        doc["primary_date"] = datetime.datetime.combine(row["primary_date"], datetime.time(), datetime.UTC)
        doc["runoff_date"] = (
            datetime.datetime.combine(row["runoff_date"], datetime.time(), datetime.UTC)
            if row["runoff_date"] else None
        )
        doc["last_verified_at"] = now
        ops.append(
            UpdateOne(
                {"state": row["state"], "cycle": row["cycle"]},
                {"$set": doc, "$setOnInsert": {"ingested_at": now}},
                upsert=True,
            )
        )
    result = col.bulk_write(ops, ordered=False)
    logger.info("primary_calendar seeded: %d upserted, %d modified", result.upserted_count, result.modified_count)
    client.close()
    return len(ops)


if __name__ == "__main__":
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        logger.error("MONGODB_URI not set")
        sys.exit(1)
    print(f"Seeded {seed(uri)} primary_calendar rows")
