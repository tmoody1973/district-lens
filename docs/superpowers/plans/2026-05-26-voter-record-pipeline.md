# Voter Brief — Incumbent Voting Record Pipeline (House) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface every House incumbent's **vote attendance %** and **party-line voting %** in the voter brief's record section — computed from real Congress.gov roll-call votes, never generated.

**Architecture:** A new Python ingest script (`agent/scripts/ingest_house_votes.py`) pulls 119th-Congress / 2nd-session House roll-call votes from the Congress.gov API (per-member endpoint, live since Dec 2025), stores raw per-member rows in `member_votes`, and writes a computed `voting_record_summaries` doc per incumbent. A pure metrics module (`agent/app/tools/voting_metrics.py`) does the math so it is unit-tested in isolation. A new agent tool `get_voting_record` reads the summary and pushes `tool_context.state["votingRecord"]`; the deterministic `VoterBriefPipeline` calls it as a fixed step. The frontend adds a `votingRecord` field to `DistrictLensState` and renders a `VotingRecordCard` in the record section above the existing bill feed.

**Tech Stack:** Python 3.11 / pymongo / httpx / pytest (agent side); TypeScript / React / Vitest / Testing Library (web side). Mongo db `districtlens`. Gemini pin unchanged.

**Civic-safety spine:** Attendance % and party-line % are *computed from verified roll-call rows*, stored with `source_url`/`source_system`/`fetched_at`/`as_of_date`, and labeled as voting behavior — never policy positions. When a member has no party-split votes yet, party-line renders as an explicit gap ("Not enough party-split votes yet"), never a fabricated 0%.

**Scope note:** House only. Senate roll-call votes come from Senate.gov LIS XML (no API) and are a separate Wave-2 plan. Competitiveness and outside-money are their own Wave-1 plans.

---

## Data shapes (defined once, referenced by every task)

**`member_votes` collection** — raw evidence, one doc per (bioguide_id, congress, session, roll_call):
```
{ bioguide_id, member_name, race_key_2026, congress: 119, session: 2,
  roll_call: int, position: "Yea"|"Nay"|"Present"|"Not Voting",
  member_party: "DEM"|"REP"|"IND", question: str, result: str, vote_date: "YYYY-MM-DD",
  dem_majority: "Yea"|"Nay"|None, rep_majority: "Yea"|"Nay"|None, party_split: bool,
  source_url, source_system: "congress_gov_api", import_batch_id, ingested_at }
```

**`voting_record_summaries` collection** — computed, one doc per (bioguide_id, congress):
```
{ bioguide_id, race_key_2026, member_name, congress: 119,
  total_roll_calls, votes_cast, votes_missed, attendance_pct: float,
  party_line_eligible, party_line_with_party, party_line_pct: float|None,
  as_of_date: "YYYY-MM-DD", source_url, source_system: "congress_gov_api",
  import_batch_id, ingested_at, last_checked_at, stale_after, freshness_status }
```

**`VotingRecordSummary` (frontend, camelCase)** — the shape `get_voting_record` pushes to canvas state:
```ts
{ memberName: string; congress: string; attendancePct: number;
  partyLinePct: number | null; votesCast: number; votesMissed: number;
  totalRollCalls: number; asOfDate: string | null; sourceUrl: string; }
```

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `agent/app/tools/voting_metrics.py` | Pure functions: party-majority detection + attendance/party-line math | Create |
| `agent/tests/unit/test_voting_metrics.py` | Unit tests for the pure math | Create |
| `agent/scripts/ingest_house_votes.py` | Congress.gov House-vote ingest → `member_votes` + `voting_record_summaries` | Create |
| `agent/tests/unit/test_ingest_house_votes.py` | Test the payload-parsing + per-vote aggregation (no network) | Create |
| `agent/tests/unit/fixtures/house_vote_members_sample.json` | Real captured Congress.gov members payload | Create |
| `agent/app/tools/mongodb_tools.py` | Add `get_voting_record` tool + `fetch_voting_record` async core + `_to_voting_record` transform | Modify |
| `agent/tests/unit/test_voting_record_tool.py` | Test the tool envelope + state push + not_found | Create |
| `agent/app/agent.py` | Register `get_voting_record` in `_build_tools()` | Modify (`:37-43`, `:72-82`) |
| `agent/app/tools/brief_pipeline.py` | Add deterministic voting-record step | Modify (`:26-30`, `:127-133`) |
| `web/src/types/agent-state.ts` | Add `VotingRecordSummary` + `votingRecord` field + default | Modify (`:51-57`, `:91-125`) |
| `web/src/components/canvas/VotingRecordCard.tsx` | Render attendance/party-line with honest gap | Create |
| `web/src/components/canvas/__tests__/VotingRecordCard.test.tsx` | Component test | Create |
| `web/src/components/canvas/RaceCanvas.tsx` | Render `VotingRecordCard` in the `record` case | Modify (`:55-62`) |
| `web/src/lib/brief-layout.ts` | Include `record` section when a voting record exists (not just bills) | Modify (`:134-142`) |
| `web/src/lib/__tests__/brief-layout.test.ts` | Cover the new record-inclusion path | Modify |

