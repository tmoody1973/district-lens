# DistrictLens Voter Brief Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make candidate stances reliably appear by replacing the LLM-chained Voter Brief with a deterministic pipeline, present the dense result as issue-grouped accordions, wire lazy news, relabel the journalist map honestly, make the shell mobile-usable, and add a voting-logistics deep-link strip.

**Architecture:** The brief becomes a deterministic ADK orchestration (fixed step order, server-side) that writes `tool_context.state` per step so the live receipt keeps streaming. The slow stance phase runs one broad Perplexity call per candidate, parallelized with `asyncio.gather`, then a second-pass `gemini-3.1-pro-preview` call structures each answer into per-issue cards. The frontend groups stances by issue in accordions (which also delivers side-by-side comparison), lazy-loads news from the existing `/api/search/news` route, and collapses the three-column shell to canvas-primary + chat bottom-sheet on mobile.

**Tech Stack:** Python 3.13 / Google ADK / `ag_ui_adk` / Gemini 3.1-pro-preview / Perplexity sonar-pro / Next.js (App Router) / React / TypeScript / Tailwind / CopilotKit + AG-UI / MongoDB.

**Decision provenance:** `CONTEXT.md`, `docs/adr/0001` (deterministic pipeline), `docs/adr/0002` (Fundraising Advantage map), `docs/adr/0003` (logistics deep-links).

**Non-negotiables:** Always `gemini-3.1-pro-preview` with `location="global"` — never 2.5/flash, including the structuring call. Never hardcode secrets. Do NOT start dev servers (verify via tests + the deployed agent).

---

## File Structure

**Backend (`agent/app/`)**
- `tools/position_search.py` — MODIFY: add structured broad-search + Gemini structuring helpers
- `tools/brief_pipeline.py` — CREATE: deterministic orchestrator (the core fix)
- `agent.py` — MODIFY: register the pipeline as the brief entrypoint
- `tests/unit/test_brief_pipeline.py` — CREATE
- `tests/unit/test_position_structuring.py` — CREATE
- `scripts/spike_stream.py` — CREATE (Task 0 spike, deleted at end of Task 0)

**Frontend (`web/src/`)**
- `types/agent-state.ts` — MODIFY: `EvidenceCard` gains structured per-issue shape; add `news` loading flags
- `components/canvas/IssueAccordion.tsx` — CREATE: one collapsible issue, both candidates side by side
- `components/canvas/RaceCanvas.tsx` — MODIFY: group positions by issue → accordions
- `components/canvas/NewsAccordion.tsx` — CREATE: lazy "Recent news" section
- `components/canvas/CanVoteStrip.tsx` — CREATE: logistics deep-links
- `components/map/USMap.tsx` — MODIFY: "Fundraising Advantage" gradient + caveat
- `lib/states.ts` — CREATE: state code → official election-site deep-link map
- `app/page.tsx` — MODIFY: responsive shell (canvas-primary + chat sheet)
- `app/globals.css` or Tailwind config — MODIFY: responsive breakpoint helpers if needed

---

## Task 0: Spike — confirm deterministic streaming through ag_ui_adk

**Goal:** De-risk the one unknown before building: can a custom deterministic agent yield multiple `tool_context.state` updates that `ag_ui_adk` forwards to the frontend as separate deltas (preserving the live receipt)?

**Files:**
- Create: `agent/scripts/spike_stream.py`

- [ ] **Step 1: Read the streaming contract**

Read `agent/.venv/lib/python3.13/site-packages/ag_ui_adk/event_translator.py` and `adk_agent.py`. Find how ADK events become `STATE_DELTA` / `STATE_SNAPSHOT` AG-UI events. Note whether deltas emit on `EventActions.state_delta` per yielded `Event`, or only at tool-return boundaries.

- [ ] **Step 2: Write a 2-step dummy orchestrator**

```python
# agent/scripts/spike_stream.py
import asyncio
from google.adk.agents import BaseAgent
from google.adk.events import Event, EventActions
from google.adk.agents.invocation_context import InvocationContext

class SpikeAgent(BaseAgent):
    async def _run_async_impl(self, ctx: InvocationContext):
        yield Event(author=self.name, actions=EventActions(state_delta={"stage": "candidates"}))
        await asyncio.sleep(1)
        yield Event(author=self.name, actions=EventActions(state_delta={"stage": "finance"}))
```

- [ ] **Step 3: Confirm two distinct deltas reach the AG-UI stream**

Run the agent through the same `ADKAgent` wrapper used in `fast_api_app.py` (or inspect `event_translator` output) and assert two separate `STATE_DELTA` events are produced, one second apart.

