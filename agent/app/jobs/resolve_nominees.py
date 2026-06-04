"""Cloud Run Job entrypoint: confirm or flag nominees for recently-closed primaries.

Orchestrates the full confirm-or-flag pipeline (Tasks 1-5) for every congressional
race in a state whose primary or runoff closed within the last ``window_days``.

Writes a ``refresh_runs`` audit record (same shape as ``refresh_fec``) so
Cloud Scheduler executions are uniformly observable.
"""

from __future__ import annotations

import asyncio
import json
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
import app.refresh.nbc_results as nbc_mod
import app.refresh.nominee_resolver as resolver_mod
from app.refresh.race_status_store import RaceStatusStore
from app.services.positions.research import research_candidate_positions
from app.services.positions.store import upsert_positions
from app.tools.position_search import _search_name

logger = logging.getLogger(__name__)

JOB_NAME = "resolve_nominees"
CYCLE = "2026"

# Per-race outcome tags returned by _resolve_one_race.
_OUTCOME_CONFIRMED = "confirmed"
_OUTCOME_FLAGGED = "flagged"
_OUTCOME_ERROR = "error"

_DEFAULT_PARTIES = ("REP", "DEM")
_PRE_PRIMARY_STATUS = "pre_primary"

# T6: when a nominee is confirmed post-primary, deep-research their positions
# inline (this job runs daily). Bounded per run so a busy primary day can't
# balloon Firecrawl/Gemini spend; the per-candidate research is itself graceful.
_DEFAULT_RERESEARCH_CAP = 25
_RERESEARCH_FIELDS = (
    "candidate_id",
    "name",
    "party",
    "race_key",
    "incumbent_challenge_status",
)

# NBC Decision Desk is the primary, structured (no-LLM) confirm source.
_NBC_CONFIDENCE = 0.95
_NBC_PUBLISHER = "nbcnews.com"
_NBC_CONFIRMATION_BASIS = ["nbc_decision_desk", "results_page"]

SearchFn = Callable[[str], Awaitable[tuple[str, list[dict]]]]
FetchFn = Callable[[str], Awaitable[tuple[str, str] | None]]
NbcFetchFn = Callable[[str], Awaitable[list[nbc_mod.NbcRaceResult] | None]]
StructureFn = resolver_mod.StructureFn


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


def _nbc_snippet(decision: nbc_mod.NbcSeatDecision) -> str:
    """Short human-readable summary of the NBC winners (stored on the citation)."""
    pairs = ", ".join(f"{party} {name}" for party, name in decision.winners_by_party.items())
    return f"NBC Decision Desk: {pairs}"


def _nbc_content(races: list[nbc_mod.NbcRaceResult]) -> str:
    """Serialize the NBC race payload for caching (hashed + timestamped by the store)."""
    return json.dumps(
        [
            {
                "race_id": r.race_id,
                "percent_in": r.percent_in,
                "call_status": r.call_status,
                "is_runoff": r.is_runoff,
                "candidates": [
                    {
                        "name": c.full_name,
                        "party": c.party,
                        "percent_vote": c.percent_vote,
                        "is_winner": c.is_winner,
                    }
                    for c in r.candidates
                ],
            }
            for r in races
        ],
        default=str,
    )


