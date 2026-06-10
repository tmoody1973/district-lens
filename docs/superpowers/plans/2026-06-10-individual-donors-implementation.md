# Individual Donors Tool + Generative Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A chat question like "Who are Gwen Moore's largest individual donors?" triggers a live FEC tool call (`get_individual_donors`) rendered as a polished `DonorContributionsCard` in the CopilotKit chat trace.

**Architecture:** New agent-side ADK tool in `agent/app/tools/fec_donors.py` — resolves the candidate from Mongo, calls the live FEC API (committee → schedule_a receipts), dedupes by donor name, caches in `fec_donor_cache` (24h). Web card registered via `useRenderToolCall` in `AgentToolTrace.tsx`, cloning the `FinanceToolCard` mechanics.

**Tech Stack:** Python (httpx, pymongo, google-adk FunctionTool, pytest), TypeScript/React (CopilotKit, vitest + testing-library).

**Verified facts (2026-06-10, live):**
- `candidates.candidate_id` IS the FEC id (e.g. `H4WI04183`).
- No FEC_API_KEY exists anywhere — but `CONGRESS_API_KEY` (already mounted in the agent Cloud Run service from Secret Manager) is an api.data.gov key and works on api.open.fec.gov. Verified: `/candidate/H4WI04183/committees/?designation=P` → `C00397505 MOORE FOR CONGRESS`; `/schedules/schedule_a/` returned 451 receipts sorted desc.
- Response fields: `contributor_name`, `contribution_receipt_amount`, `contributor_employer`, `contributor_occupation`, `contributor_city`, `contributor_state` (separate), `contribution_receipt_date` (`YYYY-MM-DD`).
- FEC `is_individual=true` includes tribal nations (their line-11AI classification) — display as-is; the coverage note explains itemization.

**Key design constraints:**
- The LLM-visible tool signature is exactly `get_individual_donors(candidate_name: str, race_key: str)`. Test injection (db, transport, clock) lives on a private `_donors_impl(...)` the public tool delegates to — extra kwargs must NOT leak into the ADK tool schema.
- Tool never raises: every failure path returns the honest-empty envelope.
- Envelope matches house style: `{"status": "success", "data": {...}, "source": ...}` — `AgentToolTrace` cards read `result.data`.
- Money is pre-formatted agent-side with the existing `_fmt_money` (card receives `total_fmt`).
- SYSTEM_PROMPT (`civic_safety.md`) is byte-locked — tool docstring alone must route donor questions to this tool.

---

### Task 1: Agent — pure helpers (normalize + dedupe), TDD

**Files:**
- Create: `agent/app/tools/fec_donors.py`
- Test: `agent/tests/unit/test_fec_donors.py`

- [ ] **Step 1: Write failing tests for dedupe**

```python
"""get_individual_donors — live FEC largest-itemized-contributions tool.

Tests use injected fakes only (no network, no Mongo): FakeCollection for the
cache/candidates, httpx.MockTransport for the FEC API.
"""

from __future__ import annotations

from app.tools.fec_donors import _dedupe_receipts


def _receipt(name, amount, date="2025-09-01", employer=None, occupation=None,
             city="MILWAUKEE", state="WI"):
    return {
        "contributor_name": name,
        "contribution_receipt_amount": amount,
        "contribution_receipt_date": date,
        "contributor_employer": employer,
        "contributor_occupation": occupation,
        "contributor_city": city,
        "contributor_state": state,
    }


def test_dedupe_merges_same_name_summing_amounts():
    rows = _dedupe_receipts([
        _receipt("KLEIN, DENNIS J", 3300, date="2025-03-01"),
        _receipt("Klein,  Dennis J", 3300, date="2025-09-22", employer="CD SMITH",
                 occupation="EXECUTIVE"),
    ])
    assert len(rows) == 1
    assert rows[0]["total"] == 6600
    assert rows[0]["transactions"] == 2
    assert rows[0]["latest_date"] == "2025-09-22"
    # metadata comes from the latest-dated receipt
    assert rows[0]["employer"] == "CD SMITH"


def test_dedupe_orders_by_total_descending():
    rows = _dedupe_receipts([
        _receipt("SMALL, PAT", 500),
        _receipt("BIG, JO", 3500),
        _receipt("SMALL, PAT", 500, date="2025-10-01"),
        _receipt("MID, LEE", 2000),
    ])
    assert [r["total"] for r in rows] == [3500, 2000, 1000]


def test_dedupe_caps_at_ten_donors():
    rows = _dedupe_receipts([_receipt(f"DONOR, N{i}", 100 + i) for i in range(15)])
    assert len(rows) == 10


def test_dedupe_formats_city_state_and_amount():
    rows = _dedupe_receipts([_receipt("KLEIN, DENNIS J", 3500)])
    assert rows[0]["city_state"] == "Milwaukee, WI"
    assert rows[0]["total_fmt"] == "$3.5K"
```

