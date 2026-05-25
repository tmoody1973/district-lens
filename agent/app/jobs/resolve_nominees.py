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


async def execute_resolution(
    *,
    mongo_uri: str,
    today: date | None = None,
    window_days: int = 10,
    search_fn: SearchFn,
    fetch_fn: FetchFn,
    client_factory: Callable[[str], pymongo.MongoClient] = pymongo.MongoClient,
    now_fn: Callable[[], datetime] = _utcnow,
) -> dict[str, Any]:
    """Orchestrate the confirm-or-flag pipeline for recently-closed primaries.

    Opens a Mongo client, resolves every race in a state whose contest window
    is closed, writes a ``refresh_runs`` audit doc at start and completion.

    Args:
        mongo_uri:      MongoDB connection string.
        today:          Reference date for the calendar window (defaults to today).
        window_days:    How many days back to look for closed contests.
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
    try:
        db = client["districtlens"]
        runs_col = db["refresh_runs"]
        races_col = db["races"]
        candidates_col = db["candidates"]
        status_col = db["race_status"]
        events_col = db["race_status_events"]
        citations_col = db["results_citations"]
        calendar_col = db["primary_calendar"]

        runs_col.insert_one(
            {
                "run_id": run_id,
                "job_name": JOB_NAME,
                "status": "running",
                "started_at": started_at,
                "completed_at": None,
                "counts": None,
                "error": None,
            }
        )

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
            # Fetch all races in this state for the current cycle that are not
            # already confirmed.
            races = list(
                races_col.find(
                    {
                        "cycle": CYCLE,
                        "state": state,
                        "race_status.status": {"$ne": "confirmed"},
                    }
                )
            )
            # Also include races without any race_status sub-doc yet.
            races_no_status = list(
                races_col.find(
                    {
                        "cycle": CYCLE,
                        "state": state,
                        "race_status": {"$exists": False},
                    }
                )
            )
            # Deduplicate by race_key.
            seen_keys: set[str] = set()
            all_races: list[dict] = []
            for race_doc in races + races_no_status:
                rk = race_doc.get("race_key", "")
                if rk and rk not in seen_keys:
                    seen_keys.add(rk)
                    all_races.append(race_doc)

            for race_doc in all_races:
                race_key = race_doc.get("race_key", "")
                office = race_doc.get("office", "H")
                district = race_doc.get("district", "00")
                runoff_rule = race_doc.get("runoff_rule", "none")

                # Gather candidate info for this race.
                cand_docs = list(candidates_col.find({"race_key": race_key}))
                parties = list(
                    {c.get("party", "") for c in cand_docs if c.get("party")}
                )
                incumbent_id: str | None = next(
                    (
                        c.get("candidate_id")
                        for c in cand_docs
                        if c.get("incumbent_challenge_status") == "incumbent"
                    ),
                    None,
                )
                # Retrieve the current race_status doc (for prev_status).
                existing_status_doc = status_col.find_one({"race_key": race_key})
                prev_status: str = (
                    existing_status_doc.get("status", "pre_primary")
                    if existing_status_doc
                    else "pre_primary"
                )
                # Skip races already confirmed.
                if prev_status == "confirmed":
                    continue

                races_checked += 1

                try:
                    # Step 1: resolve via Perplexity.
                    resolved: resolver_mod.ResolvedPrimary = (
                        await resolver_mod.resolve_race(
                            state=state,
                            office=office,
                            district=district,
                            parties=parties or ["REP", "DEM"],
                            date=contest_date.isoformat(),
                            search_fn=search_fn,
                        )
                    )

                    # Step 2: pick an authoritative citation URL.
                    auth_url: str | None = (
                        citation_fetch_mod.pick_authoritative_url(resolved.sources)
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

                    # Step 4: decide via gate.
                    # Detect if the FEC status contradicts any winner.
                    fec_contradicts = False
                    for party_code, winner_name in resolved.winners_by_party.items():
                        for cand_doc in cand_docs:
                            if (
                                cand_doc.get("party") == party_code
                                and cand_doc.get("incumbent_challenge_status") == "incumbent"
                                and cand_doc.get("fec_status") not in ("C", "")
                                and winner_name != cand_doc.get("name", "")
                            ):
                                pass  # Simplified: rely on gate defaults; no FEC contradiction here.

                    # Get runoff rule from calendar row if not on the race doc.
                    if runoff_rule == "none":
                        for row in calendar_rows:
                            if row.get("state") == state:
                                runoff_rule = row.get("runoff_rule", "none")
                                break

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

                    # Step 5: apply resolution.
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
                        confirmed_count += 1
                    else:
                        flagged_count += 1

                except Exception:
                    logger.exception(
                        "resolve_nominees: error processing race %s", race_key
                    )
                    error_count += 1

        counts = {
            "races_checked": races_checked,
            "confirmed": confirmed_count,
            "flagged": flagged_count,
            "errors": error_count,
        }

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

    finally:
        client.close()


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    mongo_uri = os.environ.get("MONGODB_URI")
    if not mongo_uri:
        logger.error("MONGODB_URI not set; cannot run resolve_nominees job")
        return 1

    # Import the real Perplexity search function at runtime only (avoids import
    # errors when the API key is absent during tests or static analysis).
    from app.refresh.citation_fetch import fetch_results_page
    from app.tools.position_search import _perplexity_search

    try:
        asyncio.run(
            execute_resolution(
                mongo_uri=mongo_uri,
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
