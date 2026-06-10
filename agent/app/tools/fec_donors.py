"""Live FEC "largest individual donors" tool (demo moment, 2026-06-10 spec).

Pipeline: candidate doc (Mongo) → principal committee (FEC) → schedule_a
receipts sorted by amount → same-page dedupe by contributor name → top 10,
cached 24h in `fec_donor_cache`. Every failure degrades to honest-empty —
this function must never raise into the chat path.

Civic guardrail: contributions are CONTEXT — they never establish policy
positions (.claude/rules/civic_safety.md). The tool docstring repeats this
for the LLM.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.tools.mongodb_tools import _fmt_money, _get_db

logger = logging.getLogger(__name__)

_FEC_BASE = "https://api.open.fec.gov/v1"
_CYCLE = 2026
_PER_PAGE = 50
_TOP_N = 10
_CACHE_TTL = timedelta(hours=24)
_TIMEOUT_S = 10.0
_SOURCE = "FEC API (api.open.fec.gov), 2026 cycle, itemized individual receipts"
_COVERAGE_NOTE = (
    "Largest itemized individual contributions, 2026 cycle. Itemized = over "
    "$200; small-dollar donors are not itemized and do not appear here."
)


def _api_key() -> str:
    """FEC_API_KEY if set; CONGRESS_API_KEY works too (shared api.data.gov keyspace)."""
    return os.environ.get("FEC_API_KEY") or os.environ.get("CONGRESS_API_KEY") or ""


def _normalize_name(name: str) -> str:
    return " ".join((name or "").upper().split())


def _format_city_state(receipt: dict[str, Any]) -> str:
    city = (receipt.get("contributor_city") or "").title()
    state = (receipt.get("contributor_state") or "").upper()
    return ", ".join(part for part in (city, state) if part)


def _dedupe_receipts(receipts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge same-name receipts: sum totals, count, keep latest-dated metadata."""
    merged: dict[str, dict[str, Any]] = {}
    for receipt in receipts:
        key = _normalize_name(receipt.get("contributor_name") or "")
        if not key:
            continue
        amount = float(receipt.get("contribution_receipt_amount") or 0)
        date = (receipt.get("contribution_receipt_date") or "")[:10]
        existing = merged.get(key)
        if existing is None:
            merged[key] = {
                "name": key.title(),
                "total": amount,
                "transactions": 1,
                "latest_date": date,
                "employer": receipt.get("contributor_employer"),
                "occupation": receipt.get("contributor_occupation"),
                "city_state": _format_city_state(receipt),
            }
            continue
        existing["total"] += amount
        existing["transactions"] += 1
        if date > existing["latest_date"]:
            existing["latest_date"] = date
            existing["employer"] = receipt.get("contributor_employer")
            existing["occupation"] = receipt.get("contributor_occupation")
            existing["city_state"] = _format_city_state(receipt)
    rows = sorted(merged.values(), key=lambda d: d["total"], reverse=True)[:_TOP_N]
    return [{**row, "total_fmt": _fmt_money(row["total"])} for row in rows]


def _http_get(path: str, params: dict[str, Any],
              transport: httpx.BaseTransport | None) -> list[dict[str, Any]]:
    """GET an FEC endpoint; returns the results list, [] on any failure."""
    try:
        with httpx.Client(base_url=_FEC_BASE, timeout=_TIMEOUT_S,
                          transport=transport) as client:
            response = client.get(path, params={**params, "api_key": _api_key()})
            response.raise_for_status()
            return response.json().get("results") or []
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("fec_donors: FEC call %s failed: %s", path, exc)
        return []


def _find_candidate_doc(db: Any, race_key: str, candidate_name: str) -> dict | None:
    """Match 'Gwen Moore' against FEC-style 'MOORE, GWEN S' docs in the race."""
    try:
        docs = list(db.candidates.find({"race_key": race_key},
                                       {"_id": 0, "name": 1, "candidate_id": 1}))
    except Exception as exc:  # degrade, never raise into chat
        logger.warning("fec_donors: candidate lookup failed: %s", exc)
        return None
    tokens = set(_normalize_name(candidate_name).replace(",", " ").split())
    for doc in docs:
        doc_tokens = set(_normalize_name(doc.get("name", "")).replace(",", " ").split())
        if tokens and tokens.issubset(doc_tokens):
            return doc
    return None