async def _try_nbc_confirm(
    *,
    race_key: str,
    state: str,
    office: str,
    district: str,
    incumbent_id: str | None,
    runoff_rule: str,
    prev_status: str,
    store: RaceStatusStore,
    nbc_fetch_fn: NbcFetchFn,
) -> str | None:
    """Try to resolve a seat from NBC's structured results (the primary path).

    Returns an outcome tag when NBC settles the seat (confirmed or runoff), or
    None when NBC has no usable result so the caller falls back to Perplexity.
    The winner name is a structured ``isWinner`` field — never LLM prose — so
    this path cannot fabricate a winner.
    """
    slug = nbc_mod.build_page_slug(state=state, office=office, district=district)
    races = await nbc_fetch_fn(slug)
    if not races:
        return None

    # Persist NBC's full ballot roster (not just the winner) — ground-truth
    # candidates for this covered race, available to reconcile the FEC roster.
    store.store_nbc_roster(
        race_key=race_key,
        slug=slug,
        source_url=nbc_mod.results_url(slug),
        candidates=[
            {
                "name": candidate.full_name,
                "party": candidate.party,
                "percent_vote": candidate.percent_vote,
                "is_winner": candidate.is_winner,
            }
            for race in races
            for candidate in race.candidates
        ],
    )

    decision = nbc_mod.decide_seat(races)
    if decision.status == nbc_mod.NBC_INSUFFICIENT:
        return None  # not enough to confirm — fall back to Perplexity signal

    if decision.is_runoff:
        # Store the NBC payload as evidence for the runoff signal too (data-integrity
        # rule: cache external responses with a timestamp), even though runoff_pending
        # does not require a citation.
        runoff_citation_id = store.store_citation(
            race_key=race_key,
            url=nbc_mod.results_url(slug),
            publisher=_NBC_PUBLISHER,
            snippet=_nbc_snippet(decision),
            content=_nbc_content(races),
        )
        gate_decision = gate_mod.decide(
            winners_by_party=decision.winners_by_party,
            confidence=_NBC_CONFIDENCE,
            runoff_indicated=True,
            citation_id=runoff_citation_id,
            runoff_rule=runoff_rule,
            incumbent_id=incumbent_id,
            sources_disagree=False,
            fec_contradicts=False,
        )
        store.apply_resolution(
            race_key=race_key,
            to_status=gate_decision.to_status,
            winners=gate_decision.winners,
            citation_id=runoff_citation_id,
            reason="nbc_runoff",
            presentation_class=gate_decision.presentation_class,
            prev_status=prev_status,
            confidence=gate_decision.confidence,
            confirmation_basis=[],
        )
        return _OUTCOME_FLAGGED

    # Confirmable: store the NBC results citation, then run the confirm gate
    # (keeps the gate's citation_id-required invariant as the single chokepoint).
    citation_id = store.store_citation(
        race_key=race_key,
        url=nbc_mod.results_url(slug),
        publisher=_NBC_PUBLISHER,
        snippet=_nbc_snippet(decision),
        content=_nbc_content(races),
    )
    gate_decision = gate_mod.decide(
        winners_by_party=decision.winners_by_party,
        confidence=_NBC_CONFIDENCE,
        runoff_indicated=False,
        citation_id=citation_id,
        runoff_rule=runoff_rule,
        incumbent_id=incumbent_id,
        sources_disagree=False,
        fec_contradicts=False,
    )
    store.apply_resolution(
        race_key=race_key,
        to_status=gate_decision.to_status,
        winners=gate_decision.winners,
        citation_id=citation_id,
        reason="nbc_called",
        presentation_class=gate_decision.presentation_class,
        prev_status=prev_status,
        confidence=gate_decision.confidence,
        confirmation_basis=_NBC_CONFIRMATION_BASIS,
    )
    return (
        _OUTCOME_CONFIRMED
        if gate_decision.to_status == "confirmed"
        else _OUTCOME_FLAGGED
    )