Expected: two deltas, in order. If true → the deterministic orchestrator in Task 1 uses this `yield Event(actions=EventActions(state_delta=...))` pattern and the live receipt is preserved.

- [ ] **Step 4: Record the finding, delete the spike**

Append the confirmed pattern (a 3-line note) to `docs/adr/0001-...md` Consequences. Then `git rm agent/scripts/spike_stream.py`.

- [ ] **Step 5: Commit**

```bash
git add docs/adr/0001-voter-brief-deterministic-pipeline.md
git commit -m "spike: confirm ag_ui_adk forwards per-step state deltas for deterministic brief"
```

**If the spike fails** (deltas only flush at tool boundaries): fall back to keeping each step as its own FunctionTool but driving them from a `SequentialAgent` whose sub-agents each wrap one tool. Re-plan Task 1 around `SequentialAgent`. Do not proceed to Task 1 until streaming is confirmed one way or the other.

---

## Task 1: Deterministic brief pipeline

**Files:**
- Create: `agent/app/tools/brief_pipeline.py`
- Test: `agent/tests/unit/test_brief_pipeline.py`
- Modify: `agent/app/agent.py`

- [ ] **Step 1: Write the failing test**

```python
# agent/tests/unit/test_brief_pipeline.py
import pytest
from unittest.mock import AsyncMock, patch
from app.tools.brief_pipeline import run_voter_brief

@pytest.mark.unit
@pytest.mark.asyncio
async def test_pipeline_runs_every_step_in_order(fake_tool_context):
    with patch("app.tools.brief_pipeline._steps") as steps:
        steps.return_value = ["district", "candidates", "finance", "legislation", "positions", "complete"]
        stages = []
        fake_tool_context.on_state = lambda k, v: stages.append(v) if k == "stage" else None
        await run_voter_brief("1234 Oak St, Racine WI", fake_tool_context)
    assert stages == ["district", "candidates", "finance", "legislation", "positions", "complete"]
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd agent && uv run pytest tests/unit/test_brief_pipeline.py -v`
Expected: FAIL — `run_voter_brief` not defined.

- [ ] **Step 3: Implement the orchestrator**

`run_voter_brief(address_or_zip, tool_context)` calls, in fixed order: `lookup_district` → `get_race_candidates` → `get_race_finance_brief` → `get_incumbent_legislation` → `gather_candidate_positions` (Task 2) → `finish_brief`. Each existing step already writes `tool_context.state`; the orchestrator just `await`s them in sequence so the order no longer depends on the LLM. Wrap each call in try/except so one slow/failed step (e.g. positions) does not abort the brief — it logs, sets a status message, and continues.

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd agent && uv run pytest tests/unit/test_brief_pipeline.py -v` → PASS.

- [ ] **Step 5: Register as the brief entrypoint in `agent.py`**

Replace the seven brief tools in the LLM's tool list with the single `run_voter_brief` tool (keep `get_state_races`, `find_candidate`, and `search_candidate_positions` for journalist + chat follow-ups). Update `civic_safety.md`: "For any address or single-race request, call `run_voter_brief(address_or_zip)` once — it runs the full brief deterministically. Do not call the individual brief tools yourself."

- [ ] **Step 6: Update the frontend trigger**

In `web/src/app/page.tsx:107-111`, replace the long scripted "call these 7 tools in sequence" message with: `Build a complete voter brief for: ${addr}` (the agent now needs only to invoke the one pipeline tool).

- [ ] **Step 7: Commit**

```bash
git add agent/app/tools/brief_pipeline.py agent/tests/unit/test_brief_pipeline.py agent/app/agent.py agent/app/prompts/civic_safety.md web/src/app/page.tsx
git commit -m "feat(agent): deterministic voter-brief pipeline so stances always run (ADR 0001)"
```

---

## Task 2: Parallel broad search + Gemini structuring

**Files:**
- Modify: `agent/app/tools/position_search.py`
- Test: `agent/tests/unit/test_position_structuring.py`

- [ ] **Step 1: Write the failing test for the structurer**

```python
# agent/tests/unit/test_position_structuring.py
import pytest
from app.tools.position_search import structure_positions