---

## Task 1: Pure voting-metrics math

**Files:**
- Create: `agent/app/tools/voting_metrics.py`
- Test: `agent/tests/unit/test_voting_metrics.py`

- [ ] **Step 1: Write the failing test**

```python
# agent/tests/unit/test_voting_metrics.py
from app.tools.voting_metrics import MemberVoteContext, compute_metrics, party_majority


def test_party_majority_picks_higher_count():
    assert party_majority(["Yea", "Yea", "Nay"]) == "Yea"
    assert party_majority(["Nay", "Nay", "Yea"]) == "Nay"


def test_party_majority_none_when_no_votes():
    assert party_majority(["Not Voting", "Present"]) is None


def test_attendance_counts_present_as_cast_not_missed():
    ctxs = [
        MemberVoteContext("Yea", "Yea", True),
        MemberVoteContext("Present", "Yea", True),
        MemberVoteContext("Not Voting", "Nay", True),
    ]
    m = compute_metrics(ctxs)
    assert m["total_roll_calls"] == 3
    assert m["votes_cast"] == 2          # Yea + Present
    assert m["votes_missed"] == 1        # Not Voting
    assert m["attendance_pct"] == 66.7


def test_party_line_only_counts_party_split_yea_nay_votes():
    ctxs = [
        MemberVoteContext("Yea", "Yea", True),    # with party, eligible
        MemberVoteContext("Nay", "Yea", True),    # against party, eligible
        MemberVoteContext("Yea", "Yea", False),   # not party-split → ignored
        MemberVoteContext("Present", "Yea", True),# Present not Yea/Nay → ignored
    ]
    m = compute_metrics(ctxs)
    assert m["party_line_eligible"] == 2
    assert m["party_line_with_party"] == 1
    assert m["party_line_pct"] == 50.0


def test_party_line_is_none_when_no_eligible_votes():
    ctxs = [MemberVoteContext("Yea", "Yea", False)]
    m = compute_metrics(ctxs)
    assert m["party_line_pct"] is None      # honest gap, never a fake 0
    assert m["party_line_eligible"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent && uv run pytest tests/unit/test_voting_metrics.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.tools.voting_metrics'`

- [ ] **Step 3: Write minimal implementation**

```python
# agent/app/tools/voting_metrics.py
"""Pure voting-record math for House roll-call votes.

No I/O, no network — fed parsed positions, returns attendance % and
party-line %. party_line_pct is None (not 0) when a member has no
party-split Yea/Nay votes, so the brief can render an honest gap.
"""

from __future__ import annotations

from dataclasses import dataclass

_CAST = {"Yea", "Nay", "Present"}
_DECISIVE = {"Yea", "Nay"}


@dataclass(frozen=True)
class MemberVoteContext:
    """One member's situation on one roll call."""
    position: str            # "Yea" | "Nay" | "Present" | "Not Voting"
    own_party_majority: str  # that member's party's majority position
    party_split: bool        # did the two major parties' majorities differ?


def party_majority(positions: list[str]) -> str | None:
    """The majority Yea/Nay position among a party's members, or None."""
    yea = positions.count("Yea")
    nay = positions.count("Nay")
    if yea == 0 and nay == 0:
        return None
    return "Yea" if yea >= nay else "Nay"


def compute_metrics(contexts: list[MemberVoteContext]) -> dict:
    """Attendance % and party-line % for one member across many votes."""
    total = len(contexts)
    cast = sum(1 for c in contexts if c.position in _CAST)
    missed = total - cast
    attendance = round(100 * cast / total, 1) if total else 0.0

    eligible = [c for c in contexts if c.party_split and c.position in _DECISIVE]
    with_party = sum(1 for c in eligible if c.position == c.own_party_majority)
    party_line = round(100 * with_party / len(eligible), 1) if eligible else None

    return {
        "total_roll_calls": total,
        "votes_cast": cast,
        "votes_missed": missed,
        "attendance_pct": attendance,
        "party_line_eligible": len(eligible),
        "party_line_with_party": with_party,
        "party_line_pct": party_line,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent && uv run pytest tests/unit/test_voting_metrics.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add agent/app/tools/voting_metrics.py agent/tests/unit/test_voting_metrics.py
git commit -m "feat(agent): pure voting-metrics math (attendance %, party-line %)"
```

---

## Task 2: House-votes ingest script

**Files:**
- Create: `agent/scripts/ingest_house_votes.py`
- Create: `agent/tests/unit/test_ingest_house_votes.py`
- Create: `agent/tests/unit/fixtures/house_vote_members_sample.json`

- [ ] **Step 1: Capture a real Congress.gov members payload as a fixture**

The exact JSON keys must come from the live API, not memory. Register a free key at https://api.congress.gov/sign-up/, then capture one vote's member list:

