"""MongoDB retrieval tools for the DistrictLens agent.

These tools give the agent access to the FEC bulk-imported data in Atlas:
  - get_race_candidates: list candidates for a race
  - get_race_finance_brief: one-call race + finance summary for all candidates
  - get_candidate_finance: financial detail for a single candidate
  - find_candidate: look up a candidate by name and optional state

All tools use the singleton pymongo client from district_lookup to avoid
duplicate connection overhead.

Race key format: 2026-{H|S}-{STATE}-{DISTRICT:02d}
  e.g.  2026-H-WI-04  (Wisconsin 4th Congressional District)
        2026-S-WI-00  (Wisconsin Senate seat)
"""

from __future__ import annotations

import logging
import os

import pymongo
import pymongo.errors

logger = logging.getLogger(__name__)

CONGRESS_GOV_URL = "https://www.congress.gov"

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


def get_race_candidates(race_key: str) -> str:
    """Look up all 2026 candidates for a congressional race by race key.

    Use this after resolve_district (which returns a race key like '2026-H-WI-04')
    to find who is running in that race. Returns candidate names, parties, and
    their FEC status (incumbent, challenger, or open-seat candidate).

    Args:
        race_key: The race identifier in the format '2026-{H|S}-{STATE}-{DISTRICT}'.
                  Example: '2026-H-WI-04', '2026-S-CA-00'.
    """
    try:
        db = _get_db()
        cands = list(
            db.candidates.find(
                {"race_key": race_key},
                {"_id": 0, "candidate_id": 1, "name": 1, "party": 1,
                 "incumbent_challenge_status": 1, "primary_committee_id": 1},
            ).sort("incumbent_challenge_status", 1)
        )
    except pymongo.errors.PyMongoError as exc:
        logger.error("mongodb.get_race_candidates: %s", exc)
        return f"Database error retrieving candidates for {race_key}."

    if not cands:
        return (
            f"No candidates found in the database for race {race_key}. "
            "This race may not have active FEC filers yet, or the race key may be incorrect."
        )

    lines = [f"Candidates for {race_key} (2026 FEC filings):"]
    for c in cands:
        status = c.get("incumbent_challenge_status", "unknown").replace("_", " ")
        lines.append(f"  {c['name']} ({c['party']}) — {status} [ID: {c['candidate_id']}]")

    lines.append(f"\nTotal: {len(cands)} candidate(s) with FEC filings in this race.")
    return "\n".join(lines)


def get_race_finance_brief(race_key: str) -> str:
    """Get a finance summary for all candidates in a race in one call.

    Returns fundraising totals, disbursements, and cash on hand for every
    candidate with FEC financial filings in the specified race. Use this
    to give a comparative finance overview of a congressional race.

    Args:
        race_key: Race identifier, e.g. '2026-H-WI-04' or '2026-S-TX-00'.
    """
    try:
        db = _get_db()
        cands = list(
            db.candidates.find(
                {"race_key": race_key},
                {"_id": 0, "candidate_id": 1, "name": 1, "party": 1,
                 "incumbent_challenge_status": 1},
            )
        )
        if not cands:
            return f"No candidates found for race {race_key}."

        cand_ids = [c["candidate_id"] for c in cands]
        fins = {
            f["candidate_id"]: f
            for f in db.finance_summaries.find(
                {"candidate_id": {"$in": cand_ids}},
                {"_id": 0, "candidate_id": 1, "receipts": 1, "disbursements": 1,
                 "cash_on_hand": 1, "individual_contributions": 1,
                 "pac_contributions": 1, "coverage_end_date": 1},
            )
        }
    except pymongo.errors.PyMongoError as exc:
        logger.error("mongodb.get_race_finance_brief: %s", exc)
        return f"Database error retrieving finance data for {race_key}."

    lines = [f"Finance summary for {race_key}:"]
    for c in sorted(cands, key=lambda x: x.get("incumbent_challenge_status", "z")):
        status = c.get("incumbent_challenge_status", "unknown").replace("_", " ")
        fin = fins.get(c["candidate_id"])
        if fin:
            cov = fin.get("coverage_end_date", "unknown date")
            lines.append(
                f"\n  {c['name']} ({c['party']}, {status})"
                f"\n    Raised:       {_fmt_money(fin.get('receipts'))} (through {cov})"
                f"\n    Spent:        {_fmt_money(fin.get('disbursements'))}"
                f"\n    Cash on hand: {_fmt_money(fin.get('cash_on_hand'))}"
                f"\n    From individuals: {_fmt_money(fin.get('individual_contributions'))}"
                f"\n    From PACs:        {_fmt_money(fin.get('pac_contributions'))}"
            )
        else:
            lines.append(f"\n  {c['name']} ({c['party']}, {status}) — no financial filing on record")

    lines.append(
        "\nSource: FEC bulk data (fec.gov), imported 2026-05-14. "
        "Finance data reflects FEC filings through the coverage end date shown."
    )
    return "\n".join(lines)


