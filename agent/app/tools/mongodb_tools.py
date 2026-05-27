"""MongoDB retrieval tools for the DistrictLens agent.

These tools give the agent access to the FEC bulk-imported data in Atlas:
  - get_race_candidates: list candidates for a race
  - get_race_finance_brief: one-call race + finance summary for all candidates
  - get_candidate_finance: financial detail for a single candidate
  - find_candidate: look up a candidate by name and optional state
  - get_incumbent_legislation: recent sponsored bills for a race's incumbent

All tools return {status, data, warnings, source} so the agent trace shows
exactly what the database returned and what civic-safety warnings apply.

Race key format: 2026-{H|S}-{STATE}-{DISTRICT:02d}
  e.g.  2026-H-WI-04  (Wisconsin 4th Congressional District)
        2026-S-WI-00  (Wisconsin Senate seat)
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import pymongo
import pymongo.errors
from google.adk.tools import ToolContext

logger = logging.getLogger(__name__)

CONGRESS_GOV_URL = "https://www.congress.gov"
_BIOGUIDE_PHOTO_BASE = "https://bioguide.congress.gov/bioguide/photo"


def _bioguide_photo_url(bioguide_id: str) -> str:
    if not bioguide_id:
        return ""
    bid = bioguide_id.upper()
    return f"{_BIOGUIDE_PHOTO_BASE}/{bid[0]}/{bid}.jpg"
FEC_SOURCE = "FEC bulk import (fec.gov), 2026 cycle, imported 2026-05-14"
CONGRESS_SOURCE = "Congress.gov official records, 119th Congress"
HOUSE_VOTES_SOURCE = "Congress.gov House roll-call votes, 119th Congress"

_mongo_client: pymongo.MongoClient | None = None  # type: ignore[type-arg]


def _get_db() -> pymongo.database.Database:  # type: ignore[type-arg]
    global _mongo_client
    if _mongo_client is None:
        uri = os.environ.get("MONGODB_URI", "")
        if not uri:
            raise RuntimeError("MONGODB_URI not set")
        _mongo_client = pymongo.MongoClient(uri)
    return _mongo_client["districtlens"]


def _fmt_money(val: float | None) -> str:
    if val is None:
        return "not reported"
    if abs(val) >= 1_000_000:
        return f"${val / 1_000_000:.2f}M"
    if abs(val) >= 1_000:
        return f"${val / 1_000:.1f}K"
    return f"${val:.0f}"


def _error(message: str, source: str = "") -> dict[str, Any]:
    return {"status": "error", "data": None, "warnings": [message], "source": source}


def _not_found(message: str, source: str = "") -> dict[str, Any]:
    return {"status": "not_found", "data": None, "warnings": [message], "source": source}


_CANDIDATE_PROJECTION = {
    "_id": 0, "candidate_id": 1, "name": 1, "party": 1,
    "incumbent_challenge_status": 1, "primary_committee_id": 1, "bioguide_id": 1,
}

# Deterministic candidate ordering, shared by every candidate query so the
# candidates/finance stages never reorder rows (candidate_id breaks status ties).
_CANDIDATE_SORT = [("incumbent_challenge_status", 1), ("candidate_id", 1)]

_FINANCE_PROJECTION = {
    "_id": 0, "candidate_id": 1, "receipts": 1, "disbursements": 1,
    "cash_on_hand": 1, "individual_contributions": 1,
    "pac_contributions": 1, "coverage_end_date": 1,
}


def _to_candidate_card(candidate: dict, race_key: str) -> dict[str, Any]:
    """Build the camelCase CandidateCard shape the frontend canvas reads."""
    return {
        "candidateId": candidate["candidate_id"],
        "name": candidate["name"],
        "party": candidate["party"],
        "status": candidate.get("incumbent_challenge_status", "unknown"),
        "photoUrl": _bioguide_photo_url(candidate.get("bioguide_id", "")),
        "photoSource": "bioguide" if candidate.get("bioguide_id") else "placeholder",
        "raceKey": race_key,
    }


def _to_finance_summary(candidate: dict, finance: dict | None) -> dict[str, Any]:
    """Build the camelCase FinanceSummary shape the frontend canvas reads."""
    finance = finance or {}
    return {
        "candidateId": candidate["candidate_id"],
        "name": candidate["name"],
        "party": candidate["party"],
        "receipts": finance.get("receipts"),
        "disbursements": finance.get("disbursements"),
        "cashOnHand": finance.get("cash_on_hand"),
        "individualContributions": finance.get("individual_contributions"),
        "pacContributions": finance.get("pac_contributions"),
        "coverageEndDate": finance.get("coverage_end_date"),
    }


def _to_bill_record(bill: dict, fallback_member: str) -> dict[str, Any]:
    """Build the camelCase BillRecord shape the frontend canvas reads."""
    return {
        "billId": bill["bill_id"],
        "title": bill.get("title", "")[:200],
        "introducedDate": bill.get("introduced_date"),
        "latestAction": bill.get("latest_action", "")[:150],
        "memberName": bill.get("member_name", fallback_member),
    }


def _to_voting_record(summary: dict) -> dict[str, Any]:
    """Build the camelCase VotingRecordSummary the frontend canvas reads."""
    return {
        "memberName": summary.get("member_name", "The incumbent"),
        "congress": f"{summary.get('congress', 119)}th",
        "attendancePct": summary.get("attendance_pct"),
        "partyLinePct": summary.get("party_line_pct"),  # None = honest gap
        "votesCast": summary.get("votes_cast"),
        "votesMissed": summary.get("votes_missed"),
        "totalRollCalls": summary.get("total_roll_calls"),
        "asOfDate": summary.get("as_of_date"),
        "sourceUrl": summary.get("source_url", CONGRESS_GOV_URL),
    }


def _query_candidate_cards(race_key: str) -> list[dict[str, Any]]:
    db = _get_db()
    candidates = list(
        db.candidates.find({"race_key": race_key}, _CANDIDATE_PROJECTION).sort(
            _CANDIDATE_SORT
        )
    )
    return [_to_candidate_card(c, race_key) for c in candidates]


def _query_finance_summaries(race_key: str) -> list[dict[str, Any]]:
    db = _get_db()
    candidates = list(
        db.candidates.find({"race_key": race_key}, _CANDIDATE_PROJECTION).sort(
            _CANDIDATE_SORT
        )
    )
    candidate_ids = [c["candidate_id"] for c in candidates]
    finance_by_id = {
        f["candidate_id"]: f
        for f in db.finance_summaries.find(
            {"candidate_id": {"$in": candidate_ids}}, _FINANCE_PROJECTION
        )
    }
    return [
        _to_finance_summary(c, finance_by_id.get(c["candidate_id"]))
        for c in candidates
    ]


def _query_legislation_records(race_key: str, limit: int = 8) -> list[dict[str, Any]]:
    db = _get_db()
    bills = list(
        db.legislative_actions.find(
            {"race_key_2026": race_key, "action_type": "sponsored_bill"},
            {"_id": 0, "bill_id": 1, "title": 1, "introduced_date": 1,
             "latest_action": 1, "latest_action_date": 1, "url": 1, "member_name": 1},
        )
        .sort("introduced_date", -1)
        .limit(min(limit, 20))
    )
    if not bills:
        return []
    fallback_member = bills[0].get("member_name", "The incumbent")
    return [_to_bill_record(b, fallback_member) for b in bills]


async def fetch_candidate_cards(race_key: str) -> list[dict[str, Any]]:
    """Async data core: candidate cards for a race (used by the brief pipeline)."""
    return await asyncio.to_thread(_query_candidate_cards, race_key)


async def fetch_finance_summaries(race_key: str) -> list[dict[str, Any]]:
    """Async data core: finance summaries for a race (used by the brief pipeline)."""
    return await asyncio.to_thread(_query_finance_summaries, race_key)


async def fetch_legislation_records(race_key: str) -> list[dict[str, Any]]:
    """Async data core: incumbent legislation for a race (used by the brief pipeline)."""
    return await asyncio.to_thread(_query_legislation_records, race_key)


def _query_voting_record(race_key: str) -> dict[str, Any] | None:
    db = _get_db()
    summary = db.voting_record_summaries.find_one(
        {"race_key_2026": race_key}, {"_id": 0}
    )
    return _to_voting_record(summary) if summary else None


async def fetch_voting_record(race_key: str) -> dict[str, Any] | None:
    """Async data core: incumbent voting-record summary (brief pipeline)."""
    return await asyncio.to_thread(_query_voting_record, race_key)


def get_race_candidates(race_key: str, tool_context: ToolContext) -> dict[str, Any]:
    """Look up all 2026 candidates for a congressional race by race key.

    Use this after resolve_district (which returns a race key like '2026-H-WI-04')
    to find who is running in that race. Returns candidate names, parties, and
    their FEC status (incumbent, challenger, or open-seat candidate).

    Args:
        race_key: The race identifier in the format '2026-{H|S}-{STATE}-{DISTRICT}'.
                  Example: '2026-H-WI-04', '2026-S-CA-00'.
    """
    tool_context.state["status_message"] = f"Loading candidates for {race_key}…"
    try:
        db = _get_db()
        cands = list(
            db.candidates.find(
                {"race_key": race_key}, _CANDIDATE_PROJECTION
            ).sort(_CANDIDATE_SORT)
        )
    except pymongo.errors.PyMongoError as exc:
        logger.error("mongodb.get_race_candidates: %s", exc)
        return _error(f"Database error retrieving candidates for {race_key}.", FEC_SOURCE)

    if not cands:
        return _not_found(
            f"No candidates found for race {race_key}. "
            "This race may not have active FEC filers yet, or the race key may be incorrect.",
            FEC_SOURCE,
        )

    candidate_cards = [_to_candidate_card(c, race_key) for c in cands]
    tool_context.state["currentRaceKey"] = race_key
    tool_context.state["stage"] = "candidates"
    tool_context.state["candidates"] = candidate_cards

    return {
        "status": "success",
        "data": {
            "race_key": race_key,
            "candidate_count": len(cands),
            "candidates": [
                {
                    "name": c["name"],
                    "party": c["party"],
                    "status": c.get("incumbent_challenge_status", "unknown").replace("_", " "),
                    "candidate_id": c["candidate_id"],
                }
                for c in cands
            ],
        },
        "warnings": [],
        "source": FEC_SOURCE,
    }


def get_race_finance_brief(race_key: str, tool_context: ToolContext) -> dict[str, Any]:
    """Get a finance summary for all candidates in a race in one call.

    Returns fundraising totals, disbursements, cash on hand, and the
    individual vs. PAC contribution split for every candidate with FEC
    financial filings in the specified race. Use this to give a comparative
    finance overview of a congressional race.

    Args:
        race_key: Race identifier, e.g. '2026-H-WI-04' or '2026-S-TX-00'.
    """
    tool_context.state["status_message"] = f"Pulling FEC finance data for {race_key}…"
    try:
        db = _get_db()
        cands = list(
            db.candidates.find({"race_key": race_key}, _CANDIDATE_PROJECTION).sort(
                _CANDIDATE_SORT
            )
        )
        if not cands:
            return _not_found(f"No candidates found for race {race_key}.", FEC_SOURCE)

        cand_ids = [c["candidate_id"] for c in cands]
        fins = {
            f["candidate_id"]: f
            for f in db.finance_summaries.find(
                {"candidate_id": {"$in": cand_ids}}, _FINANCE_PROJECTION
            )
        }
    except pymongo.errors.PyMongoError as exc:
        logger.error("mongodb.get_race_finance_brief: %s", exc)
        return _error(f"Database error retrieving finance data for {race_key}.", FEC_SOURCE)

    candidates_finance = []
    missing_finance = []
    for c in sorted(cands, key=lambda x: x.get("incumbent_challenge_status", "z")):
        fin = fins.get(c["candidate_id"])
        entry: dict[str, Any] = {
            "name": c["name"],
            "party": c["party"],
            "status": c.get("incumbent_challenge_status", "unknown").replace("_", " "),
            "candidate_id": c["candidate_id"],
        }
        if fin:
            entry.update({
                "raised": fin.get("receipts"),
                "raised_fmt": _fmt_money(fin.get("receipts")),
                "spent": fin.get("disbursements"),
                "spent_fmt": _fmt_money(fin.get("disbursements")),
                "cash_on_hand": fin.get("cash_on_hand"),
                "cash_on_hand_fmt": _fmt_money(fin.get("cash_on_hand")),
                "individual_contributions": fin.get("individual_contributions"),
                "individual_contributions_fmt": _fmt_money(fin.get("individual_contributions")),
                "pac_contributions": fin.get("pac_contributions"),
                "pac_contributions_fmt": _fmt_money(fin.get("pac_contributions")),
                "coverage_end_date": fin.get("coverage_end_date"),
                "has_finance": True,
            })
        else:
            entry["has_finance"] = False
            missing_finance.append(c["name"])

        candidates_finance.append(entry)

    warnings = [
        "Finance data reflects FEC filings through each candidate's coverage end date.",
        "Finance figures are fundraising context. They do not prove issue positions.",
    ]
    if missing_finance:
        warnings.append(
            f"No FEC financial filing on record for: {', '.join(missing_finance)}."
        )

    # Push canvas state so the frontend receipt updates in real time.
    candidate_cards = [_to_candidate_card(c, race_key) for c in cands]
    finance_summaries = [
        _to_finance_summary(c, fins.get(c["candidate_id"])) for c in cands
    ]
    tool_context.state["currentRaceKey"] = race_key
    tool_context.state["stage"] = "finance"
    tool_context.state["candidates"] = candidate_cards
    tool_context.state["finance"] = finance_summaries

    return {
        "status": "success",
        "data": {
            "race_key": race_key,
            "candidates": candidates_finance,
        },
        "warnings": warnings,
        "source": FEC_SOURCE,
    }


def get_candidate_finance(candidate_id: str) -> dict[str, Any]:
    """Get detailed campaign finance data for a single FEC candidate.

    Use this when you need specific financial details for one candidate
    (not a full race comparison). The candidate_id comes from get_race_candidates.

    Args:
        candidate_id: The FEC candidate ID, e.g. 'H4WI04183'. Always starts
                      with H (House), S (Senate), or P (President).
    """
    try:
        db = _get_db()
        cand = db.candidates.find_one(
            {"candidate_id": candidate_id},
            {"_id": 0, "name": 1, "party": 1, "race_key": 1,
             "incumbent_challenge_status": 1},
        )
        fin = db.finance_summaries.find_one(
            {"candidate_id": candidate_id},
            {"_id": 0, "receipts": 1, "disbursements": 1, "cash_on_hand": 1,
             "individual_contributions": 1, "pac_contributions": 1,
             "candidate_contributions": 1, "loans_from_candidate": 1,
             "debts": 1, "coverage_end_date": 1},
        )
    except pymongo.errors.PyMongoError as exc:
        logger.error("mongodb.get_candidate_finance: %s", exc)
        return _error(
            f"Database error retrieving finance for candidate {candidate_id}.", FEC_SOURCE
        )

    if not cand:
        return _not_found(f"No candidate found with ID {candidate_id}.", FEC_SOURCE)

    if not fin:
        return _not_found(
            f"{cand['name']} ({cand['party']}) has no financial filing on record. "
            "They may not have registered a committee yet.",
            FEC_SOURCE,
        )

    return {
        "status": "success",
        "data": {
            "candidate_id": candidate_id,
            "name": cand["name"],
            "party": cand["party"],
            "race_key": cand.get("race_key"),
            "status": cand.get("incumbent_challenge_status", "").replace("_", " "),
            "raised": fin.get("receipts"),
            "raised_fmt": _fmt_money(fin.get("receipts")),
            "spent": fin.get("disbursements"),
            "spent_fmt": _fmt_money(fin.get("disbursements")),
            "cash_on_hand": fin.get("cash_on_hand"),
            "cash_on_hand_fmt": _fmt_money(fin.get("cash_on_hand")),
            "individual_contributions": fin.get("individual_contributions"),
            "individual_contributions_fmt": _fmt_money(fin.get("individual_contributions")),
            "pac_contributions": fin.get("pac_contributions"),
            "pac_contributions_fmt": _fmt_money(fin.get("pac_contributions")),
            "candidate_contributions": fin.get("candidate_contributions"),
            "candidate_contributions_fmt": _fmt_money(fin.get("candidate_contributions")),
            "loans_from_candidate": fin.get("loans_from_candidate"),
            "loans_from_candidate_fmt": _fmt_money(fin.get("loans_from_candidate")),
            "debts": fin.get("debts"),
            "debts_fmt": _fmt_money(fin.get("debts")),
            "coverage_end_date": fin.get("coverage_end_date"),
        },
        "warnings": [
            "Finance data reflects FEC filings through the coverage end date.",
            "Finance figures are fundraising context. They do not prove issue positions.",
        ],
        "source": FEC_SOURCE,
    }


def find_candidate(name: str, state: str = "") -> dict[str, Any]:
    """Search for a congressional candidate by name across 2026 FEC filings.

    Use this when a user names a candidate but you don't have their race key
    or candidate ID. Returns matching candidates with their race keys so you
    can follow up with get_race_candidates or get_candidate_finance.

    Args:
        name: Candidate name or partial name, e.g. 'Gwen Moore' or 'Moore'.
        state: Optional two-letter state code to narrow results, e.g. 'WI'.
    """
    try:
        db = _get_db()
        query: dict = {"$text": {"$search": name}}
        if state:
            query["state"] = state.upper()
        results = list(
            db.candidates.find(
                query,
                {"_id": 0, "candidate_id": 1, "name": 1, "party": 1,
                 "race_key": 1, "incumbent_challenge_status": 1,
                 "score": {"$meta": "textScore"}},
            )
            .sort([("score", {"$meta": "textScore"})])
            .limit(8)
        )
    except pymongo.errors.PyMongoError as exc:
        logger.error("mongodb.find_candidate: %s", exc)
        return _error(f"Database error searching for candidate '{name}'.", FEC_SOURCE)

    if not results:
        return _not_found(
            f"No 2026 FEC filers found matching '{name}'"
            + (f" in {state.upper()}" if state else "")
            + ". They may not have filed with the FEC yet.",
            FEC_SOURCE,
        )

    return {
        "status": "success",
        "data": {
            "query": name,
            "state_filter": state.upper() if state else None,
            "match_count": len(results),
            "candidates": [
                {
                    "name": r["name"],
                    "party": r["party"],
                    "status": r.get("incumbent_challenge_status", "unknown").replace("_", " "),
                    "race_key": r["race_key"],
                    "candidate_id": r["candidate_id"],
                }
                for r in results
            ],
        },
        "warnings": [],
        "source": FEC_SOURCE,
    }


def get_incumbent_legislation(race_key: str, tool_context: ToolContext, limit: int = 8) -> dict[str, Any]:
    """Get recent sponsored legislation for the incumbent in a 2026 congressional race.

    Returns bills the incumbent has introduced in the current 119th Congress
    (Jan 2025 to present), with bill IDs, titles, and latest committee status.
    Use this to describe an incumbent's legislative priorities and activity.

    Civic safety: bill sponsorship shows legislative priorities, not personal
    policy positions. Always label these as "sponsored legislation" and cite
    Congress.gov as the source.

    Args:
        race_key: Race identifier, e.g. '2026-H-WI-04'. Must contain an incumbent.
        limit: Maximum bills to return (default 8, max 20).
    """
    tool_context.state["status_message"] = f"Loading incumbent legislation for {race_key}…"
    try:
        db = _get_db()
        bills = list(
            db.legislative_actions.find(
                {"race_key_2026": race_key, "action_type": "sponsored_bill"},
                {"_id": 0, "bill_id": 1, "title": 1, "introduced_date": 1,
                 "latest_action": 1, "latest_action_date": 1, "url": 1, "member_name": 1},
            )
            .sort("introduced_date", -1)
            .limit(min(limit, 20))
        )
    except pymongo.errors.PyMongoError as exc:
        logger.error("mongodb.get_incumbent_legislation: %s", exc)
        return _error(f"Database error retrieving legislation for {race_key}.", CONGRESS_SOURCE)

    if not bills:
        return _not_found(
            f"No sponsored legislation found for the incumbent in race {race_key}. "
            "The incumbent may not have filed sponsorships in the 119th Congress yet, "
            "or this race may have no incumbent.",
            CONGRESS_SOURCE,
        )

    member = bills[0].get("member_name", "The incumbent")
    bill_records = [_to_bill_record(b, member) for b in bills]
    tool_context.state["legislation"] = bill_records
    tool_context.state["stage"] = "legislation"

    return {
        "status": "success",
        "data": {
            "race_key": race_key,
            "member_name": member,
            "bill_count": len(bills),
            "congress": "119th",
            "bills": [
                {
                    "bill_id": b["bill_id"],
                    "title": b.get("title", "")[:200],
                    "introduced_date": b.get("introduced_date"),
                    "latest_action": b.get("latest_action", "")[:150],
                    "latest_action_date": b.get("latest_action_date"),
                    "url": b.get("url"),
                }
                for b in bills
            ],
        },
        "warnings": [
            "Bill sponsorship reflects legislative priorities, not a definitive policy position.",
        ],
        "source": CONGRESS_SOURCE,
    }


def get_voting_record(race_key: str, tool_context: ToolContext) -> dict[str, Any]:
    """Get the incumbent's House vote attendance % and party-line voting %.

    Computed from 119th-Congress roll-call votes (Congress.gov). Attendance %
    is the share of roll calls the member voted on (Yea/Nay/Present); party-line
    % is the share of party-split votes where they sided with their own party's
    majority. Use this for the incumbent record section.

    Civic safety: these are voting-behavior metrics, not policy positions, and
    party-line % is omitted (not zero) when there are no party-split votes yet.

    Args:
        race_key: Race identifier, e.g. '2026-H-WI-04'. Must contain a House incumbent.
    """
    tool_context.state["status_message"] = f"Computing voting record for {race_key}…"
    try:
        record = _query_voting_record(race_key)
    except pymongo.errors.PyMongoError as exc:
        logger.error("mongodb.get_voting_record: %s", exc)
        return _error(f"Database error retrieving voting record for {race_key}.", HOUSE_VOTES_SOURCE)

    if record is None:
        return _not_found(
            f"No computed voting record for race {race_key}. "
            "This race may have no House incumbent, or votes have not been ingested yet.",
            HOUSE_VOTES_SOURCE,
        )

    tool_context.state["votingRecord"] = record
    tool_context.state["stage"] = "legislation"
    warnings = [
        "Attendance and party-line percentages describe voting behavior, not policy positions.",
    ]
    if record["partyLinePct"] is None:
        warnings.append("Not enough party-split votes yet to compute a party-line percentage.")

    return {
        "status": "success",
        "data": {"race_key": race_key, **record},
        "warnings": warnings,
        "source": HOUSE_VOTES_SOURCE,
    }