Run (replace KEY; vote 1 of 119th Congress 2nd session):
```bash
curl -s "https://api.congress.gov/v3/house-vote/119/2/1/members?api_key=KEY&format=json" \
  -o agent/tests/unit/fixtures/house_vote_members_sample.json
```
Open the file and confirm the path to the member array and the field names for bioguide id, vote position ("Yea"/"Nay"/"Present"/"Not Voting"), and party. The implementation in Step 3 uses `_parse_members` — adjust its key names to match this captured sample if they differ.

- [ ] **Step 2: Write the failing test**

```python
# agent/tests/unit/test_ingest_house_votes.py
import json
from pathlib import Path

from scripts.ingest_house_votes import _parse_members, aggregate_vote

FIXTURE = Path(__file__).parent / "fixtures" / "house_vote_members_sample.json"


def test_parse_members_returns_bioguide_position_party():
    payload = json.loads(FIXTURE.read_text())
    members = _parse_members(payload)
    assert len(members) > 100                      # a real House vote
    sample = members[0]
    assert set(sample) >= {"bioguide_id", "position", "party"}
    assert sample["position"] in {"Yea", "Nay", "Present", "Not Voting"}


def test_aggregate_vote_computes_party_majorities_and_split():
    members = [
        {"bioguide_id": "D1", "position": "Yea", "party": "DEM"},
        {"bioguide_id": "D2", "position": "Yea", "party": "DEM"},
        {"bioguide_id": "R1", "position": "Nay", "party": "REP"},
        {"bioguide_id": "R2", "position": "Nay", "party": "REP"},
    ]
    agg = aggregate_vote(members)
    assert agg["dem_majority"] == "Yea"
    assert agg["rep_majority"] == "Nay"
    assert agg["party_split"] is True


def test_aggregate_vote_not_split_when_parties_agree():
    members = [
        {"bioguide_id": "D1", "position": "Yea", "party": "DEM"},
        {"bioguide_id": "R1", "position": "Yea", "party": "REP"},
    ]
    agg = aggregate_vote(members)
    assert agg["party_split"] is False
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd agent && uv run pytest tests/unit/test_ingest_house_votes.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.ingest_house_votes'`

- [ ] **Step 4: Write minimal implementation**

