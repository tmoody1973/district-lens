"""refresh_positions — scheduled Cloud Run Job that precomputes candidate
positions into the ``candidate_positions`` cache (position-search redesign T3).

Mirrors ``app/jobs/refresh_fec.py`` / ``resolve_nominees.py``: a dependency-
injected ``execute_refresh_positions`` + ``main()`` + ``__main__`` guard, with a
``refresh_runs`` audit doc (running → completed/failed).

What it does each run:
1. Select the **priority set** — incumbents + confirmed-race nominees +
   top-funded candidates (deduped).
2. Read the current month's Firecrawl spend (``source_documents`` retrieval
   history) and pick a tier per candidate: ``deep`` normally, ``shallow`` once
   spend crosses ``downgrade_pct`` of the monthly cap — the budget guard never
   fails the run, it just stops scraping.
3. Research each candidate and write the result through ``upsert_positions``.

Every external dependency (research, upsert, usage, selection, Mongo client,
clock) is injected so the unit tests run network-free.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import pymongo

from app.services.positions.research import research_candidate_positions
from app.services.positions.schema import STATUS_FOUND
from app.services.positions.store import upsert_positions
from app.tools.position_search import _search_name

logger = logging.getLogger(__name__)

JOB_NAME = "refresh_positions"
DEFAULT_MONTHLY_CAP = 5000  # $20/mo Firecrawl plan = 5,000 credits
DEFAULT_DOWNGRADE_PCT = 0.8  # deep→shallow once spend crosses 80% of the cap
TOP_FUNDED_LIMIT = 50
_INCUMBENT = "incumbent"
_CONFIRMED = "confirmed"


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _month_start(now: datetime) -> datetime:
    return datetime(now.year, now.month, 1, tzinfo=UTC)


# ---------------------------------------------------------------------------
# Priority-set selection
# ---------------------------------------------------------------------------


_RESEARCH_FIELDS = (
    "candidate_id",
    "name",
    "party",
    "race_key",
    "incumbent_challenge_status",
)


def _norm_name(name: str) -> str:
    """Normalize a name to natural-order, lowercased, for cross-source matching."""
    return " ".join(_search_name(name).lower().split())


def _research_view(candidate: dict[str, Any]) -> dict[str, Any]:
    return {field: candidate.get(field) for field in _RESEARCH_FIELDS}


def _confirmed_nominee_ids(db: Any) -> set[str]:
    """Candidate ids who are a *winner* of a confirmed race (matched by name)."""
    nominee_ids: set[str] = set()
    for status_doc in db["race_status"].find({"status": _CONFIRMED}):
        race_key = status_doc.get("race_key", "")
        winner_names = {
            _norm_name(name) for name in (status_doc.get("winners") or {}).values()
        }
        if not winner_names:
            continue
        for cand in db["candidates"].find({"race_key": race_key}):
            if _norm_name(cand.get("name", "")) in winner_names:
                nominee_ids.add(cand["candidate_id"])
    return nominee_ids


def _top_funded_ids(db: Any, limit: int) -> set[str]:
    finances = list(db["finance_summaries"].find({}))
    finances.sort(key=lambda f: f.get("receipts") or 0, reverse=True)
    return {f["candidate_id"] for f in finances[:limit] if f.get("candidate_id")}


def select_priority_candidates(
    db: Any, *, top_funded_limit: int = TOP_FUNDED_LIMIT
) -> list[dict[str, Any]]:
    """Build the deduped priority set: incumbents + confirmed nominees + top-funded.

    Returns candidate dicts trimmed to the fields ``research_candidate_positions``
    needs. A candidate appearing in several buckets is returned once.
    """
    wanted_ids = _confirmed_nominee_ids(db) | _top_funded_ids(db, top_funded_limit)

    selected: dict[str, dict[str, Any]] = {}
    for cand in db["candidates"].find({"incumbent_challenge_status": _INCUMBENT}):
        selected[cand["candidate_id"]] = _research_view(cand)

    missing = [cid for cid in wanted_ids if cid not in selected]
    if missing:
        for cand in db["candidates"].find({"candidate_id": {"$in": missing}}):
            selected[cand["candidate_id"]] = _research_view(cand)
    return list(selected.values())


# ---------------------------------------------------------------------------
# Firecrawl budget guard
# ---------------------------------------------------------------------------


def count_monthly_fetches(db: Any, *, now: datetime) -> int:
    """Count Firecrawl scrapes this calendar month via ``source_documents``.

    Each real scrape appends a ``retrieval_history`` entry stamped ``fetched_at``;
    freshness short-circuits append nothing. So the count of this-month entries is
    the credits spent this month.
    """
    month_start = _month_start(now)
    spent = 0
    for doc in db["source_documents"].find({}, {"retrieval_history": 1}):
        for record in doc.get("retrieval_history", []):
            fetched_at = record.get("fetched_at")
            if isinstance(fetched_at, datetime):
                if fetched_at.tzinfo is None:
                    fetched_at = fetched_at.replace(tzinfo=UTC)
                if fetched_at >= month_start:
                    spent += 1
    return spent


def _choose_tier(usage: int, *, monthly_cap: int, downgrade_pct: float) -> str:
    """``deep`` while under budget; ``shallow`` (no scrape) once at the threshold."""
    return "shallow" if usage >= monthly_cap * downgrade_pct else "deep"


def _doc_scrape_count(doc: dict[str, Any]) -> int:
    """Distinct archived sources in a research doc — a conservative credit delta."""
    ids = {
        source.get("sourceDocumentId")
        for position in doc.get("positions", [])
        for source in position.get("sources", [])
        if source.get("sourceDocumentId")
    }
    return len(ids)


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


async def _run_positions_batch(
    *,
    db: Any,
    research_fn: Callable[..., Any],
    upsert_fn: Callable[..., Any],
    usage_fn: Callable[..., int],
    select_fn: Callable[..., list[dict[str, Any]]],
    now_fn: Callable[[], datetime],
    monthly_cap: int,
    downgrade_pct: float,
    per_run_limit: int,
) -> dict[str, int]:
    candidates = select_fn(db, top_funded_limit=TOP_FUNDED_LIMIT)
    if per_run_limit and per_run_limit > 0:
        candidates = candidates[:per_run_limit]

    usage = usage_fn(db, now=now_fn())
    counts = {
        "candidates": 0,
        "found": 0,
        "no_positions": 0,
        "deep": 0,
        "shallow": 0,
        "errors": 0,
    }

    for candidate in candidates:
        counts["candidates"] += 1
        tier = _choose_tier(usage, monthly_cap=monthly_cap, downgrade_pct=downgrade_pct)
        try:
            doc = await research_fn(candidate, tier=tier)
            await upsert_fn(doc, db=db)
        except Exception as exc:  # one candidate must never abort the run
            logger.warning(
                "refresh_positions: candidate %s failed: %s",
                candidate.get("candidate_id", "?"),
                exc,
            )
            counts["errors"] += 1
            continue

        if tier == "deep":
            counts["deep"] += 1
            usage += _doc_scrape_count(doc)
        else:
            counts["shallow"] += 1

        if doc.get("status") == STATUS_FOUND:
            counts["found"] += 1
        else:
            counts["no_positions"] += 1

    return counts


async def execute_refresh_positions(
    *,
    mongo_uri: str,
    trigger: str = "scheduled",
    research_fn: Callable[..., Any] = research_candidate_positions,
    upsert_fn: Callable[..., Any] = upsert_positions,
    usage_fn: Callable[..., int] = count_monthly_fetches,
    select_fn: Callable[..., list[dict[str, Any]]] = select_priority_candidates,
    client_factory: Callable[[str], Any] = pymongo.MongoClient,
    now_fn: Callable[[], datetime] = _utcnow,
    monthly_cap: int = DEFAULT_MONTHLY_CAP,
    downgrade_pct: float = DEFAULT_DOWNGRADE_PCT,
    per_run_limit: int = 0,
) -> dict[str, Any]:
    """Run the priority-set refresh and record a ``refresh_runs`` audit doc."""
    run_id = uuid.uuid4().hex
    started_at = now_fn()
    client = client_factory(mongo_uri)
    runs_col = None
    try:
        db = client["districtlens"]
        runs_col = db["refresh_runs"]
        runs_col.insert_one(
            {
                "run_id": run_id,
                "job_name": JOB_NAME,
                "trigger": trigger,
                "status": "running",
                "started_at": started_at,
                "completed_at": None,
                "counts": None,
                "error": None,
            }
        )

        counts = await _run_positions_batch(
            db=db,
            research_fn=research_fn,
            upsert_fn=upsert_fn,
            usage_fn=usage_fn,
            select_fn=select_fn,
            now_fn=now_fn,
            monthly_cap=monthly_cap,
            downgrade_pct=downgrade_pct,
            per_run_limit=per_run_limit,
        )

        runs_col.update_one(
            {"run_id": run_id},
            {"$set": {"status": "completed", "completed_at": now_fn(), "counts": counts}},
        )
        logger.info("refresh_positions run %s completed: %s", run_id, counts)
        return {"run_id": run_id, "status": "completed", "counts": counts}

    except Exception as exc:
        if runs_col is not None:
            runs_col.update_one(
                {"run_id": run_id},
                {"$set": {"status": "failed", "completed_at": now_fn(), "error": str(exc)}},
            )
        logger.exception("refresh_positions run %s failed", run_id)
        raise
    finally:
        client.close()


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )
    mongo_uri = os.environ.get("MONGODB_URI")
    if not mongo_uri:
        logger.error("MONGODB_URI not set; cannot run refresh_positions job")
        return 1

    trigger = os.environ.get("REFRESH_TRIGGER", "scheduled")
    monthly_cap = int(os.environ.get("FIRECRAWL_MONTHLY_CAP", DEFAULT_MONTHLY_CAP))
    downgrade_pct = float(os.environ.get("FIRECRAWL_DOWNGRADE_PCT", DEFAULT_DOWNGRADE_PCT))
    per_run_limit = int(os.environ.get("POSITIONS_REFRESH_LIMIT", "0"))

    try:
        asyncio.run(
            execute_refresh_positions(
                mongo_uri=mongo_uri,
                trigger=trigger,
                monthly_cap=monthly_cap,
                downgrade_pct=downgrade_pct,
                per_run_limit=per_run_limit,
            )
        )
    except Exception:
        logger.exception("refresh_positions job failed")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
