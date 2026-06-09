# DistrictLens Artifact Workspace — Design

**Date:** 2026-06-09
**Status:** Approved in brainstorming; ready for implementation planning.
**Replaces:** the single-page chat-with-canvas interface (`web/src/app/page.tsx`).

## Problem

DistrictLens's agent produces durable research objects — a voter's race brief, a
journalist's dossier — but the interface is shaped like an ephemeral chat session.
The brief lives in transient coagent state on a center canvas; the next address
overwrites it. Persistence exists (saved briefs, threads in MongoDB) but is buried
in sidebar panels. The load-bearing output has no first-class home.

**Goal:** an artifact-centric workspace in the style of the Claude app's artifact
panel and Crate Web's "Deep Cuts" — chat beside a persistent artifact, backed by a
real library — adapted to DistrictLens's two personas and civic guardrails.

## Personas (design tools)

**🗳️ Maya — the Saturday-morning voter.** 34, rents in WI-04, votes most generals.
Touches the app 2–3 times total, often on her phone, with ten minutes. One question:
*"What's on my ballot and who are these people?"* Trusts evidence labels; trusts
"no direct statement found" more than confident guesses.
→ Forces: zero-friction entry (no sign-in), one artifact as her whole world,
device-local persistence, skimmable hierarchy, mobile-first, visible-but-docked chat.

**📰 Devon — the local politics reporter.** 41, covers WI politics, files 2–3
stories/week. Research sprints across many races; returns daily. Needs receipts:
sources, dates, FEC/Congress.gov links he can cite. His enemy is research that
evaporates into chat scroll.
→ Forces: a real library (threads, dossiers, recents, search), multi-artifact
workflow, comparison artifacts, share links for editors, keyboard speed, density.

**Their tension:** Maya is artifact-first (one document, chat assists); Devon is
library-first (many objects, chat drives). Resolved by layout presets (below).

## Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Scope | **New shell, keep the organs** — new workspace shell; the ~21 brief canvas components and the saved-brief/thread data layer survive inside it |
| 2 | Personas | **One shell, persona-adaptive** — persona is a first-class identity selecting defaults, not a buried toggle |
| 3 | Artifact types | **All four**: brief/dossier, issue comparison, state/race overview, Ballotpedia discovery lead (with governance chrome) |
| 4 | Theme | **Crate Dark** — full zinc shell; canvas organs get a token-based dark restyle |
| 5 | Anonymous persistence | **Local-first, sign in to sync** — localStorage library for anonymous users; Clerk upgrades to Mongo sync. Public-first honored |
| 6 | Timeline | **Full redesign before hackathon submission**, sequenced risk-first; every phase leaves `main` deployable |
| 7 | Layout | **One engine, two presets** — resizable split with collapsible panes; persona presets are saved layout states, not code branches |
| 8 | Stack roles | **CopilotKit is the pipe, not the artifact system** — chat + live coagent stream stay CopilotKit; the artifact/library layer is ours, backed by MongoDB (the warehouse) |

## Architecture

### Routes

| Route | Purpose | Auth |
|---|---|---|
| `/` | Landing: address input (Maya) + state map entry (Devon). Submitting drops into the workspace with the agent already working | Public |
| `/w` | Workspace shell. Active thread/artifact in search params (`/w?t=<threadId>&a=<artifactId>`) — deep-linkable, back-button friendly, lighter than route-per-session | Public; richer signed in |
| `/share/[shareId]` | Published artifact, read-only, no chrome | Public |

### Shell

