# Unified Workspace + Artifact Rail — design for eng review

**Date:** 2026-06-10 · **Status:** Draft, pre-implementation (one inert component built:
`ArtifactListPanel` + 3 tests; nothing wired).
**Decisions locked with Tarik (2026-06-10 PM):**
- **U1 — No tabs.** The Voter/Journalist persona toggle is deleted; one workspace serves
  both. Reverses locked decision #2 of the 2026-06-09 spec ("persona-adaptive shell").
  Maya/Devon survive as design lenses in docs only.
- **U2 — Claude-model artifact rail.** Right panel's rest state is an Artifacts LIST
  (cards); clicking focuses one; builds take over the panel and auto-focus on completion.
- Process: this doc goes through /plan-eng-review before implementation.

## The defects this fixes (from Tarik's prod session, with Claude screenshots)

**D1 — Panel doesn't follow the conversation (the "North Dakota zombie").** Display
priority ends in `briefState` — the live coagent snapshot of the LAST race the agent
touched, gated only by persona match. Tarik asked about Wisconsin in chat (typed
questions run targeted tools — no brief build, by design), so the panel kept showing a
stale ND brief under a WI conversation.

**D2 — Clutter from competing surfaces.** Sidebar stacked 4 sections; a header dropdown
switcher; one artifact always dominating the panel; and two persona tabs gating features
(threads, map, ballot) behind the "wrong tab" repeatedly.

**D3 — The tabs themselves.** Two sources of truth (layout persona vs coagent mode)
caused the drift-bug family: chip says Journalist but content is voter; briefs invisible
because "built in the other tab"; threads hidden; double-write guard complexity. Root
cause is the distinction, not the sync.

## The model

### One workspace (U1)

- **Explore surface (one, for everyone):** new `ExploreSurface` component — slim address
  input ("Street address or ZIP code → Build brief") + `USMap` + `RaceTable` (table
  renders once `stateRaces` exist). The action carries the intent: typing an address
  builds; clicking a state explores. Mirrors the landing page's proven combination.
- **Sidebar (signed-in):** My Ballot · Threads. Signed-out: brand + collapse only.
  `LibrarySections` (Recents/All) unmounted — the rail list covers artifacts.
- **One brief layout:** `buildBriefLayout` consumes `state.mode`, which now never
  changes from `"voter"` (kept in the wire shape for coagent/backend compat).
- **Deleted UI:** `PersonaSwitch` (+test), `ArtifactSwitcher` (+test, added this
  morning — wrong model), `CanvasEmptyState` (+test — replaced by ExploreSurface),
  persona presets/drift-sync effect/`isJournalist` branches in `w/page.tsx`,
  `onPersonaChange` plumbing in `LibrarySidebar`.
- **Kept-but-inert for compat (deliberate, /simplify later):** `layout.ts` keeps the
  `persona` field + `presetFor` so stored layout blobs still parse; a single
  `DEFAULT_LAYOUT` (library expanded, chat 32%) is used everywhere. `useWorkspaceAgent`
  keeps `displayed`/`briefSnapshot`/`lastBriefMode` internals (page stops consuming
  them); `setMode` stays exported but uncalled. Landing's `?state=` kickoff calls
  `exploreState` only (no mode/persona setting).

### Panel state machine (U2 — replaces the display-priority chain)

```
LIST (rest)  ──card click / openSavedBrief / auto-focus──▶  FOCUSED
   ▲                                                          │
   └────────────── "← Artifacts" back / thread switch ────────┘
        (any run start → DRAFT, overriding both; on stage:complete
         → auto-focus the just-snapshotted artifact → FOCUSED)
```

Derivation — no new state atom:
- `FOCUSED` ⇔ `reopenedSaved !== null || active !== null` (existing slots)
- `DRAFT` ⇔ `isDrafting` (live stage ∉ {idle, complete}) — `beginNewBrief` (onRunStart)
  already clears both focus slots at every run start
- `LIST` ⇔ otherwise. **`briefState`/`pickDisplayedBrief` no longer feed the panel** —
  the live coagent state renders ONLY during DRAFT. This single deletion kills D1.

