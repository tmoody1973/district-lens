# Data-Refresh Pipeline — Design

**Date:** 2026-05-24
**Status:** Validated design, not yet implemented
**Driver:** DistrictLens is moving past the hackathon toward a real product that must hold up unattended through the 2026 primary cascade (≈27 windows, March–September, plus runoff stragglers).

## Problem

FEC data is a frozen static import from 2026-05-14 (`agent/scripts/ingest_fec.py`). There is no API client, no cron, no refresh. As of this writing, early-primary states (TX, NC — March 3) already have winners the database cannot see. The frozen snapshot is not just stale; it is wrong about who is still in some races.

A primary also changes the *shape* of the data, not just its values: pre-primary a race has N candidates per party; post-primary it collapses to one nominee per party. The product must model the race-level transition, not just refresh candidate rows.

## Decisions locked

| Decision | Choice | Rationale |
|---|---|---|
| Scope | Phases 0–2 (schedule importer + primary calendar + nominee resolution → `race_status`). Recipe 11 / coalition depth deferred. | Driver is a real product; needs months of unattended freshness. Coalition/donor-DNA infra does not exist in the repo. |
| Runtime | Cloud Run Jobs + Cloud Scheduler, Python, on `civicsync-440613`. | Reuses the working Python importer with zero language boundary; same `gcloud` deploy story. (Rejected: Trigger.dev orchestration — TS↔Python tax not worth it when the pipeline is already Python.) |
| Trust model | Auto-confirm clean cases (with a fetched, stored results-page citation); flag messy ones as `provisional` for human review. | Honors the no-fabrication and citation rules while staying unattended for the ~80% clean races. Mirrors ADR-0001: deterministic gate decides, LLM only suggests. |
| Refresh approach | Reject the freshness doc's "fully-agentic daily Gemini agent." Build a deterministic pipeline with a single narrow Perplexity step for nominee resolution. | ADR-0001 precedent: deterministic pipeline beat LLM-chaining. |

## Architecture — two decoupled scheduled jobs

Both are Python Cloud Run Jobs fired by Cloud Scheduler. They run on different clocks because they answer different questions and have different blast radius.

### Job A — `refresh_fec` (slow clock, ~weekly)

Existing `ingest_fec.py` `run_import()`, unchanged, on a cron. Re-downloads the three bulk files (already cached/idempotent), re-upserts races/candidates/committees/finance, refreshes `last_checked_at` and `stale_after`. **This alone kills the frozen snapshot for roster and summary finance.** It is Phase 0 and nearly free.

Cannot flip a user-facing nominee — finance/roster refresh only.

### Job B — `resolve_nominees` (fast clock, ~daily)

New deterministic pipeline. Reads `primary_calendar`, finds races whose primary/runoff fell in the last N days, runs the confirm-or-flag sequence, writes `race_status` and `race_status_events`. Most daily runs are cheap no-ops (work only happens when something actually closed).

Can flip a user-facing nominee — only through the deterministic gate below.

**Why decoupled:** different cadences (finance drifts slowly; primary results are date-pinned events), different failure modes (a bulk-download hiccup must not block nominee resolution, and vice versa), different blast radius. A failure in one never poisons the other.

## Data model — three new collections

Following the freshness doc's load-bearing call: status belongs to the *race*, not stamped on every candidate row, because the journalist agent asks cross-candidate questions.

### `primary_calendar` (seeded once from NCSL, hand-correctable)

One doc per state+chamber+party where dates differ. ~50 states × a few variants — small, mostly static, edited when a state moves a date.

```
{ state, cycle, primary_date, runoff_date|null, runoff_rule|null,
  party|null, source_url, ingested_at, last_verified_at }
```

This is the clock Job B reads.

### `race_status` (written by Job B)

One doc per `race_key`. `status` is the field the agent and UI key off.

```
{ race_key, cycle, primary_date, runoff_date|null,
  status: "pre_primary"|"runoff_pending"|"confirmed"|"provisional"|"contested",
  winner_candidate_id|null, loser_candidate_ids: [],
  confidence: float, confirmation_basis: ["fec_status","results_page","perplexity"],
  citation_id|null,            // → results_citations
  flagged_reason|null,         // why it needs human eyes
  resolved_at, last_checked_at, reviewed_by|null }
```

`confirmed` only when the clean-case bar is met; everything else is `provisional`/`contested` and surfaced honestly.

### `results_citations` (the no-fabrication guarantee)

When Job B confirms a winner, it fetches the underlying authoritative results page and stores it. **No `results_citations` doc → no `confirmed` status.** This is the structural enforcement of the citation rule, not a convention.

```
{ citation_id, race_key, url, fetched_at, content_hash,
  publisher, snippet, full_text_ref }
```

### `race_status_events` (append-only change-feed)

One event per *actual* transition — never on a no-op run. This is the highest-value journalist output of the whole pipeline: "what moved this week."

```
{ race_key, from_status, to_status, winner_id, reason,
  presentation_class, citation_id, occurred_at }
```

## The confirm-or-flag pipeline (Job B per-race sequence)

The LLM touches exactly one step; everything else is deterministic.