```python
# agent/scripts/ingest_house_votes.py
"""Congress.gov House roll-call vote ingest (119th Congress, 2nd session = 2026).

Per-member House votes are available from the Congress.gov API as of Dec 2025.
For each roll call we fetch the full member list (to compute each party's
majority and whether the vote was party-split), store raw rows for the
2026-relevant House incumbents in `member_votes`, then write a computed
`voting_record_summaries` doc per incumbent.

Run:
  cd agent && CONGRESS_API_KEY=... uv run python scripts/ingest_house_votes.py
"""

from __future__ import annotations

import logging
import os
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pymongo
from dotenv import load_dotenv
from pymongo import UpdateOne

from app.tools.voting_metrics import MemberVoteContext, compute_metrics, party_majority

load_dotenv(Path(__file__).parent.parent / "app" / ".env")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

CONGRESS_API_BASE = "https://api.congress.gov/v3"
CONGRESS = 119
SESSION = 2
CYCLE = "2026"
_PARTY = {"Democratic": "DEM", "Republican": "REP", "Independent": "IND"}


def _party_abbr(raw: str) -> str:
    return _PARTY.get(raw, (raw or "")[:3].upper())


def _parse_members(payload: dict) -> list[dict]:
    """Extract [{bioguide_id, position, party}] from a /members API payload.

    NOTE: confirm these keys against the captured fixture and adjust if the
    live API nests them differently.
    """
    container = payload.get("houseRollCallVoteMemberVotes", payload)
    rows = container.get("results", container.get("members", []))
    members: list[dict] = []
    for r in rows:
        bioguide = r.get("bioguide") or r.get("bioguideId") or ""
        if not bioguide:
            continue
        members.append({
            "bioguide_id": bioguide,
            "position": (r.get("voteCast") or r.get("vote") or "").strip(),
            "party": _party_abbr(r.get("voteParty") or r.get("party") or ""),
        })
    return members


def aggregate_vote(members: list[dict]) -> dict:
    """Compute each party's majority position and whether the vote was split."""
    dem = [m["position"] for m in members if m["party"] == "DEM"]
    rep = [m["position"] for m in members if m["party"] == "REP"]
    dem_maj = party_majority(dem)
    rep_maj = party_majority(rep)
    return {
        "dem_majority": dem_maj,
        "rep_majority": rep_maj,
        "party_split": bool(dem_maj and rep_maj and dem_maj != rep_maj),
    }


def _own_party_majority(party: str, agg: dict) -> str | None:
    if party == "DEM":
        return agg["dem_majority"]
    if party == "REP":
        return agg["rep_majority"]
    return None


def _get_db(uri: str) -> pymongo.database.Database:
    return pymongo.MongoClient(uri)["districtlens"]


def _incumbents(db: pymongo.database.Database) -> dict[str, dict]:
    """2026-relevant House incumbents keyed by bioguide_id."""
    cur = db["legislator_profiles"].find(
        {"chamber": "house", "race_key_2026": {"$exists": True, "$ne": None}},
        {"_id": 0, "bioguide_id": 1, "name": 1, "race_key_2026": 1},
    )
    return {p["bioguide_id"]: p for p in cur}


def _list_vote_numbers(client: httpx.Client, api_key: str) -> list[dict]:
    votes: list[dict] = []
    offset = 0
    while True:
        resp = client.get(
            f"{CONGRESS_API_BASE}/house-vote/{CONGRESS}/{SESSION}",
            params={"limit": 100, "offset": offset, "api_key": api_key, "format": "json"},
        )
        resp.raise_for_status()
        page = resp.json().get("houseRollCallVotes", []) or []
        if not page:
            break
        votes.extend(page)
        offset += 100
        time.sleep(0.5)
    return votes


def run_import(mongo_uri: str, api_key: str) -> dict[str, int]:
    now = datetime.now(UTC)
    batch_id = now.strftime("house-votes-%Y%m%d-%H%M%S")
    db = _get_db(mongo_uri)
    incumbents = _incumbents(db)
    logger.info("Tracking %d 2026-relevant House incumbents", len(incumbents))

    member_votes = db["member_votes"]
    member_votes.create_index([("bioguide_id", 1), ("congress", 1)])
    member_votes.create_index(
        [("bioguide_id", 1), ("congress", 1), ("session", 1), ("roll_call", 1)],
        unique=True,
    )

    # Accumulate per-incumbent contexts for the summary computation.
    contexts: dict[str, list[MemberVoteContext]] = {b: [] for b in incumbents}
    latest_date: dict[str, str] = {}
    raw_ops: list[UpdateOne] = []

    with httpx.Client(timeout=30, follow_redirects=True) as client:
        votes = _list_vote_numbers(client, api_key)
        logger.info("Found %d House roll calls for %d-%d", len(votes), CONGRESS, SESSION)

        for v in votes:
            roll_call = v.get("rollCallNumber") or v.get("voteNumber")
            if roll_call is None:
                continue
            try:
                resp = client.get(
                    f"{CONGRESS_API_BASE}/house-vote/{CONGRESS}/{SESSION}/{roll_call}/members",
                    params={"api_key": api_key, "format": "json"},
                )
                if resp.status_code == 429:
                    time.sleep(60)
                    continue
                resp.raise_for_status()
                members = _parse_members(resp.json())
            except httpx.HTTPError as exc:
                logger.warning("vote %s fetch failed: %s", roll_call, exc)
                continue

            agg = aggregate_vote(members)
            vote_date = (v.get("startDate") or v.get("date") or "")[:10]
            question = (v.get("voteQuestion") or v.get("question") or "")[:300]
            result = v.get("result") or ""
            source_url = (
                f"https://www.congress.gov/roll-call-vote/{CONGRESS}-{SESSION}/{roll_call}"
            )

            for m in members:
                bg = m["bioguide_id"]
                if bg not in incumbents:
                    continue
                own_maj = _own_party_majority(m["party"], agg)
                contexts[bg].append(
                    MemberVoteContext(
                        position=m["position"],
                        own_party_majority=own_maj or "",
                        party_split=agg["party_split"] and own_maj is not None,
                    )
                )
                if vote_date > latest_date.get(bg, ""):
                    latest_date[bg] = vote_date
                raw_ops.append(UpdateOne(
                    {"bioguide_id": bg, "congress": CONGRESS,
                     "session": SESSION, "roll_call": roll_call},
                    {"$set": {
                        "bioguide_id": bg,
                        "member_name": incumbents[bg]["name"],
                        "race_key_2026": incumbents[bg]["race_key_2026"],
                        "congress": CONGRESS, "session": SESSION, "roll_call": roll_call,
                        "position": m["position"], "member_party": m["party"],
                        "question": question, "result": result, "vote_date": vote_date,
                        "dem_majority": agg["dem_majority"], "rep_majority": agg["rep_majority"],
                        "party_split": agg["party_split"],
                        "source_url": source_url, "source_system": "congress_gov_api",
                        "import_batch_id": batch_id, "ingested_at": now,
                    }},
                    upsert=True,
                ))
            time.sleep(0.4)

    if raw_ops:
        member_votes.bulk_write(raw_ops, ordered=False)

    # Write computed summaries.
    summaries = db["voting_record_summaries"]
    summaries.create_index([("bioguide_id", 1), ("congress", 1)], unique=True)
    summaries.create_index([("race_key_2026", 1)])
    stale_after = now + timedelta(days=2)
    summary_ops: list[UpdateOne] = []
    for bg, ctxs in contexts.items():
        if not ctxs:
            continue
        metrics = compute_metrics(ctxs)
        summary_ops.append(UpdateOne(
            {"bioguide_id": bg, "congress": CONGRESS},
            {"$set": {
                "bioguide_id": bg,
                "race_key_2026": incumbents[bg]["race_key_2026"],
                "member_name": incumbents[bg]["name"],
                "congress": CONGRESS,
                **metrics,
                "as_of_date": latest_date.get(bg),
                "source_url": (
                    f"https://www.congress.gov/roll-call-votes/{CONGRESS}-{SESSION}"
                ),
                "source_system": "congress_gov_api",
                "import_batch_id": batch_id, "ingested_at": now,
                "last_checked_at": now, "stale_after": stale_after,
                "freshness_status": "fresh",
            }, "$setOnInsert": {"created_at": now}},
            upsert=True,
        ))
    if summary_ops:
        summaries.bulk_write(summary_ops, ordered=False)

    db["official_import_batches"].insert_one({
        "batch_id": batch_id, "source_system": "congress_gov_api_house_votes",
        "counts": {"raw_votes": len(raw_ops), "summaries": len(summary_ops)},
        "started_at": now, "completed_at": datetime.now(UTC), "status": "completed",
    })
    logger.info("Done: %d raw rows, %d summaries", len(raw_ops), len(summary_ops))
    return {"raw_votes": len(raw_ops), "summaries": len(summary_ops)}


if __name__ == "__main__":
    uri = os.environ.get("MONGODB_URI")
    key = os.environ.get("CONGRESS_API_KEY", "")
    if not uri or not key:
        logger.error("MONGODB_URI and CONGRESS_API_KEY must be set")
        sys.exit(1)
    print(run_import(uri, key))
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd agent && uv run pytest tests/unit/test_ingest_house_votes.py -v`
Expected: PASS (3 tests). If `test_parse_members_*` fails on key names, fix `_parse_members` to match the captured fixture, then re-run.

