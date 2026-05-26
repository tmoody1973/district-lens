"""Congress.gov House roll-call vote ingest (119th Congress, 2nd session = 2026).

Per-member House votes are available from the Congress.gov API as of Dec 2025.
For each roll call we fetch the full member list (to compute each party's
majority and whether the vote was party-split), store raw rows for the
2026-relevant House incumbents in `member_votes`, then write a computed
`voting_record_summaries` doc per incumbent.

API key-name mapping (confirmed against house_vote_members_sample.json):
  bioguideID  → bioguide_id
  voteCast    → position  (values: "Yea", "Nay", "Present", "Not Voting")
  voteParty   → party     (values: "R", "D", "I" — single-letter codes)

Run:
  cd agent && CONGRESS_API_KEY=... uv run python scripts/ingest_house_votes.py
"""

from __future__ import annotations

import logging
import os
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pymongo
from dotenv import load_dotenv
from pymongo import UpdateOne

from app.tools.voting_metrics import MemberVoteContext, compute_metrics, party_majority

load_dotenv(Path(__file__).parent.parent / "app" / ".env")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

CONGRESS_API_BASE = "https://api.congress.gov/v3"
CONGRESS = 119
SESSION = 2
CYCLE = "2026"

# Congress.gov returns single-letter party codes in the vote-members endpoint.
# Map them to the three-letter abbreviations used throughout DistrictLens.
_PARTY_CODE: dict[str, str] = {
    "D": "DEM",
    "R": "REP",
    "I": "IND",
}

# Congress.gov full-name party values appear in other endpoints; keep them here
# for defensive fallback.
_PARTY_NAME: dict[str, str] = {
    "Democratic": "DEM",
    "Republican": "REP",
    "Independent": "IND",
}


def _party_abbr(raw: str) -> str:
    """Normalise any Congress.gov party representation to DEM / REP / IND."""
    cleaned = (raw or "").strip()
    if cleaned in _PARTY_CODE:
        return _PARTY_CODE[cleaned]
    if cleaned in _PARTY_NAME:
        return _PARTY_NAME[cleaned]
    return cleaned[:3].upper()


def _parse_members(payload: dict) -> list[dict]:
    """Extract [{bioguide_id, position, party}] from a /members API payload.

    Key names confirmed against agent/tests/unit/fixtures/house_vote_members_sample.json:
      - container key: houseRollCallVoteMemberVotes
      - member array key: results
      - bioguide key: bioguideID  (capital I and D)
      - position key: voteCast     (values: "Yea" | "Nay" | "Present" | "Not Voting")
      - party key:    voteParty    (single-letter: "D" | "R" | "I")
    """
    container = payload.get("houseRollCallVoteMemberVotes", payload)
    rows = container.get("results", container.get("members", []))
    members: list[dict] = []
    for r in rows:
        bioguide = (
            r.get("bioguideID")
            or r.get("bioguide")
            or r.get("bioguideId")
            or ""
        )
        if not bioguide:
            continue
        position = (r.get("voteCast") or r.get("vote") or "").strip()
        members.append({
            "bioguide_id": bioguide,
            "position": position,
            "party": _party_abbr(r.get("voteParty") or r.get("party") or ""),
        })
    return members


def aggregate_vote(members: list[dict]) -> dict:
    """Compute each party's majority position and whether the vote was party-split."""
    dem = [m["position"] for m in members if m["party"] == "DEM"]
    rep = [m["position"] for m in members if m["party"] == "REP"]
    dem_maj = party_majority(dem)
    rep_maj = party_majority(rep)
    return {
        "dem_majority": dem_maj,
        "rep_majority": rep_maj,
        "party_split": bool(dem_maj and rep_maj and dem_maj != rep_maj),
    }


def _own_party_majority(party: str, agg: dict) -> str | None:
    if party == "DEM":
        return agg["dem_majority"]
    if party == "REP":
        return agg["rep_majority"]
    return None


def _get_db(uri: str) -> pymongo.database.Database:
    return pymongo.MongoClient(uri)["districtlens"]


def _incumbents(db: pymongo.database.Database) -> dict[str, dict]:
    """2026-relevant House incumbents keyed by bioguide_id."""
    cur = db["legislator_profiles"].find(
        {"chamber": "house", "race_key_2026": {"$exists": True, "$ne": None}},
        {"_id": 0, "bioguide_id": 1, "name": 1, "race_key_2026": 1},
    )
    return {p["bioguide_id"]: p for p in cur}


def _list_vote_numbers(client: httpx.Client, api_key: str) -> list[dict]:
    votes: list[dict] = []
    offset = 0
    while True:
        resp = client.get(
            f"{CONGRESS_API_BASE}/house-vote/{CONGRESS}/{SESSION}",
            params={"limit": 100, "offset": offset, "api_key": api_key, "format": "json"},
        )
        resp.raise_for_status()
        page = resp.json().get("houseRollCallVotes", []) or []
        if not page:
            break
        votes.extend(page)
        offset += 100
        time.sleep(0.5)
    return votes