`WorkspaceShell` renders three panes — **Library** (collapsible to icon rail) ·
**Chat** (CopilotKit; collapsible to a docked strip) · **Artifact panel** — with a
draggable divider (Crate's resizable-split pattern). A `WorkspaceLayout` context
owns pane state, persisted to localStorage.

**Persona presets:** persona (chosen at landing or sidebar header) selects a
default layout state — Maya: library railed, chat docked ~28%, artifact dominant;
Devon: library 260px, chat ~40%, artifact history prominent. Nothing inside the
panes is persona-conditional; either user can drag toward the other's layout.
Presets double as the layout-state recovery position.

### Artifact state (the new layer)

```
DRAFT artifact   = live CopilotKit coagent state, rendered in the artifact panel
                   as a document visibly being written (receipt strip on top)
SAVED artifacts  = local library (localStorage, anon) ∪ Mongo library (signed in)
ACTIVE artifact  = draft (while building) | any saved artifact (reopened)
```

On `stage: complete`, the draft auto-snapshots into the library as a named
artifact ("WI-04 · House · 2026", renameable) using the existing `SavedBriefDoc`
schema (`answer_snapshot`, `source_refs`, `freshness` fingerprint). The "Save"
button becomes automatic behavior.

**Agent visibility (judging + trust):** the build is never hidden. Even in Maya's
preset the docked chat streams tool activity, and the artifact header carries the
receipt strip (district → candidates → MCP → finance → positions).

**Mobile:** full-screen view swap (artifact ↔ chat ↔ library drawer), not a
squeezed three-pane. Swapping views never interrupts the agent stream.

## Components

### New shell chrome (~10 files, adapted from Crate)

| Component | Borrowed from | Job |
|---|---|---|
| `WorkspaceShell` | Crate `workspace-shell` | Three-pane frame, divider, collapse, mobile swap |
| `LibrarySidebar` + sections | Crate sidebar sections | **My Ballot**, **Threads**, **Recents**, **All artifacts**; persona decides which sections lead |
| `LibraryItem` | Crate `session-item` | Type dot, name, freshness chip, hover actions |
| `ArtifactPanel` | Crate `deep-cuts-panel` | Header (name, type badge, history ▾, share, save state) + typed body |
| Receipt strip | existing `ReceiptProgress` | Build stages across the artifact top while drafting |
| `ChatPane` | wraps existing CopilotKit chat | Dockable; keeps `AgentToolTrace` cards; adds "open as artifact ↗" |
| `PersonaSwitch`, `CommandK`, empty states | Crate patterns | Persona toggle, library search, per-persona first-run |

### Artifact renderers (4)

- **`BriefArtifact`** — composes existing `DecisionHeader`, `CandidateField`,
  `IssueAccordion`/`EvidenceCard`, `FinanceChart`, voting record, news. The 21
  canvas components survive as this artifact's organs. Persona affects only
  section order/default-open (existing `brief-layout.ts`, kept).
- **`ComparisonArtifact`** — one issue across candidates: question as title,
  evidence-card grid, honest-empty per candidate.
- **`OverviewArtifact`** — `USMap` + `RaceTable` as a saveable snapshot with title
  and as-of date.
- **`LeadArtifact`** — wraps Ballotpedia card components in amber discovery
  governance chrome; the "verify before citing" footer is structural in the
  renderer — a lead cannot render without it.

### Dark restyle

Token-based, not per-file class edits: shared tokens (`surface`, `border`, `ink`,
evidence colors tuned for dark) in `globals.css`. Evidence-color semantics stay
consistent (green=direct quote, blue=questionnaire, indigo=voting record,
amber=reported/discovery). Party dots + evidence labels get a dark-contrast check.

### Removed

The 785-line `page.tsx` (decomposed), the left activity sidebar (receipts move to
the artifact header), the buried mode toggle (replaced by `PersonaSwitch`).

## Data flow

**Birth:** address/race → `/w` → draft artifact builds section-by-section in the
panel → `stage: complete` → auto-snapshot → library write (localStorage anon,
Mongo signed in) → "Saved ✓" + generated name.

**Sign-in sync:** one-shot push of local artifacts to Mongo; Mongo becomes source
of truth, localStorage the offline cache. Conflicts dedupe by `race_key` +
fingerprint — identical snapshots merge; different ones append as versions.

**Reopen + freshness:** snapshot renders instantly; background fingerprint check
may show "2 new candidate statements since this was saved — Refresh brief."
Refresh rebuilds → **new version appended** (linear history, Crate-style); old
versions immutable (the data-integrity rule expressed in UI). History ▾ flips
versions.

**Comparison/overview/lead artifacts:** born from chat — answer cards whose shape
matches grow a "Save as artifact" affordance; clicking materializes them into the
library named by the question.

**Threads (Devon):** data model unchanged (chat transcript + artifacts + notes).
Opening a thread restores its chat into the ChatPane and lists its artifacts;
existing auto-capture now visibly lands artifacts in the library in real time.

**Share/publish** (brief/comparison/overview only — leads excluded, see
guardrails): "Share" → `POST /api/artifacts/publish` → immutable public copy with
`shareId` → `/share/[shareId]` (read-only; sources, dates, nonpartisan
disclaimers baked in). Unpublish deletes the public copy.

**Anonymous chat is ephemeral by design:** only artifacts persist locally;
transcripts are session-scoped. Durable transcripts are the signed-in threads
feature (Devon).

## Error handling & guardrails

- **Failed build:** draft keeps completed sections; receipt strip marks the failed
  stage; inline "retry this section." **Failed drafts never auto-save** — the
  library only holds complete snapshots.
- **Missing evidence:** honest-empty states render as first-class artifact content
  ("I found no direct statement in the indexed sources"). No fake skeletons.
- **localStorage unavailable:** degrade to session-only with a quiet notice; never
  a crash or sign-in wall.
- **Dead links:** unknown `?a=` → "not in your library" with a rebuild path;
  unpublished `/share/` → honest 404.
- **Freshness check failure:** skip silently; the snapshot always renders.
- **Corrupt layout state:** reset to persona preset.
- **Civic-safety publishing rule:** briefs, comparisons, and overviews publish;
  **discovery leads do not** — publishing unverified leads as standalone pages
  strips the "lead, not evidence" context. Leads are saveable/shareable within
  the library only.

## Testing

- **Existing 192-test web suite stays green** (brief-layout, fingerprints,
  saved-brief schema, evidence strength, ballotpedia cards — untouched logic).
- **New unit tests (TDD):** artifact lifecycle (snapshot only on complete; failed
  builds never save; refresh appends versions; sync dedupe/merge), local library
  store (CRUD, quota degradation, sign-in push), layout engine (presets, corrupt
  reset, collapse/restore), governance (`LeadArtifact` cannot render without the
  discovery footer; publish endpoint rejects leads; refusal + citation-presence
  tests stay green).
- **Render tests:** one fixture test per artifact renderer asserting key fields +
  required chrome.
- **Dogfooding gates (browser):** Maya loop — address → draft → reload → persists
  → freshness banner. Devon loop — thread → two artifacts → history flip → share
  link opens cold. Screenshot evidence per gate.

## Build sequence (each phase leaves `main` deployable)

1. **Shell + layout engine + presets** — riskiest machinery first; today's
   `RaceCanvas` mounts as-is (still light) inside the artifact panel. The
   transitional "paper on dark desk" look is a legitimate waypoint.
2. **Artifact layer** — ArtifactProvider, local library, auto-snapshot, library
   sidebar. The app becomes artifact-centric here.
3. **Dark token pass** — `BriefArtifact` + canvas organs onto zinc tokens.
4. **Remaining artifact types** + "save as artifact" affordances on chat cards.
5. **Share/publish** + `/share/[shareId]`.
6. **Mobile swap, Cmd+K, empty states, polish** → final dogfood of both loops.

Contingency cut line: after phase 3 the app is coherent (artifact workspace with
brief artifacts, dark theme) if the deadline bites — but the plan is all six.

## Out of scope

- Changing the agent/backend pipeline, tools, or governance rules.
- Persisting anonymous chat transcripts.
- Git-style branching version history (linear only).
- Publishing discovery-lead artifacts.
