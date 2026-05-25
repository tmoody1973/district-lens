# P1 — Primary Nominee Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect who won each 2026 congressional primary/runoff and record it as race-level status, so DistrictLens knows the current nominee — auto-confirming clean cases (with a fetched, stored official citation) and flagging messy ones for human review, never fabricating a winner.

**Architecture:** A second daily Cloud Run Job (`resolve_nominees`, "Job B") reads a `primary_calendar`, finds races whose primary/runoff just closed, and runs a deterministic confirm-or-flag pipeline: a single narrow Perplexity call suggests the winner, a results page is fetched+stored as a citation, and a deterministic gate decides confirm vs. flag. Results land in `race_status`, with every transition appended to `race_status_events` (the change feed). Reuses P0's patterns: the importer-as-Cloud-Run-Job, `refresh_runs` audit, and the Terraform job+scheduler+secret wiring.

**Tech Stack:** Python 3.11+ (uv, pytest), pymongo, httpx, Perplexity sonar-pro (reusing `agent/app/tools/position_search.py::_perplexity_search`), Google Cloud Run Jobs + Cloud Scheduler + Secret Manager, Terraform (google ~> 7.13).

**Design reference:** `docs/plans/2026-05-24-data-refresh-design.md` (this is Phase P1). P0 (the weekly bulk refresh) is already shipped — see `docs/superpowers/plans/2026-05-24-p0-fec-refresh-schedule.md` and the live `app/jobs/refresh_fec.py` / `agent/deployment/terraform/single-project/refresh_job.tf` as concrete templates to mirror.