@pytest.mark.unit
@pytest.mark.asyncio
async def test_structures_broad_answer_into_issue_cards(monkeypatch):
    fake_json = '{"positions":[{"issue":"housing","statement":"Backs the Housing Affordability Act","source_indices":[0]}]}'
    monkeypatch.setattr("app.tools.position_search._gemini_json", lambda *a, **k: fake_json)
    sources = [{"title":"Campaign site","url":"https://x","date":"2026-03-01","snippet":"..."}]
    cards = await structure_positions("Gwen Moore", "broad answer text", sources)
    assert cards[0]["issue"] == "housing"
    assert cards[0]["candidateName"] == "Gwen Moore"
    assert cards[0]["sources"][0]["url"] == "https://x"
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd agent && uv run pytest tests/unit/test_position_structuring.py -v` → FAIL (`structure_positions` undefined).

- [ ] **Step 3: Implement `structure_positions` (second-pass Gemini)**

Add a `structure_positions(candidate_name, broad_answer, sources)` that calls `gemini-3.1-pro-preview` (`location="global"`) with a JSON-schema response asking for `{positions:[{issue, statement, source_indices}]}`, then maps `source_indices` back into the `sources` list to produce `EvidenceCard` dicts (`candidateName`, `issue`, `statement`, `sources`). On any parse failure, fall back to ONE card with `issue:"key positions"` and the whole answer — stances still render.

- [ ] **Step 4: Add `gather_candidate_positions` (parallel)**

```python
async def gather_candidate_positions(candidates, state, tool_context):
    async def one(c):
        answer, sources = await _broad_search(c["name"], state)   # broad mode, no state write
        return await structure_positions(c["name"], answer, sources)
    results = await asyncio.gather(*[one(c) for c in candidates], return_exceptions=True)
    cards = [card for r in results if not isinstance(r, Exception) for card in r]
    tool_context.state["positions"] = cards
    tool_context.state["stage"] = "complete"
