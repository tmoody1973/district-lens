# Voter Brief Reorg — Design Spec

**Date:** 2026-05-25
**Status:** Approved (design), pending implementation plan
**Scope:** Phase-1 of the voter-brief redesign — de-jumble the brief using current data only. No new data ingestion.

## Problem

`RaceCanvas` renders the brief as a flat stack of sections ordered only by mode (voter vs journalist). There is no top-line takeaway, no awareness of office or election phase, and sections render even when empty. A voter landing on a race gets a wall of equally-weighted sections instead of a clear "here's the decision in front of you."

This phase fixes presentation with the data we already have. The deeper gaps (competitiveness ratings, vote attendance %, party-line %, itemized FEC, governor data) are deferred to the data-layer phase and are marked honestly as "not yet available" rather than hidden.

## Civic-safety spine

The layout is computed **deterministically from verified state, with no LLM involved**. The descriptor decides what renders and in what order; it never generates facts. Missing data is always shown explicitly, never silently omitted in a way that implies absence of an issue. Nothing in this phase recommends how to vote.

## Design decisions (locked)

1. **Primary framing** — when the voter's party is unknown (always, since personalization is session-only), show **both party fields** grouped by party. No profiling, no friction. Header reads "Primary · winner advances to November."
2. **Decision header** — a **scoreboard card**: a 2×2 labeled fact grid (SEAT / FIELD / MONEY / AT STAKE) plus an honest competitiveness-gap row.
3. **Adaptive ordering + progressive disclosure** — ordering adapts to seat type; the legislative-record section renders only for an incumbent with bills; money and news collapse by default; stances stay open.
4. **Scope** — both modes share one shell; journalist is a variant (money-first emphasis) encoded in the descriptor.
5. **Stances** — grouped by issue (comparative), sorted strongest-evidence-first, with strength labels visible and explicit honest gaps.

## Architecture

One pure function plus a thin render layer (Approach 1: "layout descriptor").

### New files

- `web/src/lib/race-key.ts` — `parseRaceKey(raceKey) → { year, office: "house" | "senate", state, district | null }`. Canonical parser. `states.ts:stateCodeFromRaceKey` is refactored to delegate to it (removes the duplicated segment-split).
- `web/src/lib/brief-layout.ts` — descriptor types + `buildBriefLayout(state, raceStatus) → BriefLayout`. Pure: no I/O, no LLM, deterministic.
- `web/src/lib/useRaceStatus.ts` — `useRaceStatus(raceKey) → RaceStatus | null`. Lifts the `/api/race/status` fetch currently inside `NomineeStatusBanner` so the banner and the layout share one fetch.
- `web/src/components/canvas/DecisionHeader.tsx` — renders `HeaderFacts` as the scoreboard card.
- `web/src/components/canvas/CandidateField.tsx` — party-grouped field (primary) or flat-with-incumbent-flagged (called/general). Wraps `CandidateCard`.
- `web/src/components/canvas/CollapsibleSection.tsx` — generic open/collapsed wrapper with a title, reusing the existing accordion visual language.

### Modified files

- `web/src/components/canvas/RaceCanvas.tsx` — becomes thin: call `useRaceStatus` + `buildBriefLayout`, render `DecisionHeader`, then map over `layout.sections` rendering each by id with its `defaultOpen`.
- `web/src/components/canvas/NomineeStatusBanner.tsx` — takes `status` as a prop instead of self-fetching.

### Descriptor types

```ts
type RacePhase = "primary" | "called" | "runoff" | "contested";
type SeatType = "incumbent" | "open";
type SectionId = "candidates" | "record" | "positions" | "money" | "news";

interface HeaderFacts {
  officeLabel: string;        // "U.S. House" | "U.S. Senate"
  title: string;              // "U.S. House — Wisconsin District 3"
  phase: RacePhase;
  phaseLabel: string;         // "Primary · winner advances to November"
  seatType: SeatType;
  seatLabel: string;          // "Incumbent — Name (R)" | "Open seat"
  fieldSummary: string;       // "4 Democrats · 3 Republicans" | "R vs D matchup"
  moneySummary: string;       // "$4.3M raised · top Smith $2.1M" | "Finance data not yet available"
  stakesLabel: string;        // House: "1 of 435 U.S. House seats"
  competitivenessAvailable: false;  // always false this phase
}

interface SectionPlan { id: SectionId; defaultOpen: boolean }
interface BriefLayout { header: HeaderFacts; sections: SectionPlan[] }
```

## Behavioral rules

### Phase derivation (from `raceStatus.status`)

| status | phase |
|---|---|
| `confirmed` | `called` |
| `provisional` / null / 404 | `primary` |
| `runoff_pending` | `runoff` |
| `contested` | `contested` |

`phaseLabel` strings: `called` → "Nominee called · general"; `primary` → "Primary · winner advances to November"; `runoff` → "Runoff pending"; `contested` → "Outcome contested".

### Seat-type derivation (from `candidates[].status`)

Any candidate with `status === "incumbent"` → `incumbent`; otherwise → `open`.

### Header facts

