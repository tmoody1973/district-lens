---
task: add gemini search tool and wire ADK to copilotkit
slug: 20260522-160000_wire-agent-and-copilotkit
effort: advanced
phase: observe
progress: 0/24
mode: interactive
started: 2026-05-22T16:00:00Z
updated: 2026-05-22T16:15:00Z
---

## Context

Two-part build: (1) Gemini search grounding tool added to ADK Python agent so it can find
direct candidate statements. (2) BuiltInAgent bugs fixed — model updated from retired
gemini-2.5-pro to gemini-3.1-pro-preview, canvas JSON Patch op changed from `replace` to `add`
so state updates don't fail when fields are empty. No full ADK→CopilotKit bridge this session
(no native support exists in CopilotKit 1.57; LangGraph adapters only).

GCP project: civicsync-440613. ADK version: 1.31.1. CopilotKit: 1.57.1.

### Risks
- Gemini async client in ADK tool context may need thread handling
- JSON Patch `add` vs `replace` semantics differ: `add` works on new AND existing fields
- Route.ts TypeScript must compile after model string change

## Criteria

### Step 1: ADK Python — Gemini search tool
- [ ] ISC-1: `agent/app/tools/gemini_search.py` file created
- [ ] ISC-2: `search_candidate_positions` function accepts `candidate_name`, `state`, `issue` string params
- [ ] ISC-3: Function is a plain Python function (ADK registers plain functions as tools)
- [ ] ISC-4: Uses `google.genai` async client with `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` env vars
- [ ] ISC-5: Raises `ValueError` with clear message if `GOOGLE_CLOUD_PROJECT` not set
- [ ] ISC-6: Config includes `types.Tool(google_search=types.GoogleSearch())`
- [ ] ISC-7: System instruction is NONPARTISAN_SYSTEM (same as test script)
- [ ] ISC-8: Returns formatted string with `DIRECT STATEMENT FOUND` or `NO DIRECT STATEMENT FOUND` prefix
- [ ] ISC-9: Return string includes source count and latency
- [ ] ISC-10: `agent/app/agent.py` imports `search_candidate_positions`
- [ ] ISC-11: `search_candidate_positions` included in `_build_tools()` list
- [ ] ISC-12: Import succeeds: `uv run python3 -c "from app.agent import root_agent; print('ok')"`

### Step 2a: route.ts — model version fix
- [ ] ISC-13: Model string changed from `gemini-2.5-pro` to `gemini-3.1-pro-preview`
- [ ] ISC-14: `location` remains `global` (required for Gemini 3.1 Pro)
- [ ] ISC-15: No other changes to route.ts (minimal scope)

### Step 2b: page.tsx — canvas JSON Patch fix
- [ ] ISC-16: System prompt `CANVAS STATE RULE` section changed from `replace` to `add`
- [ ] ISC-17: All 5 tool example comments updated to show `add` op
- [ ] ISC-18: Prose clarifies `add` works for both new and existing fields
- [ ] ISC-19: State fields list unchanged (currentRaceKey, candidates, finance, etc.)

### Anti-criteria
- [ ] ISC-A1: No hardcoded project IDs, API keys, or credentials in any file
- [ ] ISC-A2: No existing tools removed from route.ts
- [ ] ISC-A3: No existing tools removed from agent.py
- [ ] ISC-A4: Canvas state type `DistrictLensState` in agent-state.ts unchanged
- [ ] ISC-A5: ADK agent `before_model_callback` and `after_model_callback` unchanged

## Decisions

## Verification
