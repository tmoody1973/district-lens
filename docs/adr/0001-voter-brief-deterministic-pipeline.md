# Voter Brief runs as a deterministic pipeline, not an LLM-chained sequence

**Status:** accepted (2026-05-23)

The Voter Brief previously relied on the Gemini agent to voluntarily chain seven tools in one turn (district → candidates → finance → legislation → stances → finish). In practice the agent stopped after the fast MongoDB tools and never completed the slow position-search phase, so candidate stances — the product's reason to exist — never reached the canvas (live `/copilotkit` requests ended at 20–54s; a full brief needs ~100s+ of sequential Perplexity calls). We are moving the brief to a deterministic server-side pipeline that always runs every step regardless of model whim, with the candidate position searches run in parallel.

## Considered Options

- **Keep LLM-driven, harden the prompt** — rejected: this is the exact turn-completion fragility we'd been fighting (see prior `maxSteps` commits); it regresses.
- **Frontend-driven step chaining** — rejected: re-implements orchestration in the client and adds round-trips.
- **Deterministic server-side pipeline** — chosen: guarantees stances always run and is robust to both failure mechanisms (model ending its turn early *and* timeout overrun).

## Consequences

- Stances are guaranteed to run; the brief is no longer at the mercy of model turn-completion.
- Each candidate's stances come from one **broad** Perplexity call (all issues at once), then a **second-pass `gemini-3.1-pro-preview`** call structures the answer into per-issue cards. The 3.1-pro mandate applies to the structuring call too — no flash.
- Parallelizing the broad searches keeps the stance phase at ~25s (one call's latency) instead of ~100s sequential.
- The brief becomes a fixed pipeline; open-ended chat follow-ups remain LLM-driven and agentic.
- Recent news is NOT in the pipeline — it lazy-loads in the frontend from the existing `/api/search/news` route when the voter expands the news accordion.

## Spike finding (2026-05-23)

**Question:** When we replace "LLM calls N tools" with "ONE deterministic orchestrator," does the live step-by-step receipt still stream? **Answer: yes — confirmed from source.**

### Streaming contract (file:line refs)

The per-step receipt does NOT depend on tool boundaries or turn completion. It depends only on how many `Event`s carry a `state_delta`, and each is flushed immediately:

1. **Translation is per-Event, eager.** `ag_ui_adk/event_translator.py:418-422` — for any ADK event with `actions.state_delta`, `translate()` yields exactly one `StateDeltaEvent`. `_create_state_delta_event` (`:1149-1178`) maps each `state_delta` key to a JSON-Patch `{"op":"add","path":"/<key>","value":...}` (RFC 6902, `STATE_DELTA`). Snapshots (`:424-427`, `:1180-1196`) only fire if `state_snapshot` is set — we won't use them.
2. **The runner loop emits as events arrive.** `ag_ui_adk/adk_agent.py:2434` `async for adk_event in runner.run_async(...)`; each event is translated and each AG-UI event is `await event_queue.put(...)` at `:2537-2544`. `_stream_events` (`:1704`) drains that queue to SSE. There is **no batching at tool-return or turn boundaries** — flush granularity = one ADK `Event`.

**Q2 answer:** Yes. If a single `BaseAgent._run_async_impl` yields N `Event`s each with its own `EventActions(state_delta=...)` between awaited steps, the client receives N separate `STATE_DELTA` patches, in order, as each is yielded. The progressive receipt is preserved 1:1 with yields.

**Q3 answer — `ParallelAgent` is unsafe for merging `state["positions"]`.** `parallel_agent.py:35-48` (`_create_branch_ctx_for_sub_agent`) gives every sub-agent an **isolated branch** (`ctx.branch = parent.sub`), and `:150-158` documents it as "runs its sub-agents in parallel in an isolated manner." Two candidates would write to isolated state branches with no defined merge of the same `positions` key — race/last-writer-wins risk. **Confirmed: avoid `ParallelAgent`.** Instead `asyncio.gather` the two slow Perplexity searches *inside one step* and write `state["positions"]` once. (Note `_merge_agent_run`, `:51-86`, also serializes events through a resume-signal queue, so it buys no extra streaming benefit here.)

### Recommended pattern: **Option A — custom `BaseAgent` subclass**

Chosen over Option B (`SequentialAgent` of sub-agents) because A (a) preserves per-step streaming via explicit `yield Event(...)` after each step, and (b) lets one step internally `asyncio.gather` the two slow searches and write `positions` once — exactly the merge `ParallelAgent` can't safely do. `SequentialAgent` would force the gather-and-merge into a sub-agent anyway, adding indirection for no gain.

```python
from typing import AsyncGenerator
import asyncio
from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event, EventActions

class VoterBriefPipeline(BaseAgent):
    async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
        race = ctx.session.state["race"]

        candidates = await fetch_candidates(race)            # fast (MongoDB)
        yield self._delta(ctx, {"candidates": candidates})    # client patch #1

        finance = await fetch_finance(race)
        yield self._delta(ctx, {"finance": finance})          # client patch #2

        legislation = await fetch_legislation(race)
        yield self._delta(ctx, {"legislation": legislation})  # client patch #3

        # Slow phase: gather both candidates' searches, write positions ONCE.
        positions = dict(zip(
            (c["id"] for c in candidates),
            await asyncio.gather(*(search_positions(c) for c in candidates)),
        ))
        yield self._delta(ctx, {"positions": positions})      # client patch #4

    def _delta(self, ctx: InvocationContext, delta: dict) -> Event:
        ctx.session.state.update(delta)  # keep ADK session state in sync
        return Event(author=self.name, actions=EventActions(state_delta=delta))
```

Each `yield` produces one `STATE_DELTA` to the canvas; `useCoAgent` applies the patch and re-renders that section live. The slow stance phase emits its single delta after the gather completes (~25s, one call's latency, not ~100s).

### Validation

Skipped runtime validation: driving the full path requires the `ADKAgent`/`add_adk_fastapi_endpoint` SSE server plus MongoDB + a `PERPLEXITY_API_KEY` (network/infra). The source chain above is unambiguous — `translate()` yields one `StateDeltaEvent` per state-delta-bearing `Event`, and the runner loop flushes each translated event to the queue immediately with no turn-boundary buffering — so a source reading is authoritative here. No throwaway script was left behind.