1. **Select** (deterministic): from `primary_calendar`, races whose `primary_date`/`runoff_date` ∈ [today − N, today] and not already `confirmed`. N≈10 to catch slow filings.
2. **Read FEC signal** (deterministic): candidates' `fec_status` and `incumbent_challenge_status` (already imported). A *lagging* corroboration signal — never trusted alone.
3. **Resolve** (the one LLM call): reuse `_perplexity_search` from `agent/app/tools/position_search.py` — *"Who won the {state} {district} {party} primary on {date}? Cite official results."* Returns answer + source URLs.
4. **Fetch + store** (deterministic): `httpx.GET` the top authoritative source URL (SoS, AP, official), hash + store a `results_citations` doc. No fetchable authoritative page → cannot confirm.
5. **Decide** (deterministic gate):
   - **Confirm** only if ALL hold: single clear winner, no pending runoff, FEC signal not contradicting, results page fetched+stored, Perplexity high-confidence → `status=confirmed`, write winner/losers, emit event.
   - **Otherwise flag**: incumbent loss, runoff triggered, contested/too-close, source disagreement, no fetchable page → `status=provisional`/`contested` + `flagged_reason`, **no nominee flip**, emit event.

The LLM *suggests*; the deterministic gate *decides*. Worst case is a flagged race for human review, never a wrong winner shown.

**Idempotent:** re-running on a `confirmed` race is a no-op; a `provisional` race is re-checked each run until it resolves or is human-confirmed.

**Hard invariant:** `results_citations` is written *before* `race_status=confirmed`, never the reverse — a mid-step crash cannot leave a confirmed winner with no citation.

## The journalist surface

This is where the pipeline becomes a journalist tool rather than a fresh database.

### Change-feed is the product

The agent gets one read tool, `get_race_changes(since, states?|watchlist?)`, returning `race_status_events` with citations. "What moved this week in the races I cover" is the single highest-value journalist output — and nearly free, because Job B already computes every delta.

### Flagged = lead, not gap

A deterministic map turns `flagged_reason` into a `presentation_class`:

- **newsworthy-signal** (incumbent_defeated, runoff_triggered, upset) → rendered as a developing story: the known facts ("Incumbent X lost to Y" / "Runoff set {date}: A vs B"), an **"official confirmation pending"** badge, and the source already fetched. Pulls the journalist *in* on the hot night.
- **genuine-uncertainty** (sources_disagree, no_fetchable_page) → honest "result unconfirmed, checking official sources."

Same `provisional` status underneath; opposite UX. The no-fabrication contract stays intact — the most newsworthy events are not buried as missing data.

### Confirmed rows

Carry "auto-confirmed from {publisher} · report if wrong" — trust through transparency, and the spot-audit safety valve.

### Review posture

Hybrid: **notification** (existing push/Slack tooling) fires on a *newsworthy-signal* flag so an incumbent-loss is confirmed within minutes; **passive admin list** (read-only, filtered to `provisional`/`contested`, sorted by recency) for uncertainty-class. Provisional-but-honest is the contract for anything not yet human-confirmed.

## Explicit scope boundary — fresh ≠ deep

`weball26` is candidate-level *summary* totals. It does **not** contain itemized donors or independent expenditures. The marquee money story the freshness doc dangles — *"did out-of-district money flood in after the primary?"* — needs IE/Schedule-E and itemized data **we do not ingest.** `OTHER_POL_CMTE_CONTRIB` is PACs giving *to* the campaign, not outside money spent *for/against* it.

This design makes shallow finance *fresh*; it does not make it *deep*. That is the deferred Recipe-11 line. The journalist surface must not promise "follow the money" beyond summary totals.

## Failure handling & observability

- Both jobs idempotent — a crash means "retry next run."
- Job A download hiccup → keep last-good data, touch nothing, alert.
- Job B failure on one race → that race holds prior status, re-checked next run; one bad race never blocks others (`ordered=False`, per-race try/except).
- Cloud Run Job logs + Cloud Monitoring alert on job failure **and** on "ran during a known primary window but emitted zero events" (silent-failure detector).
- `official_import_batches` already audits Job A; add a parallel `refresh_runs` audit for Job B (races checked, confirmed, flagged, errors).
- Residual risk: a wrong Perplexity result that still passes the gate flips a nominee wrongly. Mitigation: periodic spot-audit of `confirmed` races + the visible "report if wrong" affordance.

## Testing (civic-critical, per project rules)

- Primary-window selection logic.
- Confirm-vs-flag gate as a table-driven test: each edge case → expected status.
- Citation-before-confirm invariant.
- Change-event emitted *only* on a real transition.
- Newsworthy-classification map.
- Perplexity and page-fetch mocked — no live API in unit tests.

## Phasing

- **P0 (days):** Job A on Cloud Scheduler. Kills the frozen snapshot immediately. Independent value, ship first.
- **P1:** `primary_calendar` seed + `race_status` + `results_citations` + Job B confirm-or-flag + `race_status_events`.
- **P2:** journalist surface — `get_race_changes`, flagged-as-lead rendering, newsworthy notification.
- **Deferred:** Recipe 11 / itemized + IE finance depth.

No new secrets — `PERPLEXITY_API_KEY` already in the agent env; the Cloud Run job reads it via Secret Manager.