Auto-focus on completion: in the `useAutoSnapshot` callback, after
`recordSnapshot(state)` returns a record → `openArtifact(record.artifactId)`. Snapshot
runs for everyone (anon + signed-in), so the conversation's product always takes the
panel, including thread-filed briefs (identical content, local copy).

### List contents (one source per context)

- Active thread → that thread's briefs (`activeThread.briefs`, names via
  `deriveLabel(race_key)`, open via `openSavedBrief`).
- No thread → local library (`useArtifacts().library`, open via `openArtifact`).
- Beneath the cards, always: `ExploreSurface`. Dead `?a=` → `DeadLinkState` (unchanged).

### Focused-view header

"← Artifacts" back (new `onBack` prop on ArtifactPanel; replaces ✕), title, Saved ✓
chip, version history select. `titleSlot` prop removed.

## Data-flow walk-throughs (edge cases)

1. **Landing `/w?addr=`** → run start clears focus → DRAFT (receipt + live canvas) →
   complete → snapshot → auto-focus → FOCUSED. Conversation-driven. ✓
2. **Chat-only question** (the WI case): no build → panel stays LIST; the ND brief is a
   labeled card, not a squatter. Typed "build a brief for…" → normal DRAFT→FOCUSED.
3. **Thread switch** → restores `briefs[0]` via openSavedBrief → FOCUSED; 0-brief thread
   → LIST (that thread's empty list + ExploreSurface). Chat restores via
   `agent.setMessages` (shipped).
4. **Map exploration**: `get_state_races` fills `stateRaces` with stage staying idle →
   remains LIST; the RaceTable updates in place beneath the cards. Race click → DRAFT.
5. **Back**: clears `reopenedSaved` + `closeArtifact()`; if `?a=` present,
   `router.replace("/w")` so the deep link doesn't immediately re-focus.
6. **Mid-draft thread switch**: `onClearBrief` wipes agent state → DRAFT ends → restored
   brief or LIST (unchanged from today).
7. **My Ballot click** → openSavedBrief → FOCUSED (both former personas).
8. **Anonymous user**: sidebar is brand-only; rail = local library list + ExploreSurface;
   threads/ballot absent (signed-in features). Unchanged privacy posture.

## Files

- NEW `ArtifactListPanel.tsx` (built, inert) · NEW `ExploreSurface.tsx` (+tests)
- MOD `ArtifactPanel.tsx` (`onBack`, drop `titleSlot`) · MOD `w/page.tsx` (state machine,
  composition, tab removal) · MOD `LibrarySidebar.tsx` (drop PersonaSwitch row) ·
  MOD `app/page.tsx` landing (drop `mode` prop on USMap if required-optional)
- DEL `PersonaSwitch.tsx`, `ArtifactSwitcher.tsx`, `CanvasEmptyState.tsx` (+ their tests)
- Suite target: stays green (~268 ±, deletions offset by additions)

## Out of scope

Backend/agent changes; making typed chat questions auto-build briefs (separate
decision); threads data model; phases 5–7 of the addendum (which inherits U1: its
"persona decides section order" lines become moot).

## Risks

- Auto-focus misfire would leave LIST after a build — covered by existing useAutoSnapshot
  unit tests + browser gate on the kickoff path.
- Stored layouts from the persona era parse fine (persona field tolerated, ignored).
- Demo narrative changes from "two personas" to "one evidence-first workspace with
  research threads" — simpler to present; PRD/docs update follows later.

## Review amendments (locked 2026-06-10, /plan-eng-review D1–D8)

These supersede any contradicting lines above.

- **D1** Full scope confirmed (file count is deletion-driven).
- **D2 + C4** Mid-build: focused view wins, but a slim build-progress pill renders in
  the panel header whenever `isDrafting` (agent visibility is never lost). Completion
  auto-focuses ONLY if the user has not manually focused anything since the run
  started — tracked by one run-marker ref (the "no new state atom" claim was wrong).
- **D3** Opening a thread lands on the artifact LIST. The auto-open-latest-brief branch
  is deleted from the thread-switch effect.
- **C1 (verified shipped bug)** The thread-switch effect currently wipes the chat
  restore `openThread` just performed (`agent.setMessages([])` runs after
  `agent.setMessages(restored)`). Fix: the thread-switch effect becomes the single
  owner of chat state — it sets `agent.setMessages(toAgentMessages(activeThread?.thread
  .messages ?? []))`; `openThread` stops touching messages.
- **C2 (verified)** "Any run start → DRAFT" was false: typed-chat builds bypass
  `onRunStart`. DRAFT and reopened-slot clearing key off the coagent **stage
  transition** (idle → active) as the source of truth; `onRunStart` remains only as an
  immediate-clear nicety for programmatic runs.
- **C3 (verified)** `openArtifact`/`openSavedBrief` must cross-clear — one focus
  concept, enforced inside the new pure module (a focused saved brief and a focused
  local artifact can never coexist).
- **D4 + C5** ALL inert persona machinery stripped now: PersonaSwitch, presets
  (`layout.ts` collapses to one `DEFAULT_LAYOUT`; parser stays tolerant of stored blobs
  carrying `persona` — pinned by regression test R2), `setMode`/`displayed`/
  `briefSnapshot` internals, the stale "Mode:" string in the agent-readable context.
  Explicit consequence: the journalist money-first brief ordering is deliberately
  dropped — one evidence-first layout; `brief-layout` tests updated accordingly.
- **D5** Shared `AddressSuggestInput` extracted; landing + ExploreSurface consume it.
- **D6 + R1** Panel-view decision extracted to pure `derivePanelView()` with unit
  tests; **R1 regression test (critical): a stale live coagent brief never renders at
  rest** (the ND-zombie, pinned forever).
- **C6** Rail list caps at the latest 8 with "Show all (N)" — ExploreSurface stays
  reachable.
- **C7 notes** Pin "state exploration keeps stage idle" with a test; storage-unavailable
  completion falls back to the in-memory store copy (focus still works, session-only);
  local-vs-thread focus ID asymmetry accepted for v1; persistence single-owner
  (`useBriefPersistence`) remains addendum A5 scope — this rework must not add a third
  write path.
- **C8** Integration tests added to scope: typed-build-while-focused,
  exploration-while-focused, thread-open-with-existing-messages,
  manual-navigation-during-draft, saved-then-local cross-open, storage-unavailable
  completion.

## NOT in scope

- `useBriefPersistence` single-owner collapse — addendum A5, phases 4–7 plan.
- Making typed chat questions auto-build briefs — backend/prompt design decision.
- Cmd+K artifact search, mobile view swap — phase 7.
- Thread/ballot brief deep-link failure UX beyond silent no-op — follow-up with phase 5.
- Unifying local-vs-thread artifact identity (focus highlight in list) — phase 5.

## What already exists (reused, not rebuilt)

- Focus slots + transitions (`active`/`reopenedSaved`, open/close) — reused as the
  FOCUSED inputs to `derivePanelView`.
- `ArtifactListPanel` (built this session, inert) — becomes the LIST view.
- Receipt strip + live canvas (DRAFT view), `useAutoSnapshot`, local store fallback,
  `DeadLinkState` — all reused unchanged.
- Landing page address autocomplete — extracted to `AddressSuggestInput`, not rebuilt.

## Failure modes

| New path | Realistic failure | Test? | Handled? | User sees |
|---|---|---|---|---|
| derivePanelView | stale live brief at rest (ND) | R1 unit | yes — rest never reads live state | list, correctly |
| auto-focus | snapshot returns null (no raceKey) | unit | yes — stays LIST | list + chat answer |
| auto-focus | user navigated mid-run | unit (C8) | yes — focus not stolen | their artifact + pill |
| thread restore | effect/restore race | C8 integration | yes — effect owns messages | restored chat |
| typed-chat build | stage moves without onRunStart | C8 integration | yes — stage watcher | draft view appears |
| openSavedBrief | 404/network | — | silent no-op (accepted v1) | nothing happens |
| storage unavailable | quota at completion | existing store tests | in-memory fallback | artifact opens, session-only |

No critical gaps remain: every silent-failure path above is either tested or an
explicitly accepted v1 no-op.

## Parallelization

| Step | Modules touched | Depends on |
|---|---|---|
| T1–T5 (state machine, restore fix, rail wiring) | lib/workspace, components/workspace, app/w | — (shared modules → sequential lane A) |
| T6 (AddressSuggestInput + ExploreSurface) | components/workspace (new files), app/page | — (lane B, independent) |
| T7 (persona strip) | layout.ts, brief-layout, sidebar, deletions | after T1–T5 (lane A tail) |
| T8 (integration tests) | tests | after A+B merge |

Launch lanes A and B in parallel; T7→T8 after.

## Implementation Tasks

Synthesized from this review's findings.

- [ ] **T1 (P1, human: ~4h / CC: ~20min)** — lib/workspace — pure `derivePanelView` + unit tests incl. R1 ND-zombie regression, pill flag, focus cross-clear (C3), polite-focus suppression
  - Surfaced by: Test review D6 + Architecture D2 + Codex C3 · Files: web/src/lib/workspace/derivePanelView.ts (+tests) · Verify: vitest
- [ ] **T2 (P1, human: ~2h / CC: ~10min)** — app/w — stage-transition watcher drives DRAFT + reopened-slot clearing (covers typed-chat builds)
  - Surfaced by: Codex C2 · Files: web/src/app/w/page.tsx, web/src/lib/workspace/useWorkspaceAgent.ts · Verify: C8 integration test + browser
- [ ] **T3 (P1, human: ~1h / CC: ~10min)** — lib/workspace — thread-switch effect owns chat restore; openThread stops setting messages (fixes shipped restore bug)
  - Surfaced by: Codex C1 (verified) · Files: web/src/lib/workspace/useThreads.ts · Verify: thread-open-with-messages integration test + Tarik browser check
- [ ] **T4 (P1, human: ~3h / CC: ~20min)** — components/workspace + app/w — wire ArtifactListPanel rest state (cap 8 + Show all), list sources (thread vs library), back handler clearing ?a=
  - Surfaced by: U2 + D3 + C6 · Files: ArtifactListPanel.tsx, w/page.tsx · Verify: component tests + browser
- [ ] **T5 (P1, human: ~2h / CC: ~15min)** — components/workspace — build pill in ArtifactPanel header + onBack; auto-focus with run-marker ref
  - Surfaced by: D2/C4 · Files: ArtifactPanel.tsx, w/page.tsx · Verify: unit + browser
- [ ] **T6 (P2, human: ~2h / CC: ~15min)** — shared input — extract AddressSuggestInput; build ExploreSurface; landing refactored onto it
  - Surfaced by: D5 · Files: AddressSuggestInput.tsx, ExploreSurface.tsx, app/page.tsx · Verify: new tests + landing browser check
- [ ] **T7 (P2, human: ~4h / CC: ~25min)** — strip persona machinery: deletions (PersonaSwitch/ArtifactSwitcher/CanvasEmptyState + tests), DEFAULT_LAYOUT + R2 parse regression, drop Mode readable, single brief ordering + test updates, slim sidebar
  - Surfaced by: D4/C5 · Files: layout.ts, brief-layout.ts, LibrarySidebar.tsx, deletions · Verify: full suite green
- [ ] **T8 (P2, human: ~3h / CC: ~20min)** — C8 integration test batch + exploration-stage-idle pin
  - Surfaced by: Codex C8/C7 · Files: tests · Verify: vitest
- [ ] **T9 (P3, human: ~1h / CC: ~15min)** — browser dogfood gate (test-plan artifact) + deploy
  - Surfaced by: process · Verify: screenshots + Tarik signed-in pass

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found→absorbed | 14 findings: 3 verified bugs (C1 restore wipe, C2 typed-build gap, C3 focus cross-clear) + amendments C4–C8 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 6 issues across 4 sections; 8 decisions D1–D8, all resolved |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CODEX:** outside voice ran against the amended plan; all findings absorbed via D8 (3 verified in source before acceptance).
- **CROSS-MODEL:** no tension — Codex found additive gaps; nothing contradicted decisions D1–D7.
- **UNRESOLVED:** 0
- **VERDICT:** ENG CLEARED — ready to implement (T1–T9).