- [ ] **Step 2: Run to verify failure** — `cd agent && uv run pytest tests/unit/test_fec_donors.py -v` → FAIL (`fec_donors` module missing)

- [ ] **Step 3: Implement helpers in `agent/app/tools/fec_donors.py`**

```python
"""Live FEC "largest individual donors" tool (demo moment, 2026-06-10 spec).

Pipeline: candidate doc (Mongo) → principal committee (FEC) → schedule_a
receipts sorted by amount → same-page dedupe by contributor name → top 10,
cached 24h in `fec_donor_cache`. Every failure degrades to honest-empty —
this function must never raise into the chat path.

Civic guardrail: contributions are CONTEXT — they never establish policy
positions (.claude/rules/civic_safety.md). The docstring on the tool repeats
this for the LLM.
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


def _title_case_city(city: str | None) -> str:
    return (city or "").title()


def _dedupe_receipts(receipts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge same-name receipts: sum totals, count, keep latest-dated metadata."""
    merged: dict[str, dict[str, Any]] = {}
    for r in receipts:
        key = _normalize_name(r.get("contributor_name") or "")
        if not key:
            continue
        amount = float(r.get("contribution_receipt_amount") or 0)
        date = r.get("contribution_receipt_date") or ""
        date = date[:10]
        existing = merged.get(key)
        if existing is None:
            merged[key] = {
                "name": key.title(),
                "total": amount,
                "transactions": 1,
                "latest_date": date,
                "employer": r.get("contributor_employer"),
                "occupation": r.get("contributor_occupation"),
                "city_state": _format_city_state(r),
            }
            continue
        existing["total"] += amount
        existing["transactions"] += 1
        if date > existing["latest_date"]:
            existing["latest_date"] = date
            existing["employer"] = r.get("contributor_employer")
            existing["occupation"] = r.get("contributor_occupation")
            existing["city_state"] = _format_city_state(r)
    rows = sorted(merged.values(), key=lambda d: d["total"], reverse=True)[:_TOP_N]
    return [{**row, "total_fmt": _fmt_money(row["total"])} for row in rows]


def _format_city_state(receipt: dict[str, Any]) -> str:
    city = _title_case_city(receipt.get("contributor_city"))
    state = (receipt.get("contributor_state") or "").upper()
    return ", ".join(part for part in (city, state) if part)
```

NOTE: check `_fmt_money(3500)` output in `mongodb_tools.py` before finalizing the
`total_fmt` assertion — adjust the test's expected string ("$3.5K" vs "$3,500")
to whatever the existing formatter produces. Do not change `_fmt_money`.

- [ ] **Step 4: Run to verify pass** — `uv run pytest tests/unit/test_fec_donors.py -v` → PASS
- [ ] **Step 5: Commit** — `git add agent/app/tools/fec_donors.py agent/tests/unit/test_fec_donors.py && git commit -m "feat(agent): FEC donor dedupe helpers (TDD)"`

---

### Task 2: Agent — FEC client + orchestration impl, TDD