- [ ] **Step 6: Commit**

```bash
git add agent/scripts/ingest_house_votes.py agent/tests/unit/test_ingest_house_votes.py agent/tests/unit/fixtures/house_vote_members_sample.json
git commit -m "feat(agent): House roll-call vote ingest with party-split aggregation"
```

---

## Task 3: `get_voting_record` agent tool

**Files:**
- Modify: `agent/app/tools/mongodb_tools.py` (add transform, async core, tool)
- Create: `agent/tests/unit/test_voting_record_tool.py`

- [ ] **Step 1: Write the failing test**

```python
# agent/tests/unit/test_voting_record_tool.py
from unittest.mock import MagicMock, patch

from app.tools import mongodb_tools


def _summary_doc():
    return {
        "member_name": "Jane Rep", "congress": 119,
        "attendance_pct": 97.5, "party_line_pct": 92.0,
        "votes_cast": 390, "votes_missed": 10, "total_roll_calls": 400,
        "as_of_date": "2026-05-20",
        "source_url": "https://www.congress.gov/roll-call-votes/119-2",
    }


def test_to_voting_record_camelcase():
    out = mongodb_tools._to_voting_record(_summary_doc())
    assert out["memberName"] == "Jane Rep"
    assert out["attendancePct"] == 97.5
    assert out["partyLinePct"] == 92.0
    assert out["congress"] == "119th"


def test_get_voting_record_pushes_state_and_returns_success():
    fake_db = MagicMock()
    fake_db.voting_record_summaries.find_one.return_value = _summary_doc()
    ctx = MagicMock()
    ctx.state = {}
    with patch.object(mongodb_tools, "_get_db", return_value=fake_db):
        res = mongodb_tools.get_voting_record("2026-H-WI-04", ctx)
    assert res["status"] == "success"
    assert ctx.state["votingRecord"]["attendancePct"] == 97.5


def test_get_voting_record_not_found_when_no_summary():
    fake_db = MagicMock()
    fake_db.voting_record_summaries.find_one.return_value = None
    ctx = MagicMock()
    ctx.state = {}
    with patch.object(mongodb_tools, "_get_db", return_value=fake_db):
        res = mongodb_tools.get_voting_record("2026-H-WI-04", ctx)
    assert res["status"] == "not_found"
    assert "votingRecord" not in ctx.state
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent && uv run pytest tests/unit/test_voting_record_tool.py -v`
Expected: FAIL — `AttributeError: module 'app.tools.mongodb_tools' has no attribute '_to_voting_record'`

- [ ] **Step 3: Add implementation to `agent/app/tools/mongodb_tools.py`**

Add this constant near `CONGRESS_SOURCE` (`:41`):
```python
HOUSE_VOTES_SOURCE = "Congress.gov House roll-call votes, 119th Congress"
```

Add the transform after `_to_bill_record` (`:127`):
```python
def _to_voting_record(summary: dict) -> dict[str, Any]:
    """Build the camelCase VotingRecordSummary the frontend canvas reads."""
    return {
        "memberName": summary.get("member_name", "The incumbent"),
        "congress": f"{summary.get('congress', 119)}th",
        "attendancePct": summary.get("attendance_pct"),
        "partyLinePct": summary.get("party_line_pct"),  # None = honest gap
        "votesCast": summary.get("votes_cast"),
        "votesMissed": summary.get("votes_missed"),
        "totalRollCalls": summary.get("total_roll_calls"),
        "asOfDate": summary.get("as_of_date"),
        "sourceUrl": summary.get("source_url", CONGRESS_GOV_URL),
    }
```