| Cell | Value | Empty-data fallback |
|---|---|---|
| Title | "U.S. House — Wisconsin District 3" / "U.S. Senate — Wisconsin" | raceKey unparseable → "Race" |
| Phase | per phase table above | — |
| SEAT | "Incumbent — Name (party)" / "Open seat" | — |
| FIELD | primary: "4 Democrats · 3 Republicans" · called: "R vs D matchup" | unknown party → "Other" bucket |
| MONEY | "$4.3M raised · top Smith $2.1M" (sum of receipts, top fundraiser) | no finance → "Finance data not yet available" |
| AT STAKE | House: "1 of 435 U.S. House seats" · Senate: "1 of 100 — chamber control + judicial confirmations" | — |
| Competitiveness | **always** "Competitiveness rating — not yet available" | (honest gap marker) |

"AT STAKE" is deliberately factual (seat count), not "control in play," because we cannot verify this seat's competitiveness without partisan-lean data. It upgrades to true stakes when the data layer lands.

### Ordering + disclosure (● open, ▸ collapsed)

Rows are keyed by **seat type** (independent of phase — see candidate grouping below).

| Seat type | Voter | Journalist (money-first) |
|---|---|---|
| **Incumbent** | candidates● · record● · positions● · money▸ · news▸ | candidates● · money● · record● · positions▸ · news▸ |
| **Open** | candidates● · positions● · money▸ · news▸ | candidates● · money● · positions● · news▸ |

### Candidate field grouping (driven by phase, not seat type)

Phase and seat type are orthogonal — an incumbent can face a contested primary. `CandidateField` chooses its layout from **phase**:

- `phase === "primary"` (or `runoff`/`contested`) → group candidates into party columns ("DEM field | REP field"); an incumbent in the field is still flagged in their party column.
- `phase === "called"` → flat matchup with the incumbent (if any) flagged.

This is independent of the ordering table above: e.g. an incumbent in a primary gets the incumbent ordering (record section shows) **and** a party-grouped candidate field.

### Section inclusion (honesty rules)

- `record` — included only when `seatType === "incumbent"` **and** `legislation.length > 0`. No incumbent or no bills → omitted (no empty box).
- `money` — included only when `finance.length > 0`.
- `positions` — always included; empty `positions[]` renders "No position evidence found in indexed sources."
- `news` — folds today's top `NewsCard` (`state.news`) and the per-candidate `NewsAccordion` under one collapsible "Recent news."

### Stances section

- Grouped by issue (existing `IssueAccordion`), candidates side-by-side within each issue.
- Within an issue, cards sorted strongest-evidence-first: `direct_quote` > `questionnaire` > `voting_record` > `reported` > no statement. Matches the CLAUDE.md source hierarchy. Cards missing `evidenceType` fall back to the existing text heuristic in `EvidenceCard`.
- Evidence-strength labels stay visible (already coded in `f377a25`; goes live on this redeploy).
- A candidate's no-statement card (when the agent returns one) renders as an explicit gap card, never omitted.

## Edge cases / error handling

- Unparseable raceKey → header degrades (office "Race", no district), never throws.
- `/api/race/status` fetch fails → phase defaults to `primary`; banner renders nothing (current behavior preserved).
- Null finance fields → money cell "not yet available"; `fmtMoney` already handles null.
- Unknown party codes → "Other" bucket in field summary and party grouping.
- Empty `positions[]` → section-level honest empty state.

## Testing

Per `.claude/rules/testing.md`, the pure functions carry the bulk of coverage.

**Unit:**
- `parseRaceKey` — House, Senate, at-large (`-00`), malformed.
- `buildBriefLayout` — phase derivation per status; seat-type from candidate mix; section inclusion (record omitted with no incumbent / no bills; money omitted with no finance); ordering per mode × seat type; field-count summary; money summary + top fundraiser; competitiveness gap flag always present.
- `sortByEvidenceStrength` — full ordering; missing `evidenceType` heuristic fallback.

**Component:**
- `DecisionHeader` renders all cells incl. the gap row.
- `CandidateField` groups by party in primary, flat-with-incumbent-flag when called.
- `CollapsibleSection` toggles open/closed.
- Update the existing `RaceCanvas` test in `web/src/components/canvas/__tests__/`.

## Out of scope (deferred)

- New data ingestion: competitiveness/partisan-lean, vote attendance %, party-line %, itemized FEC + independent expenditures, governor data.
- Generative component tree / agent-composed layout (Approach 3) and the CopilotKit rendering migration.
- Compare-on-demand, donor drill-down, "what changed" diff — the next "generative interactions" phase.
- Persisted voter profiles.
- Client-side synthesis of per-candidate-per-issue "no statement" gap cards — render agent-returned cards + the section-level empty state; full coverage is data-layer work.

## Deploy note

Shipping this redeploys web, which also brings the already-committed `f377a25` evidence-strength labels + chat-path fix live. After redeploy, clear the stale `evidence_cache` positions entries (7-day TTL, `query_type:"positions"`) so they regenerate with the new prompt. Web deploy is currently blocked by an uncommitted pnpm→bun migration (`web/package.json` + `web/bun.lock` vs committed `pnpm-lock.yaml`); resolve or stash before deploying.