**Files:**
- Modify: `agent/app/tools/fec_donors.py`
- Modify: `agent/tests/unit/test_fec_donors.py`

- [ ] **Step 1: Write failing tests for the impl pipeline**

```python
import json

import httpx

from app.tools.fec_donors import _donors_impl


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.saved: list[dict] = []

    def find_one(self, query, projection=None):
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in query.items()):
                return doc
        return None

    def update_one(self, query, update, upsert=False):
        self.saved.append({"query": query, "set": update["$set"]})


class FakeDb:
    def __init__(self, candidates=None, cache=None):
        self.candidates = FakeCollection(candidates)
        self.fec_donor_cache = cache or FakeCollection()

    def __getitem__(self, name):
        return getattr(self, name)


def _fec_transport(committees=None, receipts=None, search=None, fail=False):
    def handler(request: httpx.Request) -> httpx.Response:
        if fail:
            return httpx.Response(500, json={"error": "boom"})
        path = request.url.path
        if "/committees/" in path:
            return httpx.Response(200, json={"results": committees or []})
        if "/schedules/schedule_a/" in path:
            return httpx.Response(200, json={"results": receipts or []})
        if "/candidates/search/" in path:
            return httpx.Response(200, json={"results": search or []})
        return httpx.Response(404, json={"results": []})

    return httpx.MockTransport(handler)


_MOORE = {"race_key": "2026-H-WI-04", "name": "MOORE, GWEN S",
          "candidate_id": "H4WI04183"}
_COMMITTEE = [{"committee_id": "C00397505", "name": "MOORE FOR CONGRESS"}]


def _rcpt(name, amount):
    return {"contributor_name": name, "contribution_receipt_amount": amount,
            "contribution_receipt_date": "2025-09-19",
            "contributor_employer": "ACME", "contributor_occupation": "CEO",
            "contributor_city": "MADISON", "contributor_state": "WI"}


def test_happy_path_returns_donors_with_committee():
    db = FakeDb(candidates=[_MOORE])
    result = _donors_impl(
        "Gwen Moore", "2026-H-WI-04", db=db,
        transport=_fec_transport(committees=_COMMITTEE,
                                 receipts=[_rcpt("BIG, JO", 3500)]),
    )
    assert result["status"] == "success"
    assert result["data"]["committee"] == "MOORE FOR CONGRESS"
    assert result["data"]["donors"][0]["name"] == "Big, Jo"
    assert result["data"]["cached"] is False
    assert "coverage_note" in result["data"]


def test_candidate_doc_matched_by_partial_name():
    # "Gwen Moore" (natural order) must match FEC-style "MOORE, GWEN S"
    db = FakeDb(candidates=[_MOORE])
    result = _donors_impl(
        "Gwen Moore", "2026-H-WI-04", db=db,
        transport=_fec_transport(committees=_COMMITTEE, receipts=[]),
    )
    assert result["data"]["candidate"] == "MOORE, GWEN S"


def test_fec_search_fallback_when_no_candidate_doc():
    db = FakeDb(candidates=[])  # nothing in Mongo
    result = _donors_impl(
        "Gwen Moore", "2026-H-WI-04", db=db,
        transport=_fec_transport(
            search=[{"candidate_id": "H4WI04183", "name": "MOORE, GWEN S"}],
            committees=_COMMITTEE, receipts=[_rcpt("BIG, JO", 1000)],
        ),
    )
    assert result["status"] == "success"
    assert result["data"]["donors"][0]["total"] == 1000


def test_empty_receipts_returns_honest_empty():
    db = FakeDb(candidates=[_MOORE])
    result = _donors_impl(
        "Gwen Moore", "2026-H-WI-04", db=db,
        transport=_fec_transport(committees=_COMMITTEE, receipts=[]),
    )
    assert result["status"] == "success"
    assert result["data"]["donors"] == []
    assert "Itemized" in result["data"]["coverage_note"]


def test_api_failure_degrades_to_honest_empty_never_raises():
    db = FakeDb(candidates=[_MOORE])
    result = _donors_impl(
        "Gwen Moore", "2026-H-WI-04", db=db, transport=_fec_transport(fail=True),
    )
    assert result["status"] == "success"
    assert result["data"]["donors"] == []


def test_cache_hit_skips_fec_api():
    cached_data = {"candidate": "MOORE, GWEN S", "committee": "MOORE FOR CONGRESS",
                   "cycle": 2026, "retrieved_at": "2026-06-10T20:00:00+00:00",
                   "cached": False, "donors": [], "coverage_note": "x"}
    from datetime import datetime, timezone
    cache = FakeCollection([{
        "key": "donors:2026-H-WI-04:H4WI04183",
        "data": cached_data,
        "retrieved_at": datetime.now(timezone.utc),
    }])
    db = FakeDb(candidates=[_MOORE], cache=cache)

    def explode(_req):
        raise AssertionError("FEC API must not be called on cache hit")

    result = _donors_impl("Gwen Moore", "2026-H-WI-04", db=db,
                          transport=httpx.MockTransport(explode))
    assert result["data"]["cached"] is True


def test_result_written_to_cache():
    db = FakeDb(candidates=[_MOORE])
    _donors_impl("Gwen Moore", "2026-H-WI-04", db=db,
                 transport=_fec_transport(committees=_COMMITTEE,
                                          receipts=[_rcpt("BIG, JO", 500)]))
    assert db.fec_donor_cache.saved
    assert db.fec_donor_cache.saved[0]["query"]["key"] == \
        "donors:2026-H-WI-04:H4WI04183"
```