Add the async core after `fetch_legislation_records` (`:189`):
```python
def _query_voting_record(race_key: str) -> dict[str, Any] | None:
    db = _get_db()
    summary = db.voting_record_summaries.find_one(
        {"race_key_2026": race_key}, {"_id": 0}
    )
    return _to_voting_record(summary) if summary else None


async def fetch_voting_record(race_key: str) -> dict[str, Any] | None:
    """Async data core: incumbent voting-record summary (brief pipeline)."""
    return await asyncio.to_thread(_query_voting_record, race_key)
```

Add the tool after `get_incumbent_legislation` (end of file):
```python
def get_voting_record(race_key: str, tool_context: ToolContext) -> dict[str, Any]:
    """Get the incumbent's House vote attendance % and party-line voting %.

    Computed from 119th-Congress roll-call votes (Congress.gov). Attendance %
    is the share of roll calls the member voted on (Yea/Nay/Present); party-line
    % is the share of party-split votes where they sided with their own party's
    majority. Use this for the incumbent record section.

    Civic safety: these are voting-behavior metrics, not policy positions, and
    party-line % is omitted (not zero) when there are no party-split votes yet.

    Args:
        race_key: Race identifier, e.g. '2026-H-WI-04'. Must contain a House incumbent.
    """
    tool_context.state["status_message"] = f"Computing voting record for {race_key}…"
    try:
        record = _query_voting_record(race_key)
    except pymongo.errors.PyMongoError as exc:
        logger.error("mongodb.get_voting_record: %s", exc)
        return _error(f"Database error retrieving voting record for {race_key}.", HOUSE_VOTES_SOURCE)

    if record is None:
        return _not_found(
            f"No computed voting record for race {race_key}. "
            "This race may have no House incumbent, or votes have not been ingested yet.",
            HOUSE_VOTES_SOURCE,
        )

    tool_context.state["votingRecord"] = record
    tool_context.state["stage"] = "legislation"
    warnings = [
        "Attendance and party-line percentages describe voting behavior, not policy positions.",
    ]
    if record["partyLinePct"] is None:
        warnings.append("Not enough party-split votes yet to compute a party-line percentage.")

    return {
        "status": "success",
        "data": {"race_key": race_key, **record},
        "warnings": warnings,
        "source": HOUSE_VOTES_SOURCE,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent && uv run pytest tests/unit/test_voting_record_tool.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add agent/app/tools/mongodb_tools.py agent/tests/unit/test_voting_record_tool.py
git commit -m "feat(agent): get_voting_record tool + fetch_voting_record core"
```

---

## Task 4: Register the tool and add the deterministic brief step

**Files:**
- Modify: `agent/app/agent.py`
- Modify: `agent/app/tools/brief_pipeline.py`
- Test: extend `agent/tests/unit/test_brief_pipeline.py` (existing)

- [ ] **Step 1: Write the failing test** (append to `agent/tests/unit/test_brief_pipeline.py`)

```python
def test_pipeline_imports_voting_record_fetcher():
    # The deterministic pipeline must call the voting-record core as a step.
    import app.tools.brief_pipeline as bp
    assert hasattr(bp, "fetch_voting_record")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent && uv run pytest tests/unit/test_brief_pipeline.py::test_pipeline_imports_voting_record_fetcher -v`
Expected: FAIL — `AttributeError: module 'app.tools.brief_pipeline' has no attribute 'fetch_voting_record'`

- [ ] **Step 3: Wire the tool and pipeline step**

In `agent/app/agent.py`, add to the import block (`:37-43`):
```python
from app.tools.mongodb_tools import (
    find_candidate,
    get_candidate_finance,
    get_incumbent_legislation,
    get_race_candidates,
    get_race_finance_brief,
    get_voting_record,
)
```
and add `get_voting_record,` to the `tools` list in `_build_tools()` (after `get_incumbent_legislation,` at `:78`).

In `agent/app/tools/brief_pipeline.py`, extend the import (`:26-30`):
```python
from app.tools.mongodb_tools import (
    fetch_candidate_cards,
    fetch_finance_summaries,
    fetch_legislation_records,
    fetch_voting_record,
)
```
Add a step immediately after the legislation `yield` (`:127-133`), before the positions announcement:
```python
        voting_record = await self._fetch_voting_record(race_key)
        yield self._delta(
            ctx, {"votingRecord": voting_record, "status_message": ""}
        )
```
Add this helper next to `_fetch` (`:170-177`):
```python
    async def _fetch_voting_record(self, race_key: str | None):
        if not race_key:
            return None
        try:
            return await fetch_voting_record(race_key)
        except Exception as exc:  # any failure must not abort the brief
            logger.warning("voter_brief voting_record step failed: %s", exc)
            return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd agent && uv run pytest tests/unit/test_brief_pipeline.py tests/unit/test_router.py -v`
Expected: PASS (existing pipeline/router tests still green + the new import test)

- [ ] **Step 5: Commit**