```

Both candidates' broad searches + structuring run concurrently (~25s total, not ~100s).

- [ ] **Step 5: Run tests, verify pass**

Run: `cd agent && uv run pytest tests/unit/test_position_structuring.py -v` → PASS.

- [ ] **Step 6: Commit**

```bash
git add agent/app/tools/position_search.py agent/tests/unit/test_position_structuring.py
git commit -m "feat(agent): parallel broad position search + gemini-3.1-pro structuring into per-issue cards"
```

---

## Task 3: Issue-grouped accordion layout (frontend)

**Files:**
- Modify: `web/src/types/agent-state.ts`
- Create: `web/src/components/canvas/IssueAccordion.tsx`
- Modify: `web/src/components/canvas/RaceCanvas.tsx`

- [ ] **Step 1: Extend the EvidenceCard type**

Add `statement: string` (the structured per-issue text) alongside `answer` for back-compat; `issue` stays the grouping key.

- [ ] **Step 2: Write `IssueAccordion`**

A collapsed-by-default `<details>`-based section titled by issue (e.g. "Housing"); on expand it renders the matching candidates' statements **side by side** (two columns on desktop, stacked on mobile), each with quote + source link + date. First issue open by default (evidence-first).

- [ ] **Step 3: Group positions by issue in `RaceCanvas`**

Replace the flat `state.positions.map(EvidenceCard)` (lines 32-41) with: group `state.positions` by `issue`, render one `IssueAccordion` per issue. Keep candidate cards + finance as compact fixed cards above; make legislation a collapsible section.

- [ ] **Step 4: Verify in browser (golden path + empty)**

Confirm: multiple issues render as collapsible rows; expanding shows both candidates; the "no statement found" case still renders honestly. (Type-check: `cd web && npx tsc --noEmit`.)

- [ ] **Step 5: Commit**

```bash
git add web/src/types/agent-state.ts web/src/components/canvas/IssueAccordion.tsx web/src/components/canvas/RaceCanvas.tsx
git commit -m "feat(canvas): issue-grouped accordions for stances (declutter + side-by-side compare)"
```

---

## Task 4: Lazy "Recent news" accordion

**Files:**
- Create: `web/src/components/canvas/NewsAccordion.tsx`
- Modify: `web/src/components/canvas/RaceCanvas.tsx`

- [ ] **Step 1: Build `NewsAccordion`** — collapsed section per candidate; on first expand, `POST /api/search/news` with `{candidateName}`, show a spinner, then render `sources` mapped to headline + source + date + link. Cache in component state so re-expanding doesn't refetch.
- [ ] **Step 2: Map route response → display** — the route returns `{answer, sources}`; render `sources` as the news list (title/url/date/snippet).
- [ ] **Step 3: Mount in `RaceCanvas`** below legislation, one per candidate (or one combined).
- [ ] **Step 4: Verify** the section stays empty/closed until expanded; no perpetually-empty card. Type-check.
- [ ] **Step 5: Commit** — `feat(canvas): lazy Recent news accordion wired to existing /api/search/news`

---

## Task 5: Journalist map → "Fundraising Advantage" (ADR 0002)

**Files:**
- Modify: `web/src/components/map/USMap.tsx`

- [ ] **Step 1: Replace the palette** — drop `COLOR_COMPETITIVE/LEAN/SAFE` (red/amber/green) for a single-hue intensity gradient keyed to the size of the fundraising gap.
- [ ] **Step 2: Rename `heatmapColor` → `fundraisingAdvantageColor`**; keep the ratio math but remove the Safe/Lean/Competitive semantics.
- [ ] **Step 3: Replace the legend** (lines 115-130): title "Fundraising Advantage", gradient swatches labeled "smaller gap → larger gap", and a one-line caveat: "Fundraising, not a prediction. Most seats are safe regardless of money."
- [ ] **Step 4: Verify** the journalist map shows the gradient + caveat; no win-lose language anywhere. Type-check.
- [ ] **Step 5: Commit** — `feat(map): relabel journalist heatmap as Fundraising Advantage (ADR 0002)`

---

## Task 6: Mobile shell — canvas-primary + chat bottom-sheet

**Files:**
- Modify: `web/src/app/page.tsx`

- [ ] **Step 1: Add breakpoints to the shell** — the left rail (`w-48`, line 228) and chat column (`w-80`, line 324) get `hidden lg:flex`; the center canvas is full-width below `lg`.
- [ ] **Step 2: Mobile receipt strip** — render a slim horizontal progress strip above the canvas on `< lg` (reuse `ReceiptProgress` in a compact horizontal variant).
- [ ] **Step 3: Chat bottom-sheet** — below `lg`, render `CopilotChat` inside a slide-up sheet toggled by a fixed bottom "Ask" button.
- [ ] **Step 4: Verify at 390px** — use the browser device toolbar (or Playwright at viewport 390×844): the brief is readable full-width, accordions stack, chat opens as a sheet, nothing horizontally scrolls. (This is the one task that needs a real mobile-viewport check — do not skip it.)
- [ ] **Step 5: Commit** — `feat(ui): responsive shell — canvas-primary + chat bottom-sheet on mobile`

---

## Task 7: "Can you vote?" logistics strip (ADR 0003)

**Files:**
- Create: `web/src/lib/states.ts` (state code → official registration / polling / deadline URLs)
- Create: `web/src/components/canvas/CanVoteStrip.tsx`
- Modify: `web/src/components/canvas/RaceCanvas.tsx`

- [ ] **Step 1: Build `lib/states.ts`** — a typed map from 2-letter state code to official deep-links (vote.gov registration check, the state SoS polling/deadline page) plus a generic BallotReady/Ballotpedia "full ballot" link templated by address.
- [ ] **Step 2: Build `CanVoteStrip`** — a compact strip: "Can you vote? Check registration · Find your polling place · Deadlines · See your full ballot →", links resolved from the brief's state. All external links (`target="_blank" rel="noopener"`).
- [ ] **Step 3: Mount at the top of `RaceCanvas`** (above candidates) so logistics answer the voter's first question first.
- [ ] **Step 4: Verify** the links resolve for the brief's state (e.g. WI) and open official sources. Type-check.
- [ ] **Step 5: Commit** — `feat(canvas): Can-you-vote logistics deep-link strip (ADR 0003)`

---

## Self-Review

- **Spec coverage:** every decision in CONTEXT.md + ADR 0001/0002/0003 maps to a task (pipeline→T1, structuring→T2, accordions→T3, news→T4, map→T5, mobile→T6, logistics→T7; T0 de-risks T1).
- **Riskiest task is gated:** T0 spike must confirm streaming before T1; explicit `SequentialAgent` fallback documented.
- **Type consistency:** `EvidenceCard` shape written by `structure_positions` (T2) matches `IssueAccordion` consumption (T3) — `candidateName`, `issue`, `statement`/`answer`, `sources{title,url,date,snippet}`.
- **Model mandate:** structuring call pinned to `gemini-3.1-pro-preview` (T2 Step 3).
- **No secrets, no dev servers**; verification via pytest, `tsc --noEmit`, deployed agent, and one Playwright mobile-viewport check (T6).

## Execution Handoff

Recommended: **Subagent-Driven Development** — fresh subagent per task, two-stage review between tasks. Start with Task 0 (spike) since Task 1's architecture depends on its outcome. I will NOT start coding without your go-ahead.