def _search_fec_candidate(candidate_name: str, race_key: str,
                          transport: httpx.BaseTransport | None) -> dict | None:
    """Fallback: resolve the FEC candidate id via /candidates/search/."""
    parts = race_key.split("-")  # 2026-H-WI-04
    office = parts[1] if len(parts) > 1 else "H"
    state = parts[2] if len(parts) > 2 else ""
    results = _http_get("/candidates/search/", {
        "q": candidate_name, "office": office, "state": state,
        "cycle": _CYCLE, "per_page": 5,
    }, transport)
    if not results:
        return None
    top = results[0]
    return {"candidate_id": top.get("candidate_id"), "name": top.get("name")}


def _envelope(candidate: str, committee: str | None, donors: list[dict],
              cached: bool, note: str = _COVERAGE_NOTE) -> dict[str, Any]:
    return {
        "status": "success",
        "data": {
            "candidate": candidate,
            "committee": committee,
            "cycle": _CYCLE,
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "cached": cached,
            "donors": donors,
            "coverage_note": note,
        },
        "source": _SOURCE,
    }


def _empty(candidate: str, committee: str | None,
           note: str = _COVERAGE_NOTE) -> dict[str, Any]:
    return _envelope(candidate, committee, [], False, note)


def _cache_get(db: Any, key: str) -> dict | None:
    try:
        doc = db.fec_donor_cache.find_one({"key": key})
    except Exception as exc:
        logger.warning("fec_donors: cache read failed: %s", exc)
        return None
    if not doc:
        return None
    retrieved = doc.get("retrieved_at")
    if retrieved is None:
        return None
    if retrieved.tzinfo is None:
        retrieved = retrieved.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - retrieved > _CACHE_TTL:
        return None
    return doc.get("data")


def _cache_put(db: Any, key: str, data: dict[str, Any]) -> None:
    try:
        db.fec_donor_cache.update_one(
            {"key": key},
            {"$set": {"key": key, "data": data,
                      "retrieved_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
    except Exception as exc:
        logger.warning("fec_donors: cache write failed: %s", exc)


def _donors_impl(candidate_name: str, race_key: str, *,
                 db: Any | None = None,
                 transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    """Full pipeline behind get_individual_donors; db/transport injectable for tests."""
    if db is None:
        try:
            db = _get_db()
        except Exception as exc:
            logger.error("fec_donors: no database: %s", exc)
            return _empty(candidate_name, None)

    doc = _find_candidate_doc(db, race_key, candidate_name)
    if doc is None or not doc.get("candidate_id"):
        doc = _search_fec_candidate(candidate_name, race_key, transport)
    if doc is None or not doc.get("candidate_id"):
        return _empty(
            candidate_name, None,
            f"No FEC candidate record found for {candidate_name}. " + _COVERAGE_NOTE,
        )

    fec_id = doc["candidate_id"]
    resolved_name = doc.get("name") or candidate_name
    cache_key = f"donors:{race_key}:{fec_id}"

    cached_data = _cache_get(db, cache_key)
    if cached_data is not None:
        return {"status": "success", "data": {**cached_data, "cached": True},
                "source": _SOURCE}

    committees = _http_get(f"/candidate/{fec_id}/committees/",
                           {"designation": "P", "per_page": 5}, transport)
    if not committees:
        return _empty(
            resolved_name, None,
            f"No principal campaign committee on file for {resolved_name}. "
            + _COVERAGE_NOTE,
        )
    committee = committees[0]
    receipts = _http_get("/schedules/schedule_a/", {
        "committee_id": committee.get("committee_id"),
        "two_year_transaction_period": _CYCLE,
        "is_individual": "true",
        "sort": "-contribution_receipt_amount",
        "per_page": _PER_PAGE,
    }, transport)
    donors = _dedupe_receipts(receipts)
    result = _envelope(resolved_name, committee.get("name"), donors, False)
    _cache_put(db, cache_key, result["data"])
    return result


def get_individual_donors(candidate_name: str, race_key: str) -> dict[str, Any]:
    """Get a candidate's largest individual donors (itemized FEC contributions).

    Use this tool whenever the user asks about a candidate's largest individual
    donors, top contributors, biggest donations, or who funds a candidate.
    Returns the largest itemized individual contributions (over $200) for the
    2026 cycle from the live FEC API, deduplicated by donor.

    GUARDRAIL: Donor data is context only. NEVER infer, imply, or state a
    candidate's policy positions from contributions. Never characterize donors
    as evidence of a stance.

    Args:
        candidate_name: Candidate's name, e.g. 'Gwen Moore'.
        race_key: Race key from get_race_candidates, e.g. '2026-H-WI-04'.
    """
    return _donors_impl(candidate_name, race_key)