- [ ] **Step 2: Run to verify failure** — `uv run pytest tests/unit/test_fec_donors.py -v` → new tests FAIL (`_donors_impl` missing)

- [ ] **Step 3: Implement `_donors_impl` + FEC client calls in `fec_donors.py`**

```python
def _http_get(path: str, params: dict[str, Any],
              transport: httpx.BaseTransport | None) -> list[dict[str, Any]]:
    """GET an FEC endpoint; returns results list, [] on any failure."""
    try:
        with httpx.Client(base_url=_FEC_BASE, timeout=_TIMEOUT_S,
                          transport=transport) as client:
            resp = client.get(path, params={**params, "api_key": _api_key()})
            resp.raise_for_status()
            return resp.json().get("results") or []
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
    tokens = {t for t in _normalize_name(candidate_name).replace(",", " ").split()}
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


def _empty(candidate: str, committee: str | None, cached: bool,
           note: str = _COVERAGE_NOTE) -> dict[str, Any]:
    return _envelope(candidate, committee, [], cached, note)


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


def _donors_impl(candidate_name: str, race_key: str, *,
                 db: Any | None = None,
                 transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    if db is None:
        try:
            db = _get_db()
        except Exception as exc:
            logger.error("fec_donors: no database: %s", exc)
            return _empty(candidate_name, None, False)

    doc = _find_candidate_doc(db, race_key, candidate_name)
    if doc is None or not doc.get("candidate_id"):
        doc = _search_fec_candidate(candidate_name, race_key, transport)
    if doc is None or not doc.get("candidate_id"):
        return _empty(candidate_name, None, False,
                      f"No FEC candidate record found for {candidate_name}. "
                      + _COVERAGE_NOTE)

    fec_id = doc["candidate_id"]
    resolved_name = doc.get("name") or candidate_name
    cache_key = f"donors:{race_key}:{fec_id}"

    cached_doc = _cache_get(db, cache_key)
    if cached_doc is not None:
        data = {**cached_doc, "cached": True}
        return {"status": "success", "data": data, "source": _SOURCE}

    committees = _http_get(f"/candidate/{fec_id}/committees/",
                           {"designation": "P", "per_page": 5}, transport)
    if not committees:
        return _empty(resolved_name, None, False,
                      f"No principal campaign committee on file for "
                      f"{resolved_name}. " + _COVERAGE_NOTE)
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
```