def run_import(mongo_uri: str, api_key: str) -> dict[str, int]:
    now = datetime.now(UTC)
    batch_id = now.strftime("house-votes-%Y%m%d-%H%M%S")
    db = _get_db(mongo_uri)
    incumbents = _incumbents(db)
    logger.info("Tracking %d 2026-relevant House incumbents", len(incumbents))

    member_votes = db["member_votes"]
    member_votes.create_index([("bioguide_id", 1), ("congress", 1)])
    member_votes.create_index(
        [("bioguide_id", 1), ("congress", 1), ("session", 1), ("roll_call", 1)],
        unique=True,
    )

    contexts: dict[str, list[MemberVoteContext]] = {b: [] for b in incumbents}
    latest_date: dict[str, str] = {}
    raw_ops: list[UpdateOne] = []

    with httpx.Client(timeout=30, follow_redirects=True) as client:
        votes = _list_vote_numbers(client, api_key)
        logger.info(
            "Found %d House roll calls for %d-%d", len(votes), CONGRESS, SESSION
        )

        for v in votes:
            roll_call = v.get("rollCallNumber") or v.get("voteNumber")
            if roll_call is None:
                continue
            try:
                resp = client.get(
                    f"{CONGRESS_API_BASE}/house-vote/{CONGRESS}/{SESSION}/{roll_call}/members",
                    params={"api_key": api_key, "format": "json"},
                )
                if resp.status_code == 429:
                    time.sleep(60)
                    continue
                resp.raise_for_status()
                members = _parse_members(resp.json())
            except httpx.HTTPError as exc:
                logger.warning("vote %s fetch failed: %s", roll_call, exc)
                continue

            agg = aggregate_vote(members)
            vote_date = (v.get("startDate") or v.get("date") or "")[:10]
            question = (v.get("voteQuestion") or v.get("question") or "")[:300]
            result = v.get("result") or ""
            source_url = (
                f"https://www.congress.gov/roll-call-vote/{CONGRESS}-{SESSION}/{roll_call}"
            )

            for m in members:
                bg = m["bioguide_id"]
                if bg not in incumbents:
                    continue
                own_maj = _own_party_majority(m["party"], agg)
                contexts[bg].append(
                    MemberVoteContext(
                        position=m["position"],
                        own_party_majority=own_maj or "",
                        party_split=agg["party_split"] and own_maj is not None,
                    )
                )
                if vote_date > latest_date.get(bg, ""):
                    latest_date[bg] = vote_date
                raw_ops.append(UpdateOne(
                    {
                        "bioguide_id": bg,
                        "congress": CONGRESS,
                        "session": SESSION,
                        "roll_call": roll_call,
                    },
                    {"$set": {
                        "bioguide_id": bg,
                        "member_name": incumbents[bg]["name"],
                        "race_key_2026": incumbents[bg]["race_key_2026"],
                        "congress": CONGRESS,
                        "session": SESSION,
                        "roll_call": roll_call,
                        "position": m["position"],
                        "member_party": m["party"],
                        "question": question,
                        "result": result,
                        "vote_date": vote_date,
                        "dem_majority": agg["dem_majority"],
                        "rep_majority": agg["rep_majority"],
                        "party_split": agg["party_split"],
                        "source_url": source_url,
                        "source_system": "congress_gov_api",
                        "import_batch_id": batch_id,
                        "ingested_at": now,
                    }},
                    upsert=True,
                ))
            time.sleep(0.4)

    if raw_ops:
        member_votes.bulk_write(raw_ops, ordered=False)

    summaries = db["voting_record_summaries"]
    summaries.create_index([("bioguide_id", 1), ("congress", 1)], unique=True)
    summaries.create_index([("race_key_2026", 1)])
    stale_after = now + timedelta(days=2)
    summary_ops: list[UpdateOne] = []
    for bg, ctxs in contexts.items():
        if not ctxs:
            continue
        metrics = compute_metrics(ctxs)
        summary_ops.append(UpdateOne(
            {"bioguide_id": bg, "congress": CONGRESS},
            {"$set": {
                "bioguide_id": bg,
                "race_key_2026": incumbents[bg]["race_key_2026"],
                "member_name": incumbents[bg]["name"],
                "congress": CONGRESS,
                **metrics,
                "as_of_date": latest_date.get(bg),
                "source_url": (
                    f"https://www.congress.gov/roll-call-votes/{CONGRESS}-{SESSION}"
                ),
                "source_system": "congress_gov_api",
                "import_batch_id": batch_id,
                "ingested_at": now,
                "last_checked_at": now,
                "stale_after": stale_after,
                "freshness_status": "fresh",
            }, "$setOnInsert": {"created_at": now}},
            upsert=True,
        ))
    if summary_ops:
        summaries.bulk_write(summary_ops, ordered=False)

    db["official_import_batches"].insert_one({
        "batch_id": batch_id,
        "source_system": "congress_gov_api_house_votes",
        "counts": {"raw_votes": len(raw_ops), "summaries": len(summary_ops)},
        "started_at": now,
        "completed_at": datetime.now(UTC),
        "status": "completed",
    })
    logger.info("Done: %d raw rows, %d summaries", len(raw_ops), len(summary_ops))
    return {"raw_votes": len(raw_ops), "summaries": len(summary_ops)}


if __name__ == "__main__":
    uri = os.environ.get("MONGODB_URI")
    key = os.environ.get("CONGRESS_API_KEY", "")
    if not uri or not key:
        logger.error("MONGODB_URI and CONGRESS_API_KEY must be set")
        sys.exit(1)
    print(run_import(uri, key))