```bash
git add agent/app/agent.py agent/app/tools/brief_pipeline.py agent/tests/unit/test_brief_pipeline.py
git commit -m "feat(agent): register get_voting_record + add voting-record brief step"
```

---

## Task 5: Frontend types

**Files:**
- Modify: `web/src/types/agent-state.ts`

- [ ] **Step 1: Add the `VotingRecordSummary` interface** after `BillRecord` (`:57`)

```ts
export interface VotingRecordSummary {
  memberName: string;
  congress: string;
  attendancePct: number;
  partyLinePct: number | null; // null = honest gap (no party-split votes yet)
  votesCast: number;
  votesMissed: number;
  totalRollCalls: number;
  asOfDate: string | null;
  sourceUrl: string;
}
```

- [ ] **Step 2: Add the field to `DistrictLensState`** (after `legislation: BillRecord[];`, `:101`)

```ts
  votingRecord: VotingRecordSummary | null;
```

- [ ] **Step 3: Add the default** to `DEFAULT_STATE` (after `legislation: [],`, `:119`)

```ts
  votingRecord: null,
```

- [ ] **Step 4: Verify it type-checks**

Run: `cd web && npx tsc --noEmit`
Expected: PASS (no errors)

- [ ] **Step 5: Commit**

```bash
git add web/src/types/agent-state.ts
git commit -m "feat(web): VotingRecordSummary type + state field"
```

---

## Task 6: `VotingRecordCard` component

**Files:**
- Create: `web/src/components/canvas/VotingRecordCard.tsx`
- Create: `web/src/components/canvas/__tests__/VotingRecordCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/components/canvas/__tests__/VotingRecordCard.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VotingRecordCard } from "../VotingRecordCard";
import type { VotingRecordSummary } from "@/types/agent-state";

const base: VotingRecordSummary = {
  memberName: "Jane Rep", congress: "119th", attendancePct: 97.5,
  partyLinePct: 92, votesCast: 390, votesMissed: 10, totalRollCalls: 400,
  asOfDate: "2026-05-20", sourceUrl: "https://www.congress.gov/roll-call-votes/119-2",
};

describe("VotingRecordCard", () => {
  it("renders attendance and party-line percentages", () => {
    render(<VotingRecordCard record={base} />);
    expect(screen.getByText(/97.5%/)).toBeInTheDocument();
    expect(screen.getByText(/92%/)).toBeInTheDocument();
    expect(screen.getByText(/10 missed/i)).toBeInTheDocument();
  });

  it("renders an honest gap when party-line is null", () => {
    render(<VotingRecordCard record={{ ...base, partyLinePct: null }} />);
    expect(screen.getByText(/not enough party-split votes/i)).toBeInTheDocument();
  });

  it("renders nothing when record is null", () => {
    const { container } = render(<VotingRecordCard record={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/canvas/__tests__/VotingRecordCard.test.tsx`
Expected: FAIL — cannot find module `../VotingRecordCard`

- [ ] **Step 3: Write minimal implementation**

```tsx
// web/src/components/canvas/VotingRecordCard.tsx
"use client";
import type { VotingRecordSummary } from "@/types/agent-state";

interface Props { record: VotingRecordSummary | null; }

export function VotingRecordCard({ record }: Props) {
  if (!record) return null;

  return (
    <div className="rounded-[2px] border-2 border-slate-900 bg-white p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
          {record.congress} Congress · Voting Record
        </p>
        <span className="text-xs text-slate-400">Source: Congress.gov</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="border-l-2 border-blue-300 pl-3">
          <p className="text-2xl font-bold text-slate-900">{record.attendancePct}%</p>
          <p className="text-xs text-slate-500">
            Vote attendance · {record.votesMissed} missed of {record.totalRollCalls}
          </p>
        </div>
        <div className="border-l-2 border-blue-300 pl-3">
          {record.partyLinePct === null ? (
            <p className="text-sm text-slate-500">
              Party-line: not enough party-split votes yet
            </p>
          ) : (
            <>
              <p className="text-2xl font-bold text-slate-900">{record.partyLinePct}%</p>
              <p className="text-xs text-slate-500">Voted with their party</p>
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-400 border-t border-slate-100 pt-2">
        Voting behavior, not policy positions
        {record.asOfDate ? ` · as of ${record.asOfDate}` : ""}.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/canvas/__tests__/VotingRecordCard.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/canvas/VotingRecordCard.tsx web/src/components/canvas/__tests__/VotingRecordCard.test.tsx
git commit -m "feat(web): VotingRecordCard with honest party-line gap"
```

---

## Task 7: Wire the card into the record section + broaden section inclusion

**Files:**
- Modify: `web/src/components/canvas/RaceCanvas.tsx`
- Modify: `web/src/lib/brief-layout.ts`
- Modify: `web/src/lib/__tests__/brief-layout.test.ts`

- [ ] **Step 1: Write the failing test** (append to `web/src/lib/__tests__/brief-layout.test.ts`)