async def _resolve_via_perplexity(
    *,
    race_key: str,
    state: str,
    office: str,
    district: str,
    parties: list[str],
    contest_date: date,
    incumbent_id: str | None,
    runoff_rule: str,
    prev_status: str,
    store: RaceStatusStore,
    search_fn: SearchFn,
    fetch_fn: FetchFn,
    structure_fn: StructureFn,
) -> str:
    """Fallback path when NBC has no usable result.

    CIVIC SAFETY: Perplexity/news prose can confidently report a WRONG winner
    (verified: an answer fabricated a winner and cited YouTube). So this path is
    a *projected, unofficial* signal only — any gate "confirmed" is demoted to
    provisional. It never auto-confirms.
    """
    resolved: resolver_mod.ResolvedPrimary = await resolver_mod.resolve_race(
        state=state,
        office=office,
        district=district,
        parties=parties,
        date=contest_date.isoformat(),
        search_fn=search_fn,
        structure_fn=structure_fn,
    )

    auth_url = citation_fetch_mod.pick_authoritative_url(resolved.sources)
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

    decision = gate_mod.decide(
        winners_by_party=resolved.winners_by_party,
        confidence=resolved.confidence,
        runoff_indicated=resolved.runoff_indicated,
        citation_id=citation_id,
        runoff_rule=runoff_rule,
        incumbent_id=incumbent_id,
        sources_disagree=False,
        fec_contradicts=False,  # TODO(P2): compare FEC active-candidate status
    )

    to_status = decision.to_status
    reason = decision.reason
    presentation = decision.presentation_class
    basis = decision.confirmation_basis
    if to_status == "confirmed":
        to_status = "provisional"
        reason = "projected_unofficial_perplexity"
        presentation = "newsworthy_signal"
        basis = []

    store.apply_resolution(
        race_key=race_key,
        to_status=to_status,
        winners=decision.winners,
        citation_id=citation_id,
        reason=reason,
        presentation_class=presentation,
        prev_status=prev_status,
        confidence=decision.confidence,
        confirmation_basis=basis,
    )
    return _OUTCOME_CONFIRMED if to_status == "confirmed" else _OUTCOME_FLAGGED


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
    nbc_fetch_fn: NbcFetchFn | None = None,
    structure_fn: StructureFn = resolver_mod._heuristic_structure,
) -> str:
    """Confirm-or-flag a single seat.

    NBC structured results are the PRIMARY confirm source; Perplexity is a
    projected-signal-only fallback. Returns ``_OUTCOME_CONFIRMED``,
    ``_OUTCOME_FLAGGED``, or ``_OUTCOME_ERROR``. A single race's failure never
    aborts the batch — all exceptions are caught and reported as an error.
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
    runoff_rule = _runoff_rule_for(race_doc, state=state, calendar_rows=calendar_rows)

    try:
        if nbc_fetch_fn is not None:
            nbc_outcome = await _try_nbc_confirm(
                race_key=race_key,
                state=state,
                office=office,
                district=district,
                incumbent_id=incumbent_id,
                runoff_rule=runoff_rule,
                prev_status=prev_status,
                store=store,
                nbc_fetch_fn=nbc_fetch_fn,
            )
            if nbc_outcome is not None:
                return nbc_outcome

        return await _resolve_via_perplexity(
            race_key=race_key,
            state=state,
            office=office,
            district=district,
            parties=parties or list(_DEFAULT_PARTIES),
            contest_date=contest_date,
            incumbent_id=incumbent_id,
            runoff_rule=runoff_rule,
            prev_status=prev_status,
            store=store,
            search_fn=search_fn,
            fetch_fn=fetch_fn,
            structure_fn=structure_fn,
        )
    except Exception:
        logger.exception("resolve_nominees: error processing race %s", race_key)
        return _OUTCOME_ERROR


async def execute_resolution(
    *,
    mongo_uri: str,
    today: date | None = None,
    window_days: int = 10,  # accepted for compatibility; re-check now spans the full cycle
    trigger: str = "scheduled",
    search_fn: SearchFn,
    fetch_fn: FetchFn,
    nbc_fetch_fn: NbcFetchFn | None = None,
    structure_fn: StructureFn = resolver_mod._heuristic_structure,
    client_factory: Callable[[str], pymongo.MongoClient] = pymongo.MongoClient,
    now_fn: Callable[[], datetime] = _utcnow,
    research_fn: Callable[..., Any] = research_candidate_positions,
    upsert_fn: Callable[..., Any] = upsert_positions,
    reresearch_cap: int = _DEFAULT_RERESEARCH_CAP,
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
            search_fn=search_fn,
            fetch_fn=fetch_fn,
            nbc_fetch_fn=nbc_fetch_fn,
            structure_fn=structure_fn,
            research_fn=research_fn,
            upsert_fn=upsert_fn,
            reresearch_cap=reresearch_cap,
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


def _norm_name(name: str) -> str:
    """Natural-order, lowercased name for cross-source winner↔candidate matching."""
    return " ".join(_search_name(name).lower().split())


def _winner_candidates(status_doc: dict, cand_docs: list[dict]) -> list[dict]:
    """Match a confirmed race's winner names to its candidate docs (research views).

    ``race_status.winners`` is ``{party: name}``; candidate names are FEC form.
    Normalize both and return the matched candidates trimmed to the research input
    fields. Losers in the race are excluded.
    """
    winner_names = {_norm_name(n) for n in (status_doc.get("winners") or {}).values()}
    return [
        {field: cand.get(field) for field in _RERESEARCH_FIELDS}
        for cand in cand_docs
        if _norm_name(cand.get("name", "")) in winner_names
    ]


async def _reresearch_confirmed_winners(
    winners: list[dict],
    *,
    db: Any,
    research_fn: Callable[..., Any],
    upsert_fn: Callable[..., Any],
    cap: int,
) -> int:
    """Deep-research each newly-confirmed nominee and write it through to the cache.

    Deduped by candidate_id and bounded by ``cap``. Every candidate is guarded: a
    re-research failure is logged and skipped, never aborting the resolve run.
    """
    seen: set = set()
    unique: list[dict] = []
    for cand in winners:
        candidate_id = cand.get("candidate_id")
        if candidate_id and candidate_id not in seen:
            seen.add(candidate_id)
            unique.append(cand)

    count = 0
    for cand in unique[:cap]:
        try:
            doc = await research_fn(cand, tier="deep")
            await upsert_fn(doc, db=db)
            count += 1
        except Exception as exc:  # a re-research failure must not abort the run
            logger.warning(
                "resolve_nominees positions re-research failed for %s: %s",
                cand.get("candidate_id", "?"),
                exc,
            )
    return count


async def _run_resolution_batch(
    *,
    db: Any,
    resolved_today: date,
    search_fn: SearchFn,
    fetch_fn: FetchFn,
    nbc_fetch_fn: NbcFetchFn | None = None,
    structure_fn: StructureFn = resolver_mod._heuristic_structure,
    research_fn: Callable[..., Any] = research_candidate_positions,
    upsert_fn: Callable[..., Any] = upsert_positions,
    reresearch_cap: int = _DEFAULT_RERESEARCH_CAP,
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
        roster_col=db["ballot_rosters"],
    )

    # Load the primary calendar and narrow to closed contests in the window.
    calendar_rows = list(calendar_col.find({}))
    if not calendar_rows:
        # Fall back to the hardcoded FVAP 2026 table when the collection is empty.
        calendar_rows = calendar_mod.FVAP_2026_ROWS

    # Re-check EVERY race whose contest has passed this cycle (not just the last
    # 10 days). The per-race loop below skips already-confirmed races, so this
    # keeps flagging non-terminal races until results post and they confirm.
    closed_contests: list[tuple[str, str, date]] = (
        calendar_mod.states_with_passed_contest(
            calendar_rows,
            today=resolved_today,
        )
    )

    races_checked = 0
    confirmed_count = 0
    flagged_count = 0
    error_count = 0
    confirmed_winners: list[dict] = []

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
                nbc_fetch_fn=nbc_fetch_fn,
                structure_fn=structure_fn,
            )
            if outcome == _OUTCOME_CONFIRMED:
                confirmed_count += 1
                # T6: a freshly-confirmed race → deep re-research its winner(s).
                new_status = status_col.find_one({"race_key": race_key})
                if new_status:
                    confirmed_winners.extend(
                        _winner_candidates(new_status, cand_docs)
                    )
            elif outcome == _OUTCOME_FLAGGED:
                flagged_count += 1
            else:
                error_count += 1

    reresearched = await _reresearch_confirmed_winners(
        confirmed_winners,
        db=db,
        research_fn=research_fn,
        upsert_fn=upsert_fn,
        cap=reresearch_cap,
    )

    return {
        "races_checked": races_checked,
        "confirmed": confirmed_count,
        "flagged": flagged_count,
        "errors": error_count,
        "positions_reresearched": reresearched,
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
    reresearch_cap = int(
        os.environ.get("POSITIONS_RERESEARCH_CAP", _DEFAULT_RERESEARCH_CAP)
    )

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
                nbc_fetch_fn=nbc_mod.fetch_nbc_results,
                structure_fn=resolver_mod._structure_winners_with_gemini,
                reresearch_cap=reresearch_cap,
            )
        )
    except Exception:
        logger.exception("resolve_nominees job failed")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
