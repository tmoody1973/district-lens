# Threads as Sessions — Spec Addendum (Phases 4–7)

**Date:** 2026-06-10
**Status:** Approved (decisions locked interactively with Tarik).
**Extends:** `docs/superpowers/specs/2026-06-09-artifact-workspace-design.md` (phases 1–3
shipped to prod 2026-06-10, rev districtlens-web-00067-w9h). This addendum reshapes the
deferred phases 4–6 into phases 4–7 and supersedes the original spec's "Threads (Devon):
data model unchanged" line — the data model still barely changes, but threads become a
first-class session system for BOTH personas. It also subsumes the per-thread live
workspace design in `docs/handoffs/2026-05-28-thread-live-workspace.md` (its W1 shipped
in phases 1–3; its W2 "real CopilotKit threadId" approach is permanently rejected, see
locked decisions).

## Problem

The sidebar still hosts the OLD light-model `ThreadsPanel` (dark-painted in the token
sweep, but structurally the 2026-05-28 design: journalist-gated, inline-expanding rows,
a flat "Briefs" list, a read-only transcript copy). The redesign's vision — and Tarik's
explicit ask — is threads that behave like Claude Code sessions / Crate Deep Cuts:
create a new thread in either persona, chat in it, artifacts born in it attach to it,
switch threads and the whole workspace (chat + artifact panel) swaps.

## Locked decisions (2026-06-10)

| # | Decision | Choice |
|---|---|---|
| A1 | Who gets threads | **Signed-in users, BOTH personas.** Anonymous stays ephemeral-chat + local-artifact-library only — the original privacy posture holds. |
| A2 | Sequencing | **Threads first** (Phase 4), then remaining artifact types (5), share/publish (6), mobile/Cmd+K/polish (7). New artifact types land directly into the thread system. |
| A3 | Artifact switching | **Crate-style dropdown in the ArtifactPanel header**: when a thread is active, the title becomes a dropdown of that thread's artifacts (type dot + name + age); no thread active → it lists recent local-library artifacts. Version history ▾ stays as the second-level control. |
| A4 | Chat resume model | **Keep the own-message-store model** (restore via `setMessages`, ADK is stateless so restored history continues the conversation). `setThreadId()` remains FORBIDDEN — it resets coagent state (locked gotcha). The May-28 W2 idea (CopilotKit runtime threadId persistence) is dead. |
| A5 | Persistence ownership | **One owner.** The dual-write (page mirror vs useThreads auto-capture, mutual-exclusion guard) collapses into a single brief-persistence hook that routes through `saveBriefSnapshot(state, activeThreadId?)`. This is the earmarked altitude refactor — it ships WITH Phase 4, not after. |
| A6 | Old ThreadsPanel | **Fully replaced** by new session-style components in the dark library idiom. Journalist notes survive, relocated into the new thread detail view. |

## Phase 4 — Threads as sessions

### Sidebar (both personas, inside `<Show when="signed-in">`)

- **"+ New thread"** button at the top of the thread section (Claude's "New chat"):
  creates a thread (no race seed required), clears the chat (`setMessages([])`),
  clears the artifact panel (`beginNewBrief` semantics), sets it active.
- **`ThreadSection` / `ThreadItem`** replace `ThreadsPanel`: LibraryItem-idiom rows
  (title, brief count, relative date, active state `bg-zinc-800`), hover-revealed
  delete, click toggles open/switch. Persona decides section ORDER only (voter: My
  Ballot → Threads → Recents; journalist: Threads → Recents → My Ballot) — nothing
  inside is persona-conditional (original spec rule).
- **`ThreadDetailView`** (active thread, below its row): renameable title, notes
  textarea (journalist habit, available to both), and the thread's artifact list
  (type dot + race label + date, click reopens into the panel).
- Signed-out users see neither section; signed-in voters see threads for the first
  time — empty state copy: "Threads keep a conversation and its briefs together."

### Artifact panel header (A3)

- Active thread → title becomes a Deep-Cuts dropdown listing
  `threadsApi.activeThread.briefs` (server-side artifacts of that thread), newest
  first, current one checked. Selecting calls `openSavedBrief(brief_id)`.
- No active thread → dropdown lists the local library's recents (`useArtifacts().library`,
  top 5), selecting calls `openArtifact(artifactId)`.
