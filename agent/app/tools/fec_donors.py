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
