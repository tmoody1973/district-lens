"""Congress.gov / unitedstates/congress-legislators Phase 3 import.

Two-tier approach per DECISIONS_LOG §3.2:

TIER 1 (no API key, free, instant):
  legislators-current.yaml  — 536 member profiles with FEC ID crosswalk
  legislators-social-media.yaml — Twitter, YouTube, Facebook
  Writes: legislator_profiles, updates candidates.bioguide_id

TIER 2 (requires CONGRESS_API_KEY, free registration at api.congress.gov):
  Congress.gov API  — sponsored bills, cosponsorships for each member
  Writes: legislative_actions (sponsorship records)
  Rate limit: 5,000 req/hr. For 535 members × ~5 calls = ~2,675 calls = ~32 min.

Run:
  cd agent && uv run python scripts/ingest_legislators.py

Set CONGRESS_API_KEY in agent/app/.env to enable Tier 2.
"""

from __future__ import annotations

import hashlib
import logging
import os
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pymongo
import yaml
from dotenv import load_dotenv
from pymongo import UpdateOne

load_dotenv(Path(__file__).parent.parent / "app" / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

LEGISLATORS_BASE = "https://raw.githubusercontent.com/unitedstates/congress-legislators/main"
CONGRESS_API_BASE = "https://api.congress.gov/v3"
CYCLE = "2026"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _download_yaml(url: str, cache: str) -> list[dict]:
    p = Path(cache)
    if p.exists() and (datetime.now().timestamp() - p.stat().st_mtime) < 86400:
        logger.info("Using cached %s", cache)
    else:
        logger.info("Downloading %s", url)
        resp = httpx.get(url, follow_redirects=True, timeout=30)
        resp.raise_for_status()
        p.write_bytes(resp.content)
    return yaml.safe_load(p.read_text())


def _race_key_for_member(term: dict) -> str | None:
    """Build a 2026-cycle race key for a current member, if applicable."""
    t_type = term.get("type")
    state = (term.get("state") or "").upper()
    if not state:
        return None
    if t_type == "rep":
        district = term.get("district") or 0
        return f"{CYCLE}-H-{state}-{int(district):02d}"
    if t_type == "sen":
        # Only senators whose current term ends 2027-01-03 are up in the 2026 cycle
        if term.get("end", "") == "2027-01-03":
            return f"{CYCLE}-S-{state}-00"
    return None


def _party_abbr(party: str) -> str:
    return {"Democrat": "DEM", "Republican": "REP", "Independent": "IND"}.get(party, party[:3].upper())


# ---------------------------------------------------------------------------
# Tier 1: legislators profiles + FEC crosswalk
# ---------------------------------------------------------------------------

def ingest_profiles(db: pymongo.database.Database, batch_id: str) -> dict[str, int]:
    now = datetime.now(UTC)
    stale_after = now + timedelta(days=30)

    profiles_data = _download_yaml(f"{LEGISLATORS_BASE}/legislators-current.yaml", "/tmp/legislators-current.yaml")
    social_data = _download_yaml(f"{LEGISLATORS_BASE}/legislators-social-media.yaml", "/tmp/legislators-social.yaml")

    social_by_bioguide = {s["id"]["bioguide"]: s.get("social", {}) for s in social_data}

    profiles_col = db["legislator_profiles"]
    candidates_col = db["candidates"]

    profile_ops: list[UpdateOne] = []
    candidate_updates: list[UpdateOne] = []

    for m in profiles_data:
        ids = m.get("id", {})
        bioguide = ids.get("bioguide", "")
        if not bioguide:
            continue

        name = m.get("name", {})
        terms = m.get("terms", [])
        if not terms:
            continue
        current_term = terms[-1]

        race_key = _race_key_for_member(current_term)
        social = social_by_bioguide.get(bioguide, {})
        fec_ids: list[str] = ids.get("fec") or []
        if isinstance(fec_ids, str):
            fec_ids = [fec_ids]

        doc = {
            "bioguide_id": bioguide,
            "fec_ids": fec_ids,
            "name": name.get("official_full", f"{name.get('first','')} {name.get('last','')}").strip(),
            "first_name": name.get("first", ""),
            "last_name": name.get("last", ""),
            "party": _party_abbr(current_term.get("party", "")),
            "state": current_term.get("state", "").upper(),
            "district": current_term.get("district"),
            "chamber": "house" if current_term.get("type") == "rep" else "senate",
            "term_start": current_term.get("start"),
            "term_end": current_term.get("end"),
            "race_key_2026": race_key,
            "govtrack_id": ids.get("govtrack"),
            "opensecrets_id": ids.get("opensecrets"),
            "votesmart_id": ids.get("votesmart"),
            "wikipedia": ids.get("wikipedia"),
            "twitter": social.get("twitter"),
            "youtube": social.get("youtube"),
            "source_system": "congress_legislators",
            "source_url": f"{LEGISLATORS_BASE}/legislators-current.yaml",
            "import_batch_id": batch_id,
            "ingested_at": now,
            "last_checked_at": now,
            "stale_after": stale_after,
            "freshness_status": "fresh",
        }
        profile_ops.append(
            UpdateOne({"bioguide_id": bioguide}, {"$set": doc, "$setOnInsert": {"created_at": now}}, upsert=True)
        )

        # Cross-reference: update candidates that match any FEC ID for this member
        if fec_ids and race_key:
            candidate_updates.append(
                UpdateOne(
                    {"candidate_id": {"$in": fec_ids}},
                    {"$set": {
                        "bioguide_id": bioguide,
                        "govtrack_id": ids.get("govtrack"),
                        "twitter": social.get("twitter"),
                        "wikipedia": ids.get("wikipedia"),
                        "incumbent_confirmed": True,
                    }},
                )
            )

    profiles_col.create_index([("bioguide_id", 1)], unique=True)
    profiles_col.create_index([("race_key_2026", 1)])
    profiles_col.create_index([("fec_ids", 1)])

    profiles_result = profiles_col.bulk_write(profile_ops, ordered=False) if profile_ops else None
    cand_result = candidates_col.bulk_write(candidate_updates, ordered=False) if candidate_updates else None

    counts = {
        "profiles_upserted": len(profile_ops),
        "candidates_enriched": cand_result.modified_count if cand_result else 0,
        "profiles_with_2026_race": sum(1 for op in profile_ops if op._filter.get("bioguide_id") and any(
            (doc["_BaseObject__spec"]["$set"].get("race_key_2026") if hasattr(op, "_BaseObject__spec") else None)
            for _ in [1]
        )),
    }
    logger.info("Tier 1 complete: %d profiles, %d candidates enriched", len(profile_ops), counts["candidates_enriched"])
    return counts


# ---------------------------------------------------------------------------
# Tier 2: Congress.gov sponsored legislation
# ---------------------------------------------------------------------------

def ingest_sponsored_legislation(db: pymongo.database.Database, batch_id: str, api_key: str) -> dict[str, int]:
    now = datetime.now(UTC)
    stale_after = now + timedelta(days=7)
    actions_col = db["legislative_actions"]
    actions_col.create_index([("bioguide_id", 1), ("congress", 1)])
    actions_col.create_index([("race_key_2026", 1)])

    # Only fetch for 2026-relevant incumbents (House + Senate seats up in 2026)
    profiles = list(
        db["legislator_profiles"].find(
            {"race_key_2026": {"$exists": True, "$ne": None}},
            {"_id": 0, "bioguide_id": 1, "name": 1, "race_key_2026": 1},
        )
    )
    logger.info("Fetching sponsored legislation for %d 2026-relevant incumbents", len(profiles))

    # Skip members already fetched in this or a prior run
    already_done = set(
        doc["bioguide_id"]
        for doc in actions_col.find({}, {"_id": 0, "bioguide_id": 1})
    )
    pending = [p for p in profiles if p["bioguide_id"] not in already_done]
    logger.info("  %d already imported, %d remaining", len(already_done), len(pending))

    total_bills = 0
    FLUSH_EVERY = 25  # write to MongoDB every N members to preserve progress

    with httpx.Client(timeout=30, follow_redirects=True) as client:
        batch_ops: list[UpdateOne] = []

        for i, profile in enumerate(pending):
            bioguide = profile["bioguide_id"]
            race_key = profile["race_key_2026"]

            try:
                resp = client.get(
                    f"{CONGRESS_API_BASE}/member/{bioguide}/sponsored-legislation",
                    params={"limit": 20, "congress": 119, "api_key": api_key},
                )
                if resp.status_code == 200:
                    bills = resp.json().get("sponsoredLegislation", []) or []
                    for bill in bills:
                        if not isinstance(bill, dict):
                            continue
                        bill_id = f"{bill.get('congress','')}-{bill.get('type','')}{bill.get('number','')}"
                        doc = {
                            "bioguide_id": bioguide,
                            "member_name": profile["name"],
                            "race_key_2026": race_key,
                            "action_type": "sponsored_bill",
                            "congress": bill.get("congress"),
                            "bill_type": bill.get("type"),
                            "bill_number": bill.get("number"),
                            "bill_id": bill_id,
                            "title": (bill.get("title") or "")[:500],
                            "introduced_date": bill.get("introducedDate"),
                            "latest_action": ((bill.get("latestAction") or {}).get("text") or "")[:300],
                            "latest_action_date": (bill.get("latestAction") or {}).get("actionDate"),
                            "url": bill.get("url"),
                            "source_system": "congress_gov_api",
                            "import_batch_id": batch_id,
                            "ingested_at": now,
                            "stale_after": stale_after,
                        }
                        batch_ops.append(
                            UpdateOne(
                                {"bioguide_id": bioguide, "bill_id": bill_id},
                                {"$set": doc, "$setOnInsert": {"created_at": now}},
                                upsert=True,
                            )
                        )
                        total_bills += 1
                elif resp.status_code == 429:
                    logger.warning("Rate limited at member %d/%d — sleeping 60s", i + 1, len(pending))
                    time.sleep(60)
            except httpx.RequestError as exc:
                logger.warning("Request error for %s: %s", bioguide, exc)
            except Exception as exc:
                logger.warning("Unexpected error for %s: %s", bioguide, exc)

            time.sleep(0.75)

            # Flush every FLUSH_EVERY members to preserve progress on crash
            if batch_ops and (i + 1) % FLUSH_EVERY == 0:
                actions_col.bulk_write(batch_ops, ordered=False)
                logger.info("  %d/%d done, flushed %d records (total: %d)", i + 1, len(pending), len(batch_ops), total_bills)
                batch_ops = []

        # Final flush
        if batch_ops:
            actions_col.bulk_write(batch_ops, ordered=False)
            logger.info("Final flush: %d records", len(batch_ops))

    logger.info("Tier 2 complete: %d members, %d bill records", len(pending), total_bills)
    return {"members_processed": len(pending), "bill_records": total_bills}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def run_import(mongo_uri: str, congress_api_key: str = "") -> dict[str, int]:
    now = datetime.now(UTC)
    batch_id = now.strftime("congress-legislators-%Y%m%d-%H%M%S")
    client: pymongo.MongoClient = pymongo.MongoClient(mongo_uri)
    db = client["districtlens"]

    logger.info("=== Phase 3: Congress.gov / legislators import — batch %s ===", batch_id)

    counts: dict[str, int] = {}

    # Tier 1 always runs
    counts.update(ingest_profiles(db, batch_id))

    # Tier 2 only if API key is provided
    if congress_api_key:
        logger.info("CONGRESS_API_KEY found — running Tier 2 (sponsored legislation)")
        counts.update(ingest_sponsored_legislation(db, batch_id, congress_api_key))
    else:
        logger.info(
            "No CONGRESS_API_KEY — skipping Tier 2 (sponsored legislation). "
            "Register free at https://api.congress.gov/sign-up/ and set CONGRESS_API_KEY in agent/app/.env."
        )

    # Write import batch record
    db["official_import_batches"].insert_one({
        "batch_id": batch_id,
        "source_system": "congress_legislators",
        "tiers": ["tier1_profiles"] + (["tier2_legislation"] if congress_api_key else []),
        "counts": counts,
        "started_at": now,
        "completed_at": datetime.now(UTC),
        "status": "completed",
    })

    client.close()
    return counts


if __name__ == "__main__":
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        logger.error("MONGODB_URI not set")
        sys.exit(1)
    api_key = os.environ.get("CONGRESS_API_KEY", "")
    results = run_import(uri, congress_api_key=api_key)
    print("\nPhase 3 import complete:")
    for k, v in results.items():
        print(f"  {k}: {v:,}")