**Scope boundary:**
- IN: `primary_calendar` + `race_status` + `results_citations` + `race_status_events` collections; the `resolve_nominees` pipeline + job; its Terraform + schedule; tests.
- OUT (P2, later): the journalist-facing surface — `get_race_changes` agent tool, flagged-as-lead UI rendering, newsworthy notifications.
- OUT (separate follow-on, task #10): governor/gubernatorial races — FEC has no state-race data, so those need a new candidate source. NOTE: this plan's tables are office-agnostic (keyed by `race_key`), so they will extend to governor `race_key`s (e.g. `2026-G-WI-00`) without schema change; only ingestion differs.
- OUT (deferred): Recipe 11 / coalition + itemized/IE finance depth.

---

## Pre-flight facts (verified, trust these)

- **Calendar data source chosen: FVAP "2026 Primary Elections by state and territory"** (federal, public-domain, authoritative, covers primary + runoff dates + Senate flag + House seat count). The full verified table is embedded in Task 1's seed. Source: https://www.fvap.gov/uploads/FVAP/VAO/PrimaryElectionsCalendar.pdf
- **9 runoff states**: AL, AR, GA, LA, MS, NC, OK, SC, TX (runoff dates in the seed). `runoff_rule`: majority (>50%) → runoff for AL/AR/GA/MS/OK/SC/TX; NC = 30%-threshold/second-place-request; LA = state-specific. Hardcode in the seed.
- **`races` collection** (from `agent/scripts/ingest_fec.py`): docs have `race_key` (`{cycle}-{office}-{state}-{district:02d}`, e.g. `2026-H-GA-07`, `2026-S-GA-00`), `cycle`, `office` ("H"/"S"), `state`, `district`.
- **`candidates` collection**: `candidate_id`, `race_key`, `name`, `name_raw`, `party`, `fec_status` (FEC `CAND_STATUS`: "C"/"N"/"P"…), `incumbent_challenge_status` ("incumbent"/"challenger"/"open_seat"/"unknown").
- **Perplexity client to reuse**: `agent/app/tools/position_search.py` exposes `async def _perplexity_search(prompt: str) -> tuple[str, list[dict]]` returning `(answer, normalized_sources)` where each source has at least `url` and `title`. Uses `PERPLEXITY_API_KEY` env. (Confirm the exact source dict keys when implementing Task 4 by reading `_normalize_sources`.)
- **No `primary_calendar`/`race_status`/`results_citations`/`race_status_events` collections exist yet** (all net-new).
- **Secrets** (Secret Manager): `districtlens-mongodb-uri`, `districtlens-perplexity-key` both exist. The new job SA will need accessor on both.
- Baseline: `cd agent && uv run pytest tests/unit -q` → 43 passed.
- Test marker: `@pytest.mark.unit`; pytest `pythonpath="."`.

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `agent/app/refresh/__init__.py` | Create | Package for the resolution domain logic (pure, testable). |
| `agent/app/refresh/calendar.py` | Create | `primary_calendar` doc shape + window-selection logic (which races just closed). |
| `agent/app/refresh/race_status_store.py` | Create | Mongo access: upsert `race_status`, append `race_status_events` on transition, store `results_citations`. DI-friendly. |
| `agent/app/refresh/nominee_resolver.py` | Create | Perplexity prompt build + answer parsing into a structured `ResolvedPrimary`. |
| `agent/app/refresh/citation_fetch.py` | Create | Fetch + hash + persist an authoritative results page. |
| `agent/app/refresh/gate.py` | Create | The deterministic confirm-or-flag decision + newsworthy classification. |
| `agent/scripts/seed_primary_calendar.py` | Create | Idempotent seed of `primary_calendar` from the embedded FVAP table. |
| `agent/app/jobs/resolve_nominees.py` | Create | Job B entrypoint: orchestrate select→resolve→fetch→gate→write, with `refresh_runs` audit. Mirrors `app/jobs/refresh_fec.py`. |
| `agent/tests/unit/test_primary_calendar.py` | Create | Window-selection + seed-row validation tests. |
| `agent/tests/unit/test_race_status_store.py` | Create | Upsert + event-on-transition + citation-before-confirm tests. |
| `agent/tests/unit/test_nominee_resolver.py` | Create | Prompt + parse tests (Perplexity mocked). |
| `agent/tests/unit/test_gate.py` | Create | Table-driven confirm-vs-flag + newsworthy tests. |
| `agent/tests/unit/test_resolve_nominees_job.py` | Create | Job orchestration tests (all deps injected/mocked). |
| `agent/deployment/terraform/single-project/resolve_job.tf` | Create | Job B Cloud Run Job + daily scheduler + SA + secret access (Mongo + Perplexity), failure alert reusing the `alert_email` var. |

---

## Data model (4 collections)

**`primary_calendar`** — one doc per state (territories excluded; they have no Senate/House primary in the runoff sense):
```
{ state: "GA", cycle: "2026",
  primary_date: ISODate, runoff_date: ISODate|null,
  runoff_rule: "majority_50"|"nc_30_threshold"|"la_specific"|"none",
  has_senate_race: bool, house_seat_count: int,
  source: "fvap_2026", source_url: "...", ingested_at, last_verified_at }
```

**`race_status`** — one doc per `race_key`:
```
{ race_key, cycle, state, office,
  primary_date, runoff_date|null,
  status: "pre_primary"|"runoff_pending"|"confirmed"|"provisional"|"contested",
  winners: { "DEM": candidate_id|null, "REP": candidate_id|null, ... },
  losers: [candidate_id, ...],
  confidence: float, confirmation_basis: ["fec_status","results_page","perplexity"],
  citation_id: ObjectId|null, flagged_reason: str|null,
  resolved_at, last_checked_at, reviewed_by: str|null }
```

**`results_citations`** — provenance for a confirmed result (the no-fabrication guarantee):
```
{ _id, race_key, url, fetched_at, content_hash, publisher, snippet, full_text_ref|null }
```

**`race_status_events`** — append-only change feed (one per real transition):
```
{ race_key, from_status, to_status, winners, reason,
  presentation_class: "newsworthy_signal"|"genuine_uncertainty"|"routine",
  citation_id|null, occurred_at }
```

---

## Task 1: `primary_calendar` schema + seed (TDD)

**Files:** Create `agent/app/refresh/__init__.py`, `agent/app/refresh/calendar.py`, `agent/scripts/seed_primary_calendar.py`, `agent/tests/unit/test_primary_calendar.py`. Commands from `agent/`.

- [ ] **Step 1: Write failing tests** — `tests/unit/test_primary_calendar.py`:
```python
"""Tests for primary_calendar seed rows and window selection."""

import datetime as dt

import pytest

from app.refresh import calendar


@pytest.mark.unit
def test_calendar_rows_well_formed():
    rows = calendar.FVAP_2026_ROWS
    # 50 states + DC + territories minus territory rows that have no primary.
    assert len(rows) >= 50
    runoff_states = {r["state"] for r in rows if r["runoff_date"]}
    assert runoff_states == {"AL", "AR", "GA", "LA", "MS", "NC", "OK", "SC", "TX"}
    for r in rows:
        assert isinstance(r["primary_date"], dt.date)
        assert r["runoff_rule"] in {"majority_50", "nc_30_threshold", "la_specific", "none"}
        assert (r["runoff_date"] is None) == (r["runoff_rule"] == "none")


@pytest.mark.unit
def test_states_with_closed_contest_selects_primary_in_window():
    rows = [
        {"state": "GA", "primary_date": dt.date(2026, 5, 19), "runoff_date": dt.date(2026, 6, 16)},
        {"state": "WI", "primary_date": dt.date(2026, 8, 11), "runoff_date": None},
    ]
    today = dt.date(2026, 5, 22)
    closed = calendar.states_with_closed_contest(rows, today=today, window_days=10)
    assert closed == [("GA", "primary", dt.date(2026, 5, 19))]


@pytest.mark.unit
def test_states_with_closed_contest_selects_runoff_in_window():
    rows = [{"state": "GA", "primary_date": dt.date(2026, 5, 19), "runoff_date": dt.date(2026, 6, 16)}]
    closed = calendar.states_with_closed_contest(rows, today=dt.date(2026, 6, 18), window_days=10)
    assert closed == [("GA", "runoff", dt.date(2026, 6, 16))]


@pytest.mark.unit
def test_states_with_closed_contest_ignores_future_and_old():
    rows = [{"state": "TX", "primary_date": dt.date(2026, 3, 3), "runoff_date": dt.date(2026, 5, 26)}]
    # today far after both → nothing in a 10-day window
    assert calendar.states_with_closed_contest(rows, today=dt.date(2026, 7, 1), window_days=10) == []
```

- [ ] **Step 2: Run, verify fail** — `uv run pytest tests/unit/test_primary_calendar.py -q` → `ModuleNotFoundError: app.refresh`.

- [ ] **Step 3: Create `agent/app/refresh/__init__.py`** (empty).

- [ ] **Step 4: Implement `agent/app/refresh/calendar.py`** with the embedded FVAP table and selection logic:
```python
"""2026 primary calendar (FVAP source) + window selection.

Source: FVAP "2026 Primary Elections by state and territory"
https://www.fvap.gov/uploads/FVAP/VAO/PrimaryElectionsCalendar.pdf  (current as of 2026-05).
Territories (AS, GU, PR, VI) and DC delegate-only rows are omitted: no Senate/House
primary contest to resolve.
"""

from __future__ import annotations

import datetime as dt

_MAJORITY = "majority_50"
_NONE = "none"

# (state, primary M/D, runoff M/D or None, runoff_rule, has_senate, house_seats)
_RAW: list[tuple[str, tuple[int, int], tuple[int, int] | None, str, bool, int]] = [
    ("AL", (5, 19), (6, 16), _MAJORITY, True, 7),
    ("AK", (8, 18), None, _NONE, True, 1),
    ("AZ", (7, 21), None, _NONE, False, 9),
    ("AR", (3, 3), (3, 31), _MAJORITY, True, 4),
    ("CA", (6, 2), None, _NONE, False, 52),
    ("CO", (6, 30), None, _NONE, True, 8),
    ("CT", (8, 11), None, _NONE, False, 5),
    ("DE", (9, 15), None, _NONE, True, 1),
    ("FL", (8, 18), None, _NONE, True, 28),
    ("GA", (5, 19), (6, 16), _MAJORITY, True, 14),
    ("HI", (8, 8), None, _NONE, False, 2),
    ("ID", (5, 19), None, _NONE, True, 2),
    ("IL", (3, 17), None, _NONE, True, 17),
    ("IN", (5, 5), None, _NONE, False, 9),
    ("IA", (6, 2), None, _NONE, True, 4),
    ("KS", (8, 4), None, _NONE, True, 4),
    ("KY", (5, 19), None, _NONE, True, 6),
    ("LA", (5, 16), (6, 27), "la_specific", True, 6),
    ("ME", (6, 9), None, _NONE, True, 2),
    ("MD", (6, 23), None, _NONE, False, 8),
    ("MA", (9, 1), None, _NONE, True, 9),
    ("MI", (8, 4), None, _NONE, True, 13),
    ("MN", (8, 11), None, _NONE, True, 8),
    ("MS", (3, 10), (4, 7), _MAJORITY, True, 4),
    ("MO", (8, 4), None, _NONE, False, 8),
    ("MT", (6, 2), None, _NONE, True, 2),
    ("NE", (5, 12), None, _NONE, True, 3),
    ("NV", (6, 9), None, _NONE, False, 4),
    ("NH", (9, 8), None, _NONE, True, 2),
    ("NJ", (6, 2), None, _NONE, True, 12),
    ("NM", (6, 2), None, _NONE, True, 3),
    ("NY", (6, 23), None, _NONE, False, 26),
    ("NC", (3, 3), (5, 12), "nc_30_threshold", True, 14),
    ("ND", (6, 9), None, _NONE, False, 1),
    ("OH", (5, 5), None, _NONE, True, 15),
    ("OK", (6, 16), (8, 25), _MAJORITY, True, 5),
    ("OR", (5, 19), None, _NONE, True, 6),
    ("PA", (5, 19), None, _NONE, True, 17),
    ("RI", (9, 9), None, _NONE, True, 2),
    ("SC", (6, 9), (6, 23), _MAJORITY, True, 7),
    ("SD", (6, 2), None, _NONE, True, 1),
    ("TN", (8, 6), None, _NONE, True, 9),
    ("TX", (3, 3), (5, 26), _MAJORITY, True, 38),
    ("UT", (6, 23), None, _NONE, False, 4),
    ("VT", (8, 11), None, _NONE, False, 1),
    ("VA", (8, 4), None, _NONE, True, 11),
    ("WA", (8, 4), None, _NONE, False, 10),
    ("WV", (5, 12), None, _NONE, True, 2),
    ("WI", (8, 11), None, _NONE, False, 8),
    ("WY", (8, 18), None, _NONE, True, 1),
]

CYCLE = "2026"
SOURCE = "fvap_2026"
SOURCE_URL = "https://www.fvap.gov/uploads/FVAP/VAO/PrimaryElectionsCalendar.pdf"


def _d(md: tuple[int, int] | None) -> dt.date | None:
    return dt.date(2026, md[0], md[1]) if md else None


FVAP_2026_ROWS: list[dict] = [
    {
        "state": s,
        "cycle": CYCLE,
        "primary_date": _d(p),
        "runoff_date": _d(r),
        "runoff_rule": rule,
        "has_senate_race": sen,
        "house_seat_count": seats,
        "source": SOURCE,
        "source_url": SOURCE_URL,
    }
    for (s, p, r, rule, sen, seats) in _RAW
]


def states_with_closed_contest(
    rows: list[dict],
    *,
    today: dt.date,
    window_days: int = 10,
) -> list[tuple[str, str, dt.date]]:
    """Return (state, contest_kind, contest_date) for primaries/runoffs that fell
    within the last `window_days` (inclusive, not in the future). Runoff takes
    precedence when both a state's primary and runoff are in-window."""
    out: list[tuple[str, str, dt.date]] = []
    lo = today - dt.timedelta(days=window_days)
    for r in rows:
        chosen: tuple[str, dt.date] | None = None
        if r.get("runoff_date") and lo <= r["runoff_date"] <= today:
            chosen = ("runoff", r["runoff_date"])
        elif r.get("primary_date") and lo <= r["primary_date"] <= today:
            chosen = ("primary", r["primary_date"])
        if chosen:
            out.append((r["state"], chosen[0], chosen[1]))
    return out
```

- [ ] **Step 5: Run tests, verify pass** — `uv run pytest tests/unit/test_primary_calendar.py -q` → 4 passed.

- [ ] **Step 6: Implement the seed script** `agent/scripts/seed_primary_calendar.py` (idempotent upsert, mirrors `ingest_fec.py` structure — read `MONGODB_URI`, upsert by `{state, cycle}`, set `ingested_at`/`last_verified_at`, ensure unique index):
```python
"""Idempotent seed of the primary_calendar collection from the FVAP 2026 table."""

from __future__ import annotations

import datetime
import logging
import os
import sys

import pymongo
from pymongo import UpdateOne

from app.refresh.calendar import FVAP_2026_ROWS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def seed(mongo_uri: str) -> int:
    now = datetime.datetime.now(datetime.UTC)
    client: pymongo.MongoClient = pymongo.MongoClient(mongo_uri)
    col = client["districtlens"]["primary_calendar"]
    col.create_index([("state", 1), ("cycle", 1)], unique=True)
    ops = []
    for row in FVAP_2026_ROWS:
        # store datetimes (pymongo needs datetime, not date)
        doc = dict(row)
        doc["primary_date"] = datetime.datetime.combine(row["primary_date"], datetime.time(), datetime.UTC)
        doc["runoff_date"] = (
            datetime.datetime.combine(row["runoff_date"], datetime.time(), datetime.UTC)
            if row["runoff_date"] else None
        )
        doc["last_verified_at"] = now
        ops.append(
            UpdateOne(
                {"state": row["state"], "cycle": row["cycle"]},
                {"$set": doc, "$setOnInsert": {"ingested_at": now}},
                upsert=True,
            )
        )
    result = col.bulk_write(ops, ordered=False)
    logger.info("primary_calendar seeded: %d upserted, %d modified", result.upserted_count, result.modified_count)
    client.close()
    return len(ops)


if __name__ == "__main__":
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        logger.error("MONGODB_URI not set")
        sys.exit(1)
    print(f"Seeded {seed(uri)} primary_calendar rows")
```

- [ ] **Step 7: Lint + full suite** — `uv run pytest tests/unit -q` (47 passed) and `uvx ruff check app/refresh scripts/seed_primary_calendar.py tests/unit/test_primary_calendar.py`.

- [ ] **Step 8: Commit** — `git add app/refresh/__init__.py app/refresh/calendar.py scripts/seed_primary_calendar.py tests/unit/test_primary_calendar.py && git commit -m "feat(refresh): primary_calendar (FVAP 2026) + window selection + seed"`

---

## Task 2: `race_status` store — upsert + event-on-transition + citation (TDD)

**Files:** Create `agent/app/refresh/race_status_store.py`, `agent/tests/unit/test_race_status_store.py`.

This module owns all writes to `race_status`, `race_status_events`, `results_citations`. It is the **enforcement point** for the no-fabrication invariant: `apply_resolution` refuses to write `status="confirmed"` unless a `citation_id` is supplied.

- [ ] **Step 1: Write failing tests** — `tests/unit/test_race_status_store.py`:
```python
"""Tests for the race_status store: transitions, events, citation invariant."""

import pytest

from app.refresh import race_status_store as store


class FakeCol:
    def __init__(self):
        self.docs = []
    def find_one(self, flt):
        return next((d for d in self.docs if all(d.get(k) == v for k, v in flt.items())), None)
    def update_one(self, flt, update, upsert=False):
        d = self.find_one(flt)
        if d is None and upsert:
            d = dict(flt); self.docs.append(d)
        if d is not None:
            d.update(update.get("$set", {}))
    def insert_one(self, doc):
        self.docs.append(dict(doc))
        return type("R", (), {"inserted_id": len(self.docs)})()


def _stores():
    return store.RaceStatusStore(status_col=FakeCol(), events_col=FakeCol(), citations_col=FakeCol())


@pytest.mark.unit
def test_confirm_requires_citation():
    s = _stores()
    with pytest.raises(ValueError, match="citation"):
        s.apply_resolution(race_key="2026-H-GA-07", to_status="confirmed",
                           winners={"REP": "H0GA07001"}, citation_id=None, reason="clean")


@pytest.mark.unit
def test_confirm_with_citation_writes_status_and_event():
    s = _stores()
    s.apply_resolution(race_key="2026-H-GA-07", to_status="confirmed",
                       winners={"REP": "H0GA07001"}, citation_id=123, reason="clean",
                       presentation_class="routine", prev_status="pre_primary")
    st = s.status_col.find_one({"race_key": "2026-H-GA-07"})
    assert st["status"] == "confirmed" and st["citation_id"] == 123
    assert len(s.events_col.docs) == 1
    assert s.events_col.docs[0]["to_status"] == "confirmed"


@pytest.mark.unit
def test_no_event_when_status_unchanged():
    s = _stores()
    s.apply_resolution(race_key="2026-H-GA-07", to_status="provisional", winners={},
                       citation_id=None, reason="runoff", prev_status="provisional")
    assert len(s.events_col.docs) == 0  # no transition → no event


@pytest.mark.unit
def test_flag_provisional_allowed_without_citation():
    s = _stores()
    s.apply_resolution(race_key="2026-H-GA-07", to_status="provisional", winners={},
                       citation_id=None, reason="incumbent_defeated",
                       presentation_class="newsworthy_signal", prev_status="pre_primary")
    assert s.status_col.find_one({"race_key": "2026-H-GA-07"})["status"] == "provisional"
    assert s.events_col.docs[0]["presentation_class"] == "newsworthy_signal"
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `race_status_store.py`:**
```python
"""Writes to race_status / race_status_events / results_citations.

Enforces the no-fabrication invariant: status="confirmed" requires a citation_id.
"""

from __future__ import annotations

import datetime
import hashlib
from typing import Any


class RaceStatusStore:
    def __init__(self, *, status_col, events_col, citations_col):
        self.status_col = status_col
        self.events_col = events_col
        self.citations_col = citations_col

    def store_citation(self, *, race_key: str, url: str, publisher: str, snippet: str, content: str) -> Any:
        now = datetime.datetime.now(datetime.UTC)
        res = self.citations_col.insert_one({
            "race_key": race_key, "url": url, "publisher": publisher,
            "snippet": snippet[:500],
            "content_hash": hashlib.sha256(content.encode("utf-8", "replace")).hexdigest(),
            "fetched_at": now,
        })
        return res.inserted_id

    def apply_resolution(
        self, *, race_key: str, to_status: str, winners: dict[str, str],
        citation_id: Any | None, reason: str | None,
        presentation_class: str = "routine", prev_status: str | None = None,
        confidence: float = 0.0, confirmation_basis: list[str] | None = None,
        losers: list[str] | None = None, extra: dict | None = None,
    ) -> None:
        if to_status == "confirmed" and citation_id is None:
            raise ValueError("cannot set status=confirmed without a citation_id (no-fabrication rule)")
        now = datetime.datetime.now(datetime.UTC)
        doc = {
            "status": to_status, "winners": winners, "losers": losers or [],
            "citation_id": citation_id, "flagged_reason": reason,
            "confidence": confidence, "confirmation_basis": confirmation_basis or [],
            "resolved_at": now, "last_checked_at": now,
            **(extra or {}),
        }
        self.status_col.update_one({"race_key": race_key}, {"$set": doc}, upsert=True)
        if to_status != prev_status:
            self.events_col.insert_one({
                "race_key": race_key, "from_status": prev_status, "to_status": to_status,
                "winners": winners, "reason": reason,
                "presentation_class": presentation_class,
                "citation_id": citation_id, "occurred_at": now,
            })
```

- [ ] **Step 4: Run tests, verify pass (4 passed).**
- [ ] **Step 5: Full suite + ruff.**
- [ ] **Step 6: Commit** — `feat(refresh): race_status store with transition events + citation invariant`

---

## Task 3: Nominee resolver (Perplexity prompt + parse) — TDD

**Files:** Create `agent/app/refresh/nominee_resolver.py`, `agent/tests/unit/test_nominee_resolver.py`.

The resolver builds the Perplexity prompt for one race and parses the answer into a structured result. It does NOT call the network in tests (the search function is injected).

- [ ] **Step 1: Failing tests** — assert `build_prompt` mentions the state, office label, district, party set, and date; assert `resolve_race` returns a `ResolvedPrimary` with `winners_by_party`, `sources`, and `confidence`, given an injected fake search returning a canned `(answer, sources)`. Cover: clean single-winner answer; an answer indicating a runoff ("advances to a runoff") → `runoff_indicated=True`; an answer with no clear winner → `winners_by_party` empty + low confidence. (Write the canned answers as fixtures; assert the parser's structured output, NOT exact prose.)

```python
import pytest
from app.refresh import nominee_resolver as nr

@pytest.mark.unit
def test_build_prompt_includes_key_facts():
    p = nr.build_prompt(state="GA", office="H", district="07", parties=["DEM", "REP"], date="2026-05-19")
    for token in ["Georgia", "7", "Democratic", "Republican", "2026-05-19", "official"]:
        assert token in p

@pytest.mark.unit
@pytest.mark.asyncio
async def test_resolve_race_parses_single_winners():
    async def fake_search(prompt):
        return ("The Republican primary was won by Jane Doe. The Democratic primary was won by John Roe.",
                [{"url": "https://sos.ga.gov/results", "title": "GA SoS Results"}])
    res = await nr.resolve_race(state="GA", office="H", district="07", parties=["DEM", "REP"],
                                date="2026-05-19", search_fn=fake_search,
                                structure_fn=nr._heuristic_structure)
    assert res.winners_by_party.get("REP") == "Jane Doe"
    assert res.winners_by_party.get("DEM") == "John Roe"
    assert res.sources and res.sources[0]["url"].startswith("https://sos.ga.gov")
    assert res.runoff_indicated is False
```
(Also: `test_resolve_race_detects_runoff` with answer containing "advances to a June 16 runoff" → `runoff_indicated True`; `test_resolve_race_no_winner` → empty winners, `confidence` low.)

- [ ] **Step 2-4: Implement `nominee_resolver.py`.** Define `@dataclass(frozen=True) class ResolvedPrimary` (`winners_by_party: dict[str,str]`, `sources: list[dict]`, `runoff_indicated: bool`, `confidence: float`, `raw_answer: str`). `build_prompt` produces the narrow question (full state name via a STATE_NAMES map, office label "House"/"Senate", party full names, the date, explicit "cite official Secretary of State or AP results"). `resolve_race` calls the injected `search_fn`, then a `structure_fn` to extract winners — default `_heuristic_structure` uses simple, well-tested regex/keyword extraction (e.g., `r"(Republican|Democratic).{0,40}?won by ([A-Z][\w.'-]+(?: [A-Z][\w.'-]+)+)"`), detects runoff via keywords ("runoff", "advances to"), and sets `confidence` from how cleanly it parsed. Keep the parser conservative: ambiguity → low confidence + empty winners (so the gate flags, never fabricates). Read `position_search.py::_structure_with_gemini` for an optional richer structuring path, but the DEFAULT must be deterministic and offline-testable.

  > Implementer note: the goal is NOT a perfect NLP parser. It is a conservative extractor whose failure mode is "I'm not sure" (→ flag), never "confident wrong answer." Bias toward low confidence.

- [ ] **Step 5-6: Full suite + ruff + commit** — `feat(refresh): Perplexity nominee resolver (prompt + conservative parse)`. (`pytest-asyncio` is already a dev dep; mark async tests `@pytest.mark.asyncio`.)

---

## Task 4: Citation fetch + store — TDD

**Files:** Create `agent/app/refresh/citation_fetch.py`, `agent/tests/unit/` test added to `test_race_status_store.py` or a new `test_citation_fetch.py`.

- [ ] **Step 1: Failing tests** (httpx injected/mocked):
  - `pick_authoritative_url(sources)` prefers `.gov` / SoS / AP / official over blogs/aggregators; returns None if none qualify.
  - `fetch_results_page(url, client)` returns `(content, publisher)` on 200; raises/returns None on non-200 or timeout.
```python
import pytest
from app.refresh import citation_fetch as cf

@pytest.mark.unit
def test_pick_authoritative_prefers_gov():
    srcs = [{"url": "https://ballotpedia.org/x"}, {"url": "https://sos.ga.gov/results"}]
    assert cf.pick_authoritative_url(srcs) == "https://sos.ga.gov/results"

@pytest.mark.unit
def test_pick_authoritative_none_when_only_aggregators():
    srcs = [{"url": "https://reddit.com/x"}, {"url": "https://somewordpressblog.com/y"}]
    assert cf.pick_authoritative_url(srcs) is None
```

- [ ] **Step 2-4: Implement.** `AUTHORITATIVE_HINTS = (".gov", "sos.", "apnews.com", "/elections", "secretary of state")`; `pick_authoritative_url` scores sources and returns the best or None. `async def fetch_results_page(url, *, client_factory=httpx.AsyncClient)` does a GET with timeout, returns `(text, publisher_from_host)` or `None`. Mirror the httpx usage in `position_search.py`.

- [ ] **Step 5-6: Full suite + ruff + commit** — `feat(refresh): authoritative results-page fetch for citations`

---

## Task 5: The deterministic gate (confirm-or-flag + newsworthy) — TDD

**Files:** Create `agent/app/refresh/gate.py`, `agent/tests/unit/test_gate.py`.

This is the civic-safety core. It takes the resolver output + FEC signal + whether a citation was obtained + calendar context, and returns a `GateDecision(to_status, winners, reason, presentation_class, confidence, confirmation_basis)`. **Pure function, no I/O — fully table-tested.**

- [ ] **Step 1: Table-driven failing tests** — `test_gate.py`. Cover every row:

| Scenario | Inputs | Expected `to_status` | Expected `presentation_class` |
|---|---|---|---|
| Clean single winner, citation stored, FEC agrees | winners present, citation=yes, runoff_indicated=no, incumbent not lost | `confirmed` | `routine` |
| Clean, but no authoritative citation fetched | winners present, citation=no | `provisional` | `genuine_uncertainty` |
| Runoff indicated by resolver | runoff_indicated=yes | `runoff_pending` | `newsworthy_signal` |
| Runoff-state, no majority winner parsed | runoff_rule=majority_50, winners empty/low-conf | `runoff_pending` | `newsworthy_signal` |
| Incumbent lost (winner != incumbent candidate) | winner differs from incumbent_id, citation=yes | `confirmed` | `newsworthy_signal` |
| Resolver low confidence / no winner, not a runoff state | winners empty, conf low | `provisional` | `genuine_uncertainty` |
| Sources disagree flag passed in | disagreement=True | `contested` | `genuine_uncertainty` |

```python
import pytest
from app.refresh import gate

def _inp(**kw):
    base = dict(winners_by_party={"REP": "c1"}, confidence=0.9, runoff_indicated=False,
               citation_id=1, runoff_rule="none", incumbent_id=None, sources_disagree=False,
               fec_contradicts=False)
    base.update(kw); return base

@pytest.mark.unit
def test_clean_confirms():
    d = gate.decide(**_inp())
    assert d.to_status == "confirmed" and d.presentation_class == "routine"

@pytest.mark.unit
def test_no_citation_is_provisional():
    d = gate.decide(**_inp(citation_id=None))
    assert d.to_status == "provisional" and d.presentation_class == "genuine_uncertainty"

@pytest.mark.unit
def test_runoff_indicated_is_pending_and_newsworthy():
    d = gate.decide(**_inp(runoff_indicated=True))
    assert d.to_status == "runoff_pending" and d.presentation_class == "newsworthy_signal"

@pytest.mark.unit
def test_incumbent_loss_confirms_as_newsworthy():
    d = gate.decide(**_inp(winners_by_party={"REP": "challenger1"}, incumbent_id="incumbent1"))
    assert d.to_status == "confirmed" and d.presentation_class == "newsworthy_signal"

@pytest.mark.unit
def test_low_confidence_flags():
    d = gate.decide(**_inp(winners_by_party={}, confidence=0.2))
    assert d.to_status == "provisional" and d.presentation_class == "genuine_uncertainty"

@pytest.mark.unit
def test_sources_disagree_is_contested():
    d = gate.decide(**_inp(sources_disagree=True))
    assert d.to_status == "contested"
```

- [ ] **Step 2-4: Implement `gate.py`** — `@dataclass(frozen=True) class GateDecision(...)` and `def decide(*, winners_by_party, confidence, runoff_indicated, citation_id, runoff_rule, incumbent_id, sources_disagree, fec_contradicts, confidence_threshold=0.7) -> GateDecision`. Decision order (first match wins): `sources_disagree`→contested/uncertainty; `runoff_indicated` OR (runoff_rule!=none AND no clear winner)→runoff_pending/newsworthy; no winner OR confidence<threshold OR citation_id is None OR fec_contradicts→provisional/uncertainty; else→confirmed, with presentation `newsworthy_signal` if a winner != incumbent_id (incumbent defeated) else `routine`. Build `confirmation_basis` from which signals were present.

  > Invariant: `decide` only ever returns `confirmed` when `citation_id is not None`. Add an `assert` to make it impossible to regress, and a test that confirms it.

- [ ] **Step 5-6: Full suite + ruff + commit** — `feat(refresh): deterministic confirm-or-flag gate with newsworthy classification`

---

## Task 6: `resolve_nominees` job entrypoint — TDD

**Files:** Create `agent/app/jobs/resolve_nominees.py`, `agent/tests/unit/test_resolve_nominees_job.py`. **Mirror `app/jobs/refresh_fec.py`** (same `refresh_runs` audit shape with `job_name="resolve_nominees"`, same `try/finally` client close, same `main()` exit-code contract).

- [ ] **Step 1: Failing tests** — inject every dependency (calendar rows, a fake races/candidates/status collections, a fake `resolve_race`, a fake citation fetch, the real `gate.decide`, fake store). Assert end-to-end on a small fixture:
  - A GA primary in-window with a clean Perplexity result + authoritative source → `race_status` confirmed + one event + a `results_citations` doc + a `refresh_runs` "completed" audit.
  - A race with no authoritative source → provisional, no citation, event with `genuine_uncertainty`.
  - A no-op day (no contests in window) → 0 races processed, `refresh_runs` completed with `counts={"races_checked":0,...}`.

- [ ] **Step 2-4: Implement `resolve_nominees.py`** — `async def execute_resolution(*, mongo_uri, today=None, window_days=10, search_fn=..., fetch_fn=..., client_factory=pymongo.MongoClient, now_fn=...) -> dict`:
  1. open client (try/finally close), write `refresh_runs` "running" with `job_name="resolve_nominees"`.
  2. load `primary_calendar` rows; `closed = calendar.states_with_closed_contest(rows, today, window_days)`.
  3. for each `(state, kind, date)`: query `races` for `{cycle, state}` not already `confirmed` in `race_status`; for each race, gather its candidates (parties, incumbent_id, fec_status); `await nominee_resolver.resolve_race(...)`; `url = citation_fetch.pick_authoritative_url(res.sources)`; if url: fetch → `store_citation` → `citation_id`; `decision = gate.decide(...)`; `store.apply_resolution(..., prev_status=<current race_status.status>)`.
  4. write `refresh_runs` "completed" with counts (`races_checked`, `confirmed`, `flagged`, `errors`); per-race `try/except` so one failure doesn't abort the batch.
  `main()` reads `MONGODB_URI`, runs `asyncio.run(execute_resolution(...))`, returns 0/1 (copy the pattern from `refresh_fec.main`).

- [ ] **Step 5-6: Full suite + ruff + commit** — `feat(agent): resolve_nominees job orchestrating the confirm-or-flag pipeline`

---

## Task 7: Terraform — Job B + daily scheduler + secret access

**Files:** Create `agent/deployment/terraform/single-project/resolve_job.tf`. **Mirror `refresh_job.tf` exactly** (it's the proven template).

- [ ] **Step 1: Author `resolve_job.tf`:**
  - `google_service_account.resolve_job_sa` (`account_id = "resolve-nominees-job"`).
  - `google_secret_manager_secret_iam_member` granting that SA `secretAccessor` on BOTH `google_secret_manager_secret.mongodb_uri` (already a TF resource in `refresh_job.tf`) AND the Perplexity secret. The Perplexity secret is not yet a TF resource — add a `data "google_secret_manager_secret" "perplexity"` (read-only reference to `districtlens-perplexity-key`) and grant on its `.id`.
  - `google_cloud_run_v2_job.resolve_nominees` — same shape as `refresh_fec` but `command = ["uv","run","python","-m","app.jobs.resolve_nominees"]`, env `MONGODB_URI` + `PERPLEXITY_API_KEY` (both via `secret_key_ref`), `timeout = "3600s"` (resolution does many Perplexity calls on a primary day), `lifecycle ignore_changes` on image.
  - `google_service_account.resolve_scheduler_sa` + `google_cloud_run_v2_job_iam_member` (`run.invoker`) + `google_cloud_scheduler_job.resolve_nominees_daily` (`schedule = "0 10 * * *"`, daily 10:00 UTC; `oauth_token` with `scope = "https://www.googleapis.com/auth/cloud-platform"`).
  - Reuse the existing `var.alert_email` + add a `google_monitoring_alert_policy` for this job's failures (count-guarded), mirroring `refresh_fec_failed`.

- [ ] **Step 2: `terraform fmt && terraform init -backend=false && terraform validate`** → "Success". (AUTHORING ONLY — no apply/import here.)
- [ ] **Step 3: Commit** — `infra(agent): resolve_nominees Cloud Run Job + daily scheduler + secret access (P1)`

---

## Task 8: Deploy + verify (PROD — confirm with user before each mutating step)

Mirror P0's Task 7 discipline (it worked). **Stop for explicit user OK before apply, image build, and first execution.** All from the canonical repo (local state lives there; the worktree has no state). Use **targeted** applies.

- [ ] **Step 1:** Seed the calendar first (safe, idempotent): from canonical `agent/`, `MONGODB_URI` from the secret → `uv run python -m scripts.seed_primary_calendar`. Verify 50 `primary_calendar` docs.
- [ ] **Step 2 (confirm):** `terraform plan` then targeted `terraform apply` of the Task 7 resources (job, SAs, IAM, scheduler, alert). Expect only adds, 0 destroy.
- [ ] **Step 3 (confirm):** Build + push the job image (reuse the SAME image as `refresh-fec` — it already contains `app/` + `scripts/`; just point this job at the existing `districtlens-agent/refresh-fec:<sha>` image, OR rebuild at the new HEAD), then `gcloud run jobs update districtlens-agent-resolve-nominees --image <img>`.
- [ ] **Step 4 (confirm):** `gcloud run jobs execute districtlens-agent-resolve-nominees --wait`. Because TX/NC/MS/AR primaries (March) are already long past the 10-day window, a normal run today will be a near no-op — to actually exercise it, temporarily run with a wider window via a one-off `REFRESH_WINDOW_DAYS` env, OR verify against a state whose primary is within 10 days of today. Confirm: a `refresh_runs` "completed" doc for `resolve_nominees`; spot-check one `race_status` + its `race_status_events` + (if confirmed) a `results_citations` doc with a real URL.
- [ ] **Step 5:** Confirm the daily scheduler triggers (`gcloud scheduler jobs run resolve-nominees-daily`).

---

## Self-Review

**Spec coverage (P1 scope):** primary_calendar (T1) · race_status + events + citations store (T2) · resolver (T3) · citation fetch (T4) · gate (T5) · job orchestration (T6) · Terraform job+scheduler (T7) · deploy+verify (T8). Trust model (auto-confirm clean + stored citation, flag messy) lives in T5 gate + T2 invariant. Change feed = T2 events. Newsworthy-vs-uncertainty = T5.

**No-fabrication enforced twice:** the gate never returns `confirmed` without a `citation_id` (T5 assert + test), and the store refuses to persist `confirmed` without one (T2 invariant + test). Belt and suspenders, matching the civic-safety rule.

**Office-agnostic:** all collections key on `race_key`; governor races (task #10) slot in later with no schema change.

**Placeholder scan:** Tasks 1, 2, 5 have full code. Tasks 3, 4, 6 give complete signatures, the exact test scenarios, and the algorithm — the implementer writes the bodies against those tests (TDD). The one judgment-heavy piece (the resolver parser) is explicitly scoped as "conservative, fails to "unsure" not "confident-wrong"" with the regex starting point given.

**Verify-at-execution flags:** exact `_perplexity_search` source-dict keys (read `_normalize_sources`); whether to reuse the refresh-fec image or rebuild; the live window-testing approach in T8 (most primaries are outside the 10-day window today).