NOTE: `_find_candidate_doc` uses `db.candidates.find(...)` (cursor) — extend
`FakeCollection` in the test file with a `find(query, projection=None)` method
returning a list of matching docs (same `all(...)` matching as `find_one`).

- [ ] **Step 4: Run to verify pass** — `uv run pytest tests/unit/test_fec_donors.py -v` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(agent): FEC donors impl — committee resolution, receipts, cache (TDD)"`

---

### Task 3: Agent — public tool + registration

**Files:**
- Modify: `agent/app/tools/fec_donors.py` (append)
- Modify: `agent/app/agent.py` (import + `_build_tools` list)
- Modify: `agent/tests/unit/test_fec_donors.py` (registration test)

- [ ] **Step 1: Write failing test**

```python
def test_tool_is_registered_on_chat_agent():
    from app.agent import _build_tools
    from app.tools.fec_donors import get_individual_donors
    assert get_individual_donors in _build_tools()


def test_tool_docstring_carries_guardrail_and_routing():
    from app.tools.fec_donors import get_individual_donors
    doc = get_individual_donors.__doc__ or ""
    assert "largest individual donors" in doc.lower()
    assert "never" in doc.lower() and "position" in doc.lower()
```

- [ ] **Step 2: Run to verify failure** — `uv run pytest tests/unit/test_fec_donors.py -v` → FAIL

- [ ] **Step 3: Implement the public tool (append to `fec_donors.py`)**

```python
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
```

In `agent/app/agent.py`: add `from app.tools.fec_donors import get_individual_donors`
(alphabetical with the other `app.tools` imports) and append `get_individual_donors,`
to the `tools` list in `_build_tools()` after `search_candidate_positions`.

- [ ] **Step 4: Run module tests then full agent suite**

Run: `uv run pytest tests/unit/test_fec_donors.py -v` → PASS
Run: `uv run pytest` → ALL PASS (~390+)

- [ ] **Step 5: Commit** — `git commit -m "feat(agent): register get_individual_donors chat tool"`

---

### Task 4: Web — DonorContributionsCard, TDD

**Files:**
- Create: `web/src/components/canvas/DonorContributionsCard.tsx`
- Test: `web/src/components/canvas/__tests__/DonorContributionsCard.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DonorContributionsCard,
  type DonorRow,
} from "../DonorContributionsCard";

const klein: DonorRow = {
  name: "Klein, Dennis J",
  employer: "CD SMITH",
  occupation: "EXECUTIVE",
  city_state: "Milwaukee, WI",
  total: 6600,
  total_fmt: "$6.6K",
  transactions: 2,
  latest_date: "2025-09-22",
};

const tribe: DonorRow = {
  name: "Yocha Dehe Wintun Nation",
  employer: null,
  occupation: null,
  city_state: "Brooks, CA",
  total: 3500,
  total_fmt: "$3.5K",
  transactions: 1,
  latest_date: "2025-09-19",
};

test("loading state shows status message", () => {
  render(<DonorContributionsCard loading donors={[]} />);
  expect(screen.getByText(/Pulling FEC contribution records/i)).toBeInTheDocument();
});

test("renders donor names and formatted amounts", () => {
  render(<DonorContributionsCard candidate="Moore, Gwen S" donors={[klein, tribe]} />);
  expect(screen.getByText("Klein, Dennis J")).toBeInTheDocument();
  expect(screen.getByText("$6.6K")).toBeInTheDocument();
  expect(screen.getByText("$3.5K")).toBeInTheDocument();
});

test("shows employer · occupation when present, hides when absent", () => {
  render(<DonorContributionsCard donors={[klein, tribe]} />);
  expect(screen.getByText(/CD SMITH · EXECUTIVE/i)).toBeInTheDocument();
});

test("shows contribution count only when more than one", () => {
  render(<DonorContributionsCard donors={[klein, tribe]} />);
  expect(screen.getByText(/2 contributions/i)).toBeInTheDocument();
  expect(screen.queryByText(/1 contributions/i)).not.toBeInTheDocument();
});

test("guardrail footer always visible", () => {
  render(<DonorContributionsCard donors={[klein]} />);
  expect(
    screen.getByText(/do not establish a candidate's policy positions/i),
  ).toBeInTheDocument();
});

test("guardrail footer visible even on empty state", () => {
  render(<DonorContributionsCard donors={[]} coverageNote="No itemized receipts." />);
  expect(
    screen.getByText(/do not establish a candidate's policy positions/i),
  ).toBeInTheDocument();
});

test("empty state renders coverage note, no rows", () => {
  render(<DonorContributionsCard donors={[]} coverageNote="No itemized receipts." />);
  expect(screen.getByText(/No itemized receipts/i)).toBeInTheDocument();
});

test("source footer shows retrieved date", () => {
  render(
    <DonorContributionsCard donors={[klein]} retrievedAt="2026-06-10T21:00:00+00:00" />,
  );
  expect(screen.getByText(/Source: FEC API · retrieved 2026-06-10/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure** — `cd web && npx vitest run src/components/canvas/__tests__/DonorContributionsCard.test.tsx` → FAIL

- [ ] **Step 3: Implement the card**

```tsx
"use client";

