"""Tool: get_state_races — journalist mode state drill-down.

Fetches all 2026 congressional races for a state and writes the stateRaces
and mapFocus fields into agent state so the frontend race table populates.
"""

from __future__ import annotations

import logging

import pymongo
import pymongo.errors
from google.adk.tools import ToolContext

from app.tools.mongodb_tools import _get_db, _fmt_money, _error, FEC_SOURCE

logger = logging.getLogger(__name__)


def get_state_races(state_code: str, tool_context: ToolContext) -> dict:
    """Fetch all 2026 congressional races for a U.S. state.

    Use this when the user is in journalist mode and clicks on a state, or
    asks to see all races in a specific state. Writes the race list into
    agent state so the frontend table updates in real time.

    Args:
        state_code: Two-letter state abbreviation, e.g. "WI", "TX", "CA".
    """
    state = state_code.upper().strip()
    tool_context.state["status_message"] = f"Loading 2026 races for {state}…"
    tool_context.state["mapFocus"] = state

    try:
        db = _get_db()
        races = list(
            db.races.find(
                {"state": state},
                {
                    "_id": 0,
                    "race_key": 1,
                    "state": 1,
                    "office": 1,
                    "district": 1,
                    "incumbent_name_bp": 1,
                },
            )
        )
    except pymongo.errors.PyMongoError as exc:
        logger.error("state_races.get_state_races: %s", exc)
        return _error(f"Database error loading races for {state}.", FEC_SOURCE)

    if not races:
        tool_context.state["stateRaces"] = []
        return {
            "status": "not_found",
            "data": None,
            "warnings": [f"No 2026 congressional races found for state {state}."],
            "source": FEC_SOURCE,
        }

    race_keys = [r["race_key"] for r in races]

    try:
        candidates = list(
            db.candidates.find(
                {"race_key": {"$in": race_keys}},
                {
                    "_id": 0,
                    "candidate_id": 1,
                    "name": 1,
                    "party": 1,
                    "race_key": 1,
                    "incumbent_challenge_status": 1,
                },
            )
        )
        cand_ids = [c["candidate_id"] for c in candidates]
        finance_docs = list(
            db.finance_summaries.find(
                {"candidate_id": {"$in": cand_ids}},
                {"_id": 0, "candidate_id": 1, "receipts": 1, "pac_contributions": 1},
            )
        )
    except pymongo.errors.PyMongoError as exc:
        logger.error("state_races.get_state_races finance: %s", exc)
        return _error(f"Database error loading finance for {state} races.", FEC_SOURCE)

    fin_map = {f["candidate_id"]: f for f in finance_docs}

    rows = []
    for race in races:
        rk = race["race_key"]
        race_cands = [c for c in candidates if c["race_key"] == rk]
        incumbent = next((c for c in race_cands if c.get("incumbent_challenge_status") == "incumbent"), None)
        challengers = [c for c in race_cands if c.get("incumbent_challenge_status") != "incumbent"]

        inc_fin = fin_map.get(incumbent["candidate_id"]) if incumbent else None
        inc_receipts: float | None = inc_fin.get("receipts") if inc_fin else None

        top_challenger = sorted(
            challengers,
            key=lambda c: fin_map.get(c["candidate_id"], {}).get("receipts") or 0,
            reverse=True,
        )[0] if challengers else None
        chal_fin = fin_map.get(top_challenger["candidate_id"]) if top_challenger else None
        chal_receipts: float | None = chal_fin.get("receipts") if chal_fin else None

        finance_gap = (inc_receipts - chal_receipts) if (inc_receipts is not None and chal_receipts is not None) else None
        pac_pct = (
            round((inc_fin.get("pac_contributions", 0) or 0) / inc_receipts * 100)
            if inc_receipts and inc_receipts > 0 and inc_fin
            else None
        )

        rows.append({
            "raceKey": rk,
            "state": race.get("state", state),
            "office": race.get("office", ""),
            "district": race.get("district", ""),
            "incumbentName": incumbent["name"] if incumbent else None,
            "incumbentParty": incumbent["party"] if incumbent else None,
            "incumbentReceipts": inc_receipts,
            "topChallengerName": top_challenger["name"] if top_challenger else None,
            "topChallengerReceipts": chal_receipts,
            "financeGap": finance_gap,
            "pacPct": pac_pct,
        })

    tool_context.state["stateRaces"] = rows
    tool_context.state["status_message"] = f"Found {len(rows)} race(s) in {state}."

    return {
        "status": "success",
        "data": {
            "state": state,
            "race_count": len(rows),
            "races": [
                {
                    "race_key": r["raceKey"],
                    "office": r["office"],
                    "district": r["district"],
                    "incumbent": r["incumbentName"],
                    "incumbent_party": r["incumbentParty"],
                    "incumbent_raised": _fmt_money(r["incumbentReceipts"]),
                    "top_challenger": r["topChallengerName"],
                    "challenger_raised": _fmt_money(r["topChallengerReceipts"]),
                }
                for r in rows
            ],
        },
        "warnings": [
            "Finance figures are fundraising context only. They do not prove issue positions.",
        ],
        "source": FEC_SOURCE,
    }
