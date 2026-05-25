"""Cloud Run Job entrypoint: confirm or flag nominees for recently-closed primaries.

Orchestrates the full confirm-or-flag pipeline (Tasks 1-5) for every congressional
race in a state whose primary or runoff closed within the last ``window_days``.

Writes a ``refresh_runs`` audit record (same shape as ``refresh_fec``) so
Cloud Scheduler executions are uniformly observable.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime
from typing import Any

import pymongo

import app.refresh.calendar as calendar_mod
import app.refresh.citation_fetch as citation_fetch_mod
import app.refresh.gate as gate_mod
import app.refresh.nominee_resolver as resolver_mod
from app.refresh.race_status_store import RaceStatusStore

logger = logging.getLogger(__name__)

JOB_NAME = "resolve_nominees"
CYCLE = "2026"

# Per-race outcome tags returned by _resolve_one_race.
_OUTCOME_CONFIRMED = "confirmed"
_OUTCOME_FLAGGED = "flagged"
_OUTCOME_ERROR = "error"

_DEFAULT_PARTIES = ("REP", "DEM")
_PRE_PRIMARY_STATUS = "pre_primary"

SearchFn = Callable[[str], Awaitable[tuple[str, list[dict]]]]
FetchFn = Callable[[str], Awaitable[tuple[str, str] | None]]


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _today() -> date:
    return date.today()


def _build_race_key(cycle: str, office: str, state: str, district: str) -> str:
    """Mirror the FEC ingest race_key format: {cycle}-{office}-{state}-{district:02d}."""
    try:
        district_int = int(district) if district.strip() else 0
    except (ValueError, AttributeError):
        district_int = 0
    return f"{cycle}-{office.upper()}-{state.upper()}-{district_int:02d}"


def _runoff_rule_for(
    race_doc: dict, *, state: str, calendar_rows: list[dict]
) -> str:
    """Resolve the runoff rule from the race doc, falling back to the calendar row."""
    rule = race_doc.get("runoff_rule", "none")
    if rule != "none":
        return rule
    for row in calendar_rows:
        if row.get("state") == state:
            return row.get("runoff_rule", "none")
    return "none"


async def _resolve_one_race(
    race_doc: dict,
    *,
    state: str,
    contest_date: date,
    calendar_rows: list[dict],
    cand_docs: list[dict],
    prev_status: str,
    store: RaceStatusStore,
    search_fn: SearchFn,
    fetch_fn: FetchFn,
) -> str:
    """Run the confirm-or-flag pipeline for a single race.

    Steps: (1) resolve via Perplexity, (2) pick an authoritative URL,
    (3) fetch + store a citation, (4) decide via the gate, (5) persist the
    resolution and append a transition event.

    Returns one of ``_OUTCOME_CONFIRMED``, ``_OUTCOME_FLAGGED``, or
    ``_OUTCOME_ERROR``.  A single race's failure never aborts the batch:
    all exceptions are caught here and reported as an error outcome.
    """
    race_key = race_doc.get("race_key", "")
    office = race_doc.get("office", "H")
    district = race_doc.get("district", "00")

    parties = list({c.get("party", "") for c in cand_docs if c.get("party")})
    incumbent_id: str | None = next(
        (
            c.get("candidate_id")
            for c in cand_docs
            if c.get("incumbent_challenge_status") == "incumbent"
        ),
        None,
    )

    try:
        # Step 1: resolve via Perplexity.
        resolved: resolver_mod.ResolvedPrimary = await resolver_mod.resolve_race(
            state=state,
            office=office,
            district=district,
            parties=parties or list(_DEFAULT_PARTIES),
            date=contest_date.isoformat(),
            search_fn=search_fn,
        )

        # Step 2: pick an authoritative citation URL.
        auth_url: str | None = citation_fetch_mod.pick_authoritative_url(
            resolved.sources
        )

        # Step 3: fetch the results page if we have an authoritative URL.
        citation_id: Any | None = None
        if auth_url:
            fetched = await fetch_fn(auth_url)
            if fetched is not None:
                content, publisher = fetched
                citation_id = store.store_citation(
                    race_key=race_key,
                    url=auth_url,
                    publisher=publisher,
                    snippet=content[:300],
                    content=content,
                )

        # Step 4: decide via the gate.
        fec_contradicts = False  # TODO(P2): compare FEC active-candidate status vs resolved winners
        runoff_rule = _runoff_rule_for(
            race_doc, state=state, calendar_rows=calendar_rows
        )
        decision: gate_mod.GateDecision = gate_mod.decide(
            winners_by_party=resolved.winners_by_party,
            confidence=resolved.confidence,
            runoff_indicated=resolved.runoff_indicated,
            citation_id=citation_id,
            runoff_rule=runoff_rule,
            incumbent_id=incumbent_id,
            sources_disagree=False,
            fec_contradicts=fec_contradicts,
        )

        # Step 5: persist the resolution + transition event.
        store.apply_resolution(
            race_key=race_key,
            to_status=decision.to_status,
            winners=decision.winners,
            citation_id=citation_id,
            reason=decision.reason,
            presentation_class=decision.presentation_class,
            prev_status=prev_status,
            confidence=decision.confidence,
            confirmation_basis=decision.confirmation_basis,
        )

        if decision.to_status == "confirmed":
            return _OUTCOME_CONFIRMED
        return _OUTCOME_FLAGGED

    except Exception:
        logger.exception("resolve_nominees: error processing race %s", race_key)
        return _OUTCOME_ERROR


async def execute_resolution(
    *,
    mongo_uri: str,
    today: date | None = None,
    window_days: int = 10,
    trigger: str = "scheduled",
    search_fn: SearchFn,
    fetch_fn: FetchFn,
    client_factory: Callable[[str], pymongo.MongoClient] = pymongo.MongoClient,
    now_fn: Callable[[], datetime] = _utcnow,
) -> dict[str, Any]:
    """Orchestrate the confirm-or-flag pipeline for recently-closed primaries.

    Opens a Mongo client, resolves every race in a state whose contest window
    is closed, and writes a ``refresh_runs`` audit doc at start and completion.
    On any unexpected failure the audit doc is marked ``failed`` and the
    exception re-raised, so the process exits non-zero and Cloud Run marks the
    execution failed.

    Args:
        mongo_uri:      MongoDB connection string.
        today:          Reference date for the calendar window (defaults to today).
        window_days:    How many days back to look for closed contests.
        trigger:        Audit label for what invoked the run (e.g. "scheduled").
        search_fn:      Async callable returning ``(answer, sources)`` for a prompt.
        fetch_fn:       Async callable returning ``(content, publisher)`` or ``None``.
        client_factory: Creates a ``pymongo.MongoClient``; injectable for tests.
        now_fn:         Returns the current UTC datetime; injectable for tests.

    Returns:
        A dict with ``run_id``, ``status``, and ``counts``.
    """
    resolved_today = today or _today()
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

        counts = await _run_resolution_batch(
            db=db,
            resolved_today=resolved_today,
            window_days=window_days,
            search_fn=search_fn,
            fetch_fn=fetch_fn,
        )

        runs_col.update_one(
            {"run_id": run_id},
            {
                "$set": {
                    "status": "completed",
                    "completed_at": now_fn(),
                    "counts": counts,
                }
            },
        )
        logger.info("resolve_nominees run %s completed: %s", run_id, counts)
        return {"run_id": run_id, "status": "completed", "counts": counts}

    except Exception as exc:
        if runs_col is not None:
            runs_col.update_one(
                {"run_id": run_id},
                {
                    "$set": {
                        "status": "failed",
                        "completed_at": now_fn(),
                        "error": str(exc),
                    }
                },
            )
        logger.exception("resolve_nominees run %s failed", run_id)
        raise
    finally:
        client.close()


async def _run_resolution_batch(
    *,
    db: Any,
    resolved_today: date,
    window_days: int,
    search_fn: SearchFn,
    fetch_fn: FetchFn,
) -> dict[str, int]:
    """Resolve every in-window race and return the tally of outcomes.

    Loads the primary calendar, narrows to closed contests, and dispatches each
    race to ``_resolve_one_race``.  This is the orchestration loop only — the
    per-race pipeline lives in ``_resolve_one_race``.
    """
    races_col = db["races"]
    candidates_col = db["candidates"]
    status_col = db["race_status"]
    events_col = db["race_status_events"]
    citations_col = db["results_citations"]
    calendar_col = db["primary_calendar"]

    store = RaceStatusStore(
        status_col=status_col,
        events_col=events_col,
        citations_col=citations_col,
    )

    # Load the primary calendar and narrow to closed contests in the window.
    calendar_rows = list(calendar_col.find({}))
    if not calendar_rows:
        # Fall back to the hardcoded FVAP 2026 table when the collection is empty.
        calendar_rows = calendar_mod.FVAP_2026_ROWS

    closed_contests: list[tuple[str, str, date]] = (
        calendar_mod.states_with_closed_contest(
            calendar_rows,
            today=resolved_today,
            window_days=window_days,
        )
    )

    races_checked = 0
    confirmed_count = 0
    flagged_count = 0
    error_count = 0

    for state, _kind, contest_date in closed_contests:
        # All races in this state for the cycle. The "already confirmed" filter
        # is applied per-race via the race_status collection below (race_status
        # is a separate collection keyed by race_key, not an embedded field).
        races = list(races_col.find({"cycle": CYCLE, "state": state}))

        for race_doc in races:
            race_key = race_doc.get("race_key", "")
            existing_status_doc = status_col.find_one({"race_key": race_key})
            prev_status: str = (
                existing_status_doc.get("status", _PRE_PRIMARY_STATUS)
                if existing_status_doc
                else _PRE_PRIMARY_STATUS
            )
            if prev_status == "confirmed":
                continue

            races_checked += 1
            cand_docs = list(candidates_col.find({"race_key": race_key}))

            outcome = await _resolve_one_race(
                race_doc,
                state=state,
                contest_date=contest_date,
                calendar_rows=calendar_rows,
                cand_docs=cand_docs,
                prev_status=prev_status,
                store=store,
                search_fn=search_fn,
                fetch_fn=fetch_fn,
            )
            if outcome == _OUTCOME_CONFIRMED:
                confirmed_count += 1
            elif outcome == _OUTCOME_FLAGGED:
                flagged_count += 1
            else:
                error_count += 1

    return {
        "races_checked": races_checked,
        "confirmed": confirmed_count,
        "flagged": flagged_count,
        "errors": error_count,
    }


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    mongo_uri = os.environ.get("MONGODB_URI")
    if not mongo_uri:
        logger.error("MONGODB_URI not set; cannot run resolve_nominees job")
        return 1
    if not os.environ.get("PERPLEXITY_API_KEY"):
        logger.error("PERPLEXITY_API_KEY not set; cannot run resolve_nominees job")
        return 1
    trigger = os.environ.get("REFRESH_TRIGGER", "scheduled")

    # Import the real Perplexity search function at runtime only (avoids import
    # errors when the API key is absent during tests or static analysis).
    from app.refresh.citation_fetch import fetch_results_page
    from app.tools.position_search import _perplexity_search

    try:
        asyncio.run(
            execute_resolution(
                mongo_uri=mongo_uri,
                trigger=trigger,
                search_fn=_perplexity_search,
                fetch_fn=fetch_results_page,
            )
        )
    except Exception:
        logger.exception("resolve_nominees job failed")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