/**
 * DonorContributionsCard — inline generative-UI card for the
 * `get_individual_donors` backend tool. Shows the largest itemized individual
 * contributions for one candidate, FEC live data. Visual language clones
 * FinanceToolCard (dark tokens, 2px borders, mono amounts).
 *
 * Civic guardrail: the footer disclaimer is unconditional — donor data is
 * context, never proof of positions (.claude/rules/civic_safety.md).
 */

export interface DonorRow {
  name: string;
  employer?: string | null;
  occupation?: string | null;
  city_state?: string;
  total: number;
  total_fmt?: string;
  transactions: number;
  latest_date?: string;
}

interface DonorContributionsCardProps {
  candidate?: string;
  donors: DonorRow[];
  coverageNote?: string;
  retrievedAt?: string;
  loading?: boolean;
}

const GUARDRAIL =
  "Public FEC record. Contributions provide context — they do not establish a candidate's policy positions.";

export function DonorContributionsCard({
  candidate,
  donors,
  coverageNote,
  retrievedAt,
  loading,
}: DonorContributionsCardProps) {
  if (loading) {
    return (
      <div className="my-2 rounded-[2px] border-2 border-edge-strong bg-surface-raised p-3">
        <p className="text-xs font-medium uppercase tracking-widest text-ink-muted">
          Largest Individual Contributions · FEC
        </p>
        <p className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
          <span className="animate-spin">⟳</span> Pulling FEC contribution records…
        </p>
      </div>
    );
  }

  const maxTotal = Math.max(...donors.map((d) => d.total), 1);
  const retrievedDate = retrievedAt?.slice(0, 10);

  return (
    <div className="my-2 space-y-3 rounded-[2px] border-2 border-edge-strong bg-surface-raised p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-widest text-ink-muted">
          Largest Individual Contributions · FEC
        </p>
        {candidate && (
          <span className="truncate text-xs font-medium text-ink">{candidate}</span>
        )}
      </div>

      {donors.length === 0 ? (
        <p className="text-xs italic text-ink-muted">
          {coverageNote ?? "No itemized individual contributions found."}
        </p>
      ) : (
        donors.map((d) => (
          <div key={d.name} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium text-ink">{d.name}</span>
              <span className="shrink-0 font-mono text-sm font-bold text-ink">
                {d.total_fmt ?? `$${d.total.toLocaleString()}`}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-sm border border-edge bg-surface-hover">
              <div
                className="h-full bg-blue-500 transition-all duration-700"
                style={{ width: `${(d.total / maxTotal) * 100}%` }}
              />
            </div>
            <div className="flex flex-wrap gap-x-3 text-[10px] text-ink-faint">
              {(d.employer || d.occupation) && (
                <span>
                  {[d.employer, d.occupation].filter(Boolean).join(" · ")}
                </span>
              )}
              {d.city_state && <span>{d.city_state}</span>}
              {d.transactions > 1 && <span>{d.transactions} contributions</span>}
              {d.latest_date && <span className="ml-auto">{d.latest_date}</span>}
            </div>
          </div>
        ))
      )}

      <div className="space-y-1 border-t border-edge pt-2">
        <p className="text-[10px] text-ink-faint">
          Source: FEC API{retrievedDate ? ` · retrieved ${retrievedDate}` : ""}
        </p>
        <p className="text-[10px] italic text-ink-faint">{GUARDRAIL}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/components/canvas/__tests__/DonorContributionsCard.test.tsx` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(web): DonorContributionsCard generative card (TDD)"`

---

### Task 5: Web — register card in AgentToolTrace

**Files:**
- Modify: `web/src/components/canvas/AgentToolTrace.tsx`

- [ ] **Step 1: Add the registration** (after the `get_race_finance_brief` block, before BALLOTPEDIA_TOOLS loop)

```tsx
  // Rich card for the live FEC individual-donors tool.
  useRenderToolCall({
    name: "get_individual_donors",
    parameters: [
      { name: "candidate_name", type: "string", required: true },
      { name: "race_key", type: "string", required: true },
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render: (props: any) => {
      if (props.status !== "complete") {
        return <DonorContributionsCard loading donors={[]} />;
      }
      let parsed: unknown = props.result;
      if (typeof parsed === "string") {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          parsed = {};
        }
      }
      const data = ((parsed ?? {}) as {
        data?: {
          candidate?: string;
          donors?: DonorRow[];
          coverage_note?: string;
          retrieved_at?: string;
        };
      }).data ?? {};
      return (
        <DonorContributionsCard
          candidate={data.candidate}
          donors={data.donors ?? []}
          coverageNote={data.coverage_note}
          retrievedAt={data.retrieved_at}
        />
      );
    },
  });
```

Import at top: `import { DonorContributionsCard, type DonorRow } from "./DonorContributionsCard";`

- [ ] **Step 2: Run full web suite** — `npx vitest run --maxWorkers=4 --testTimeout=20000` → ALL PASS (~308+); also `npx tsc --noEmit` and `npm run lint` if quick
- [ ] **Step 3: Commit** — `git commit -m "feat(web): register donor card in AgentToolTrace"`

---

### Task 6: Deploy + live verification

- [ ] **Step 1: Deploy agent** — `gcloud run deploy districtlens-agent --source agent --region us-central1 --project civicsync-440613`
- [ ] **Step 2: Smoke agent revision is serving** (gcloud describe; logs clean)
- [ ] **Step 3: Deploy web** — `gcloud run deploy districtlens-web --source web --region us-central1 --project civicsync-440613`
- [ ] **Step 4: Prod dogfood** — open the web URL, ask "Who are Gwen Moore's largest individual donors?" — verify skeleton → card with rows, guardrail footer, FEC source line. Verify `fec_donor_cache` got a doc (live Mongo script per Clerk-verification memory if needed; voter chat is public so headless browse works).
- [ ] **Step 5: Push** — `git push origin main`

---

## Self-review notes

- Spec coverage: D1 (one tool, one card) Tasks 1-5; D2 (transaction-level + dedupe) Task 1-2; D3 (agent tool + useRenderToolCall) Tasks 3+5; cache Task 2; guardrails Task 3 docstring + Task 4 footer; honest-empty Tasks 2+4; deploy Task 6. Out-of-scope items absent. ✓
- `_fmt_money` output format must be checked in Task 1 Step 3 (note inline). ✓
- Type consistency: `DonorRow` fields match the agent envelope (`name`, `employer`, `occupation`, `city_state`, `total`, `total_fmt`, `transactions`, `latest_date`). ✓
- `FakeCollection.find` needed for `_find_candidate_doc` — noted in Task 2. ✓