def get_candidate_finance(candidate_id: str) -> str:
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
        return f"Database error retrieving finance for candidate {candidate_id}."

    if not cand:
        return f"No candidate found with ID {candidate_id}."
    if not fin:
        return (
            f"{cand['name']} ({cand['party']}) has no financial filing on record in the FEC database. "
            "They may not have registered a committee yet."
        )

    cov = fin.get("coverage_end_date", "unknown")
    return (
        f"Finance for {cand['name']} ({cand['party']}) — {cand.get('incumbent_challenge_status','').replace('_',' ')}"
        f"\nRace: {cand.get('race_key', 'unknown')}\n"
        f"\n  Total raised:          {_fmt_money(fin.get('receipts'))}"
        f"\n  Total spent:           {_fmt_money(fin.get('disbursements'))}"
        f"\n  Cash on hand:          {_fmt_money(fin.get('cash_on_hand'))}"
        f"\n  From individuals:      {_fmt_money(fin.get('individual_contributions'))}"
        f"\n  From PACs:             {_fmt_money(fin.get('pac_contributions'))}"
        f"\n  From candidate:        {_fmt_money(fin.get('candidate_contributions'))}"
        f"\n  Loans from candidate:  {_fmt_money(fin.get('loans_from_candidate'))}"
        f"\n  Debts owed:            {_fmt_money(fin.get('debts'))}"
        f"\n\nCoverage through: {cov}"
        f"\nSource: FEC bulk data (fec.gov). Finance records do not prove issue positions "
        f"— use only for fundraising context."
    )


def find_candidate(name: str, state: str = "") -> str:
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
        return f"Database error searching for candidate '{name}'."

    if not results:
        return (
            f"No 2026 FEC filers found matching '{name}'"
            + (f" in {state.upper()}" if state else "")
            + ". They may not have filed with the FEC yet."
        )

    lines = [f"Candidates matching '{name}'" + (f" in {state.upper()}" if state else "") + ":"]
    for r in results:
        status = r.get("incumbent_challenge_status", "unknown").replace("_", " ")
        lines.append(
            f"  {r['name']} ({r['party']}, {status}) — {r['race_key']} [ID: {r['candidate_id']}]"
        )
    return "\n".join(lines)


def get_incumbent_legislation(race_key: str, limit: int = 8) -> str:
    """Get recent sponsored legislation for the incumbent in a 2026 congressional race.

    Returns bills the incumbent has introduced in the current 119th Congress
    (Jan 2025 – present), with bill IDs, titles, and latest committee status.
    Use this to describe an incumbent's legislative priorities and activity.

    Civic safety: bill sponsorship shows legislative priorities, not personal
    policy positions. Always label these as "sponsored legislation" and cite
    Congress.gov as the source.

    Args:
        race_key: Race identifier, e.g. '2026-H-WI-04'. Must contain an incumbent.
        limit: Maximum bills to return (default 8, max 20).
    """
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
        return f"Database error retrieving legislation for {race_key}."

    if not bills:
        return (
            f"No sponsored legislation found for the incumbent in race {race_key}. "
            "The incumbent may not have filed sponsorships in the 119th Congress yet, "
            "or the race key may have no incumbent."
        )

    member = bills[0].get("member_name", "The incumbent")
    lines = [
        f"Recent sponsored legislation for {member} ({race_key}) — 119th Congress:",
        f"Source: Congress.gov official records.",
    ]
    for b in bills:
        status = b.get("latest_action", "")
        date_str = f" ({b['introduced_date']})" if b.get("introduced_date") else ""
        lines.append(f"\n  {b['bill_id']}{date_str}: {b.get('title','')[:120]}")
        if status:
            lines.append(f"    Status: {status[:100]}")

    lines.append(
        "\nBill sponsorship shows legislative priorities. "
        "It does not constitute a definitive policy position statement."
    )
    return "\n".join(lines)