- The existing per-artifact version `<select>` and close button are unchanged.

### Persistence + capture (A5)

- New `useBriefPersistence(agentState, activeThreadId, isSignedIn)` hook is THE owner
  of "brief completed → persist": local `recordSnapshot` always (anon + signed-in);
  signed-in → `saveBriefSnapshot(state, activeThreadId ?? undefined)` exactly once
  (threadId attached when a thread is open — auto-capture and the ballot mirror are
  the same call now). `useThreads` loses its auto-capture effect; the thread-briefs
  refresh moves into the new hook's success path.
- Voter threads auto-capture identically (the persona gate disappears).
- Clearing-on-new-run: extend `onRunStart` clearing to also apply on chat-initiated
  builds via the stage idle→drafting transition (the earmarked state-driven clearing) —
  it matters more now that threads make reopened artifacts common.

### Data model

- `agent_threads` unchanged. `saved_briefs.thread_id` unchanged. No new collections.
- Thread create no longer requires a race seed (`createThreadRequestSchema` already
  allows `{}`); thread auto-titles upgrade later from race keys as briefs attach
  (existing `deriveThreadTitle` + `attachRaceToThread` behavior).
- Local `ArtifactRecord` does NOT grow a threadId — thread-scoped artifact lists come
  from Mongo (`activeThread.briefs`); the local library stays the anonymous/offline
  surface. Revisit only if anonymous threads (A1) are ever reopened.

## Phase 5 — Remaining artifact types (original spec §Components)

`ComparisonArtifact`, `OverviewArtifact`, `LeadArtifact` (governance footer structurally
unremovable + test), "save as artifact" affordances on matching chat cards
(FinanceToolCard, ballotpedia cards, state-races answers). Saved-as-artifact items
attach to the active thread when one is open. Freshness banner on reopen
("N new statements since this was saved — Refresh brief" → new version appended).

## Phase 6 — Share/publish (original spec §Data flow)

`POST /api/artifacts/publish` → immutable public copy → `/share/[shareId]` (read-only,
sources + dates + nonpartisan disclaimer). **Publish endpoint rejects lead-type
artifacts** (test required). Briefs/comparisons/overviews only. Unpublish deletes.

## Phase 7 — Mobile swap, Cmd+K, polish

Full-screen mobile view swap (artifact ↔ chat ↔ library drawer, never interrupting the
stream), Cmd+K library search, per-persona empty states, plus the deferred-polish
ledger: PersonaSwitch keyboard nav (roving tabindex); divider keyboard/touch resize +
aria-valuenow/min/max; cross-tab localStorage sync (storage event in ArtifactProvider);
layout-persona vs agent-mode drift after toggle+reload; version-label UX ("2 versions
ago"); deep-link one-frame flash.

## Testing (Phase 4 additions)

- Existing 260 stay green. `useThreads` tests gain coverage as logic moves
  (auto-capture removal → `useBriefPersistence` unit tests: local-always,
  signed-in-once, threadId routing, no double-POST).
- Render tests: ThreadSection (signed-in both personas, empty state),
  ThreadItem (active state, delete), ArtifactPanel dropdown (thread mode vs
  library mode sources).
- Dogfood gates: voter-thread loop (sign in → + New thread → build two races → both
  attach → switch threads → chat+artifact swap) and the journalist equivalent.
  Clerk sign-in requires a real browser (Tarik) or live-Mongo verification scripts.

## Out of scope (unchanged from original spec)

Backend/agent changes; anonymous transcript persistence (A1); CopilotKit runtime
threadIds (A4); git-style version branching; publishing leads.