```ts
import type { VotingRecordSummary } from "@/types/agent-state";

const aVotingRecord: VotingRecordSummary = {
  memberName: "Jane Rep", congress: "119th", attendancePct: 97, partyLinePct: 90,
  votesCast: 388, votesMissed: 12, totalRollCalls: 400, asOfDate: "2026-05-20",
  sourceUrl: "https://www.congress.gov",
};

it("includes the record section for an incumbent with a voting record but no bills", () => {
  const state = makeState({
    candidates: [{ candidateId: "X", name: "Jane Rep", party: "DEM", status: "incumbent", photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-04" }],
    legislation: [],
    votingRecord: aVotingRecord,
  });
  const layout = buildBriefLayout(state, null);
  expect(layout.sections.some((s) => s.id === "record")).toBe(true);
});
```

> Use the test file's existing `makeState`/state-builder helper; if it spreads `DEFAULT_STATE`, the new `votingRecord` key already defaults to `null`, so only this new case sets it.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/__tests__/brief-layout.test.ts`
Expected: FAIL — record section not included (current `isIncluded` only checks `legislation.length`)

- [ ] **Step 3: Broaden `isIncluded` in `web/src/lib/brief-layout.ts`** (`:134-142`)

Change the `record` case:
```ts
    case "record":
      return seatType === "incumbent" && (state.legislation.length > 0 || state.votingRecord != null);
```

- [ ] **Step 4: Render the card in `web/src/components/canvas/RaceCanvas.tsx`**

Add the import (after the `BillFeed` import, `:8`):
```ts
import { VotingRecordCard } from "./VotingRecordCard";
```
Replace the `record` case body (`:55-62`) with:
```tsx
      case "record": {
        const memberName = state.votingRecord?.memberName ?? state.legislation[0]?.memberName;
        return (
          <CollapsibleSection key="record" title={memberName ? `Legislative record · ${memberName}` : "Legislative record"} defaultOpen={plan.defaultOpen}>
            <div className="space-y-3">
              <VotingRecordCard record={state.votingRecord} />
              <BillFeed legislation={state.legislation} memberName={memberName} />
            </div>
          </CollapsibleSection>
        );
      }
```

- [ ] **Step 5: Run tests + type-check to verify they pass**

Run: `cd web && npx vitest run src/lib/__tests__/brief-layout.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/components/canvas/RaceCanvas.tsx web/src/lib/brief-layout.ts web/src/lib/__tests__/brief-layout.test.ts
git commit -m "feat(web): surface voting record in brief record section"
```

---

## Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full agent + web test suites**

Run: `cd agent && uv run pytest tests/unit -q`
Expected: all green (including the 4 new test files)
Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: all green

- [ ] **Step 2: Ingest a small slice of real votes**

With `MONGODB_URI` and `CONGRESS_API_KEY` set, run the ingest. (For a fast smoke run, temporarily cap `_list_vote_numbers` to the first page by returning after the first `votes.extend`.)
Run: `cd agent && uv run python scripts/ingest_house_votes.py`
Expected: log line `Done: N raw rows, M summaries` with M > 0.

- [ ] **Step 3: Verify a summary exists for a known incumbent race**

Run:
```bash
cd agent && uv run python -c "import os,pymongo; db=pymongo.MongoClient(os.environ['MONGODB_URI'])['districtlens']; print(db.voting_record_summaries.find_one({'race_key_2026':{'\$ne':None}}, {'_id':0,'member_name':1,'attendance_pct':1,'party_line_pct':1,'as_of_date':1}))"
```
Expected: a dict with `attendance_pct` and either a numeric `party_line_pct` or `None`.

- [ ] **Step 4: Manually verify in the brief UI**

Start the web dev server, open a House race with an incumbent (e.g. ID-01 or a WI district), trigger the brief, and confirm the record section shows the attendance/party-line card above the bill feed, with the "voting behavior, not policy positions · as of <date>" footnote. Confirm a race whose member has no party-split votes shows the honest party-line gap, not 0%.

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore: voting-record pipeline e2e verification fixes"
```

---

## Self-review notes

- **Spec coverage:** voter-brief-mod.md House asks "vote attendance percentage" + "party-line voting percentage" → Tasks 1–7. "Bills authored vs co-sponsored vs voted" — *authored* already ships (existing `BillFeed`); *cosponsored* and *voted-on detail* are deliberately deferred (cosponsorship is a separate Wave-1 cheap add; per-bill vote detail is out of scope for the summary metrics).
- **Out of scope (by design):** Senate votes (LIS XML, Wave-2), committee assignments (separate cheap ingest), competitiveness, outside-money.
- **Gotcha for the executor:** the Congress.gov `/members` JSON key names in `_parse_members` (Task 2, Step 4) are best-effort — Task 2 Step 1 captures a real payload first so the test in Step 5 fails loudly if the keys differ. Fix `_parse_members` to match the fixture before moving on.
- **Refresh cadence:** `stale_after` = 2 days on summaries (votes post continuously while in session); a scheduled re-run belongs in the existing refresh-job infra (`agent/app/jobs/`) — out of scope for this plan, noted for the follow-on.
