---
task: USMap heatmap mode for journalist competitive races
slug: 20260522-000000_usmap-heatmap-mode
effort: standard
phase: complete
progress: 10/10
mode: interactive
started: 2026-05-22T00:00:00-05:00
updated: 2026-05-22T15:47:00-05:00
---

## Context

Task 9 of the DistrictLens v3 build: give `USMap` a journalist heatmap mode.
Currently `USMap` takes only `focusedState` and `onStateClick`. We add `mode: AppMode`
and `heatmapData: RaceRow[]`. In journalist mode each state is colored by the
competitiveness of its races, derived from the `incumbentReceipts / topChallengerReceipts`
ratio (a race-competitiveness signal, NOT a candidate position inference — civic guardrail respected).

The current call site (`web/src/app/page.tsx:214`) passes only the two original props, so
the new props must be optional with safe defaults to avoid breaking the build, and the call
site is wired to pass `agentState.mode` and `agentState.stateRaces` so the feature actually works.

### Risks
- Required new props would break the existing page.tsx call site → make optional + wire call site.
- Voter mode must remain visually identical → heatmap only activates when mode is journalist AND data present.

## Criteria

- [x] ISC-1: USMap imports AppMode and RaceRow from @/types/agent-state
- [x] ISC-2: Props interface adds optional mode field
- [x] ISC-3: Props interface adds optional heatmapData field
- [x] ISC-4: heatmapColor returns slate default for states with zero races
- [x] ISC-5: heatmapColor returns red for competitive races (ratio < 1.5)
- [x] ISC-6: heatmapColor returns amber for lean races (1.5 <= ratio < 3)
- [x] ISC-7: Heatmap only activates in journalist mode with non-empty data
- [x] ISC-8: Legend renders only when heatmap is active
- [x] ISC-9: page.tsx passes mode and heatmapData to USMap
- [x] ISC-10: tsc --noEmit passes and full vitest suite passes

## Decisions

- Made `mode` and `heatmapData` OPTIONAL (not required as in the task snippet) because the
  existing page.tsx call site passes neither; required props would break tsc. Defaults
  (`mode="voter"`, `heatmapData=[]`) preserve current voter-mode rendering exactly.
- Wired page.tsx to pass `agentState.mode` and `agentState.stateRaces` so the heatmap
  activates with live agent state.
- Finance ratio is treated strictly as race-competitiveness context, not a candidate
  position signal — consistent with the project's no-donor-inference guardrail.

## Verification

- `npx tsc --noEmit` → exit 0, no type errors.
- `npx vitest run` → 8 test files passed, 36/36 tests passed.
- Props made optional; existing voter-mode rendering unchanged (default mode="voter", heatmapData=[]).
- page.tsx wired to pass agentState.mode + agentState.stateRaces.
- No capabilities selected, so no phantom-capability failures.

