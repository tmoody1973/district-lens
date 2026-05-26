# Voter Brief Reorg Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat, mode-only section stack in `RaceCanvas` with a decision header plus office/seat/phase-aware ordering and progressive disclosure, computed deterministically from current verified state.

**Architecture:** One pure function `buildBriefLayout(state, raceStatus)` returns a typed `BriefLayout` (header facts + ordered section plan). `RaceCanvas` becomes a thin renderer that draws the header and maps over the plan. No LLM, no new data ingestion. Data gaps render as explicit "not yet available" markers.

**Tech Stack:** Next.js (web/), TypeScript, React, Vitest + @testing-library/react, Tailwind.

**Spec:** `docs/superpowers/specs/2026-05-25-voter-brief-reorg-design.md`

**Conventions:** All commands run from the repo root (`/Users/tarikmoody/Documents/Projects/districtlens`). Tests use Vitest. Commit message attribution is disabled globally — do not add Co-Authored-By trailers.

---

## File Map

**Create:**
- `web/src/lib/race-key.ts` — `parseRaceKey` (canonical race-key parser)
- `web/src/lib/format.ts` — `fmtMoney` (moved from `CandidateCard` so the header can reuse it)
- `web/src/lib/brief-layout.ts` — descriptor types + `derivePhase`, `deriveSeatType`, `buildHeaderFacts`, `buildSections`, `buildBriefLayout`
- `web/src/lib/evidence-strength.ts` — `sortByEvidenceStrength`
- `web/src/lib/useRaceStatus.ts` — `useRaceStatus` hook (lifts the `/api/race/status` fetch)
- `web/src/components/canvas/DecisionHeader.tsx` — scoreboard header
- `web/src/components/canvas/CandidateField.tsx` — party-grouped / flat candidate field
- `web/src/components/canvas/CollapsibleSection.tsx` — generic open/collapsed wrapper
- Tests: `web/src/lib/__tests__/{race-key,brief-layout,evidence-strength}.test.ts`, `web/src/components/canvas/__tests__/{DecisionHeader,CandidateField,CollapsibleSection}.test.tsx`

**Modify:**
- `web/src/lib/states.ts` — add `stateName(code)` export; `stateCodeFromRaceKey` delegates to `parseRaceKey`
- `web/src/components/canvas/CandidateCard.tsx` — import + re-export `fmtMoney` from `lib/format`
- `web/src/components/canvas/NomineeStatusBanner.tsx` — take `status` as a prop, drop the self-fetch
- `web/src/components/canvas/__tests__/NomineeStatusBanner.test.tsx` — pass `status` prop
- `web/src/components/canvas/RaceCanvas.tsx` — consume `useRaceStatus` + `buildBriefLayout`, render header + section plan

---

## Task 1: parseRaceKey + states.ts helpers

**Files:**
- Create: `web/src/lib/race-key.ts`
- Modify: `web/src/lib/states.ts`
- Test: `web/src/lib/__tests__/race-key.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/__tests__/race-key.test.ts`:

```ts
import { test, expect } from "vitest";
import { parseRaceKey } from "../race-key";

test("parses a House race key", () => {
  expect(parseRaceKey("2026-H-WI-04")).toEqual({
    year: "2026", office: "house", state: "WI", district: "04",
  });
});

test("parses a Senate race key (no district)", () => {
  expect(parseRaceKey("2026-S-WI")).toEqual({
    year: "2026", office: "senate", state: "WI", district: null,
  });
});

test("parses an at-large House district", () => {
  expect(parseRaceKey("2026-H-AK-00")).toEqual({
    year: "2026", office: "house", state: "AK", district: "00",
  });
});

test("returns null for a malformed key", () => {
  expect(parseRaceKey("garbage")).toBeNull();
  expect(parseRaceKey(null)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/__tests__/race-key.test.ts`
Expected: FAIL — cannot find module `../race-key`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/lib/race-key.ts`:

```ts
export type Office = "house" | "senate";

export interface ParsedRaceKey {
  year: string;
  office: Office;
  state: string;
  district: string | null;
}

// Race keys look like "2026-H-WI-04" (House) or "2026-S-WI" (Senate).
export function parseRaceKey(raceKey: string | null): ParsedRaceKey | null {
  if (!raceKey) return null;
  const parts = raceKey.split("-");
  if (parts.length < 3) return null;
  const [year, officeCode, state, district] = parts;
  if (state?.length !== 2) return null;
  const office: Office | null =
    officeCode === "H" ? "house" : officeCode === "S" ? "senate" : null;
  if (!office) return null;
  return { year, office, state: state.toUpperCase(), district: district ?? null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/__tests__/race-key.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Refactor states.ts to delegate + add stateName**

In `web/src/lib/states.ts`, add an import at the top:

```ts
import { parseRaceKey } from "./race-key";
```

Add an exported helper (place it just after the `STATE_NAMES` constant):

```ts
export function stateName(code: string | null): string {
  if (!code) return "";
  const upper = code.toUpperCase();
  return STATE_NAMES[upper] ?? upper;
}
```

Replace the existing `stateCodeFromRaceKey` function body with a delegation:

```ts
export function stateCodeFromRaceKey(raceKey: string | null): string | null {
  return parseRaceKey(raceKey)?.state ?? null;
}
```

- [ ] **Step 6: Run the existing states-dependent tests + lint**

Run: `cd web && npx vitest run src/components/canvas/__tests__/CanVoteStrip.test.tsx && npx eslint src/lib/race-key.ts src/lib/states.ts`
Expected: PASS, no lint errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/race-key.ts web/src/lib/states.ts web/src/lib/__tests__/race-key.test.ts
git commit -m "feat(web): add parseRaceKey, delegate stateCodeFromRaceKey, export stateName"
```

---

## Task 2: Move fmtMoney to lib/format.ts

**Files:**
- Create: `web/src/lib/format.ts`
- Modify: `web/src/components/canvas/CandidateCard.tsx`
- Test: existing `web/src/components/canvas/__tests__/fmtMoney.test.ts` (unchanged — still imports from `../CandidateCard`)

- [ ] **Step 1: Create the shared module**

Create `web/src/lib/format.ts`:

```ts
export function fmtMoney(val: number | null): string {
  if (val == null) return "—";
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(val / 1_000)}K`;
  return `$${val}`;
}
```

- [ ] **Step 2: Re-export from CandidateCard, remove the local copy**

In `web/src/components/canvas/CandidateCard.tsx`, delete the local `fmtMoney` function (lines defining `export function fmtMoney...`) and add near the other imports:

```ts
import { fmtMoney } from "@/lib/format";
```

Then re-export it so existing importers (and its test) keep working — add after the imports:

```ts
export { fmtMoney };
```

- [ ] **Step 3: Run the existing test to verify it still passes**

Run: `cd web && npx vitest run src/components/canvas/__tests__/fmtMoney.test.ts`
Expected: PASS (4 tests) — the test imports `fmtMoney` from `../CandidateCard` and the re-export keeps that path valid.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/format.ts web/src/components/canvas/CandidateCard.tsx
git commit -m "refactor(web): move fmtMoney to lib/format, re-export from CandidateCard"
```

---

## Task 3: brief-layout types + derivePhase + deriveSeatType

**Files:**
- Create: `web/src/lib/brief-layout.ts`
- Test: `web/src/lib/__tests__/brief-layout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/__tests__/brief-layout.test.ts`:

```ts
import { test, expect } from "vitest";
import { derivePhase, deriveSeatType } from "../brief-layout";
import type { CandidateCard } from "@/types/agent-state";

const cand = (status: string): CandidateCard => ({
  candidateId: status, name: status, party: "DEM", status,
  photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-04",
});

test("derivePhase maps status values", () => {
  expect(derivePhase({ status: "confirmed" } as any)).toBe("called");
  expect(derivePhase({ status: "provisional" } as any)).toBe("primary");
  expect(derivePhase({ status: "runoff_pending" } as any)).toBe("runoff");
  expect(derivePhase({ status: "contested" } as any)).toBe("contested");
  expect(derivePhase(null)).toBe("primary");
});

test("deriveSeatType detects an incumbent", () => {
  expect(deriveSeatType([cand("incumbent"), cand("challenger")])).toBe("incumbent");
  expect(deriveSeatType([cand("open_seat"), cand("challenger")])).toBe("open");
  expect(deriveSeatType([])).toBe("open");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/__tests__/brief-layout.test.ts`
Expected: FAIL — cannot find module `../brief-layout`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/lib/brief-layout.ts`:

```ts
import type { CandidateCard } from "@/types/agent-state";

export type RacePhase = "primary" | "called" | "runoff" | "contested";
export type SeatType = "incumbent" | "open";
export type SectionId = "candidates" | "record" | "positions" | "money" | "news";

export interface RaceStatus {
  status: string;
  winners: Record<string, string>;
  confidence: number | null;
  confirmationBasis: string[];
  flaggedReason: string | null;
  resolvedAt: string | null;
  citation: { url: string; publisher: string } | null;
}

export interface HeaderFacts {
  officeLabel: string;
  title: string;
  phase: RacePhase;
  phaseLabel: string;
  seatType: SeatType;
  seatLabel: string;
  fieldSummary: string;
  moneySummary: string;
  stakesLabel: string;
  competitivenessAvailable: false;
}

export interface SectionPlan { id: SectionId; defaultOpen: boolean }
export interface BriefLayout { header: HeaderFacts; sections: SectionPlan[] }

export function derivePhase(status: RaceStatus | null): RacePhase {
  switch (status?.status) {
    case "confirmed": return "called";
    case "runoff_pending": return "runoff";
    case "contested": return "contested";
    default: return "primary";
  }
}

export function deriveSeatType(candidates: CandidateCard[]): SeatType {
  return candidates.some((c) => c.status === "incumbent") ? "incumbent" : "open";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/__tests__/brief-layout.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/brief-layout.ts web/src/lib/__tests__/brief-layout.test.ts
git commit -m "feat(web): brief-layout types + phase/seat-type derivation"
```

---

## Task 4: buildHeaderFacts

**Files:**
- Modify: `web/src/lib/brief-layout.ts`
- Test: `web/src/lib/__tests__/brief-layout.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `web/src/lib/__tests__/brief-layout.test.ts`:

```ts
import { buildHeaderFacts } from "../brief-layout";
import type { DistrictLensState } from "@/types/agent-state";

const baseState = (over: Partial<DistrictLensState>): DistrictLensState => ({
  mode: "voter", mapFocus: null, currentRaceKey: "2026-H-WI-03", stage: "complete",
  briefStartedAt: null, status_message: null, candidates: [], finance: [],
  legislation: [], news: [], positions: [], stateRaces: [], comparisons: [],
  briefMarkdown: null, briefReady: true, ...over,
});

test("header title, office, and stakes for a House race", () => {
  const h = buildHeaderFacts(baseState({}), null);
  expect(h.officeLabel).toBe("U.S. House");
  expect(h.title).toBe("U.S. House — Wisconsin District 3");
  expect(h.stakesLabel).toBe("1 of 435 U.S. House seats");
  expect(h.competitivenessAvailable).toBe(false);
});

test("header for a Senate race omits the district", () => {
  const h = buildHeaderFacts(baseState({ currentRaceKey: "2026-S-WI" }), null);
  expect(h.title).toBe("U.S. Senate — Wisconsin");
  expect(h.stakesLabel).toBe("1 of 100 — chamber control + judicial confirmations");
});

test("seat label names the incumbent", () => {
  const h = buildHeaderFacts(baseState({
    candidates: [{ candidateId: "1", name: "Gwen Moore", party: "DEM", status: "incumbent", photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-03" }],
  }), null);
  expect(h.seatType).toBe("incumbent");
  expect(h.seatLabel).toBe("Incumbent — Gwen Moore (DEM)");
});

test("open seat + primary field summary counts by party", () => {
  const mk = (id: string, party: string) => ({ candidateId: id, name: id, party, status: "open_seat", photoUrl: "", photoSource: "placeholder" as const, raceKey: "2026-H-WI-03" });
  const h = buildHeaderFacts(baseState({ candidates: [mk("a","DEM"), mk("b","DEM"), mk("c","REP")] }), null);
  expect(h.seatLabel).toBe("Open seat");
  expect(h.fieldSummary).toBe("2 Democrats · 1 Republican");
  expect(h.phaseLabel).toBe("Primary · winner advances to November");
});

test("money summary sums receipts and names top fundraiser", () => {
  const h = buildHeaderFacts(baseState({
    finance: [
      { candidateId: "1", name: "Jane Smith", party: "DEM", receipts: 2_100_000, disbursements: null, cashOnHand: null, individualContributions: null, pacContributions: null, coverageEndDate: null },
      { candidateId: "2", name: "Bob Jones", party: "REP", receipts: 2_200_000, disbursements: null, cashOnHand: null, individualContributions: null, pacContributions: null, coverageEndDate: null },
    ],
  }), null);
  expect(h.moneySummary).toBe("$4.3M raised · top Jones $2.2M");
});

test("money summary falls back when no finance", () => {
  expect(buildHeaderFacts(baseState({}), null).moneySummary).toBe("Finance data not yet available");
});

test("unparseable race key degrades gracefully", () => {
  const h = buildHeaderFacts(baseState({ currentRaceKey: "garbage" }), null);
  expect(h.title).toBe("Race");
  expect(h.officeLabel).toBe("Race");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/__tests__/brief-layout.test.ts`
Expected: FAIL — `buildHeaderFacts` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `web/src/lib/brief-layout.ts` (imports at top, helpers + function below the derive functions):

```ts
import type { DistrictLensState, FinanceSummary } from "@/types/agent-state";
import { parseRaceKey } from "./race-key";
import { stateName } from "./states";
import { fmtMoney } from "./format";

const PHASE_LABEL: Record<RacePhase, string> = {
  primary: "Primary · winner advances to November",
  called: "Nominee called · general",
  runoff: "Runoff pending",
  contested: "Outcome contested",
};

const PARTY_NOUN: Record<string, string> = { DEM: "Democrat", REP: "Republican", IND: "Independent" };
const PARTY_LETTER: Record<string, string> = { DEM: "D", REP: "R", IND: "I" };

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}

function fieldSummary(phase: RacePhase, candidates: CandidateCard[]): string {
  if (phase === "called") {
    const letters = [...new Set(candidates.map((c) => PARTY_LETTER[c.party.toUpperCase()] ?? "?"))];
    return letters.length > 1 ? `${letters.join(" vs ")} matchup` : "General matchup";
  }
  const counts = new Map<string, number>();
  for (const c of candidates) {
    const key = c.party.toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ordered = ["DEM", "REP", ...[...counts.keys()].filter((k) => k !== "DEM" && k !== "REP").sort()];
  const segments = ordered
    .filter((k) => counts.has(k))
    .map((k) => plural(counts.get(k)!, PARTY_NOUN[k] ?? "Other"));
  return segments.length > 0 ? segments.join(" · ") : "No candidates yet";
}

function moneySummary(finance: FinanceSummary[]): string {
  const withReceipts = finance.filter((f) => f.receipts != null);
  if (withReceipts.length === 0) return "Finance data not yet available";
  const total = withReceipts.reduce((sum, f) => sum + (f.receipts ?? 0), 0);
  const top = withReceipts.reduce((a, b) => ((b.receipts ?? 0) > (a.receipts ?? 0) ? b : a));
  return `${fmtMoney(total)} raised · top ${lastName(top.name)} ${fmtMoney(top.receipts)}`;
}

export function buildHeaderFacts(state: DistrictLensState, raceStatus: RaceStatus | null): HeaderFacts {
  const parsed = parseRaceKey(state.currentRaceKey);
  const phase = derivePhase(raceStatus);
  const seatType = deriveSeatType(state.candidates);
  const incumbent = state.candidates.find((c) => c.status === "incumbent");

  if (!parsed) {
    return {
      officeLabel: "Race", title: "Race", phase, phaseLabel: PHASE_LABEL[phase],
      seatType, seatLabel: incumbent ? `Incumbent — ${incumbent.name} (${incumbent.party})` : "Open seat",
      fieldSummary: fieldSummary(phase, state.candidates), moneySummary: moneySummary(state.finance),
      stakesLabel: "", competitivenessAvailable: false,
    };
  }

  const isHouse = parsed.office === "house";
  const officeLabel = isHouse ? "U.S. House" : "U.S. Senate";
  const sName = stateName(parsed.state);
  const districtLabel =
    parsed.district === "00" ? "At-Large" : parsed.district ? `District ${Number(parsed.district)}` : "";
  const title = isHouse ? `${officeLabel} — ${sName} ${districtLabel}`.trim() : `${officeLabel} — ${sName}`;
  const stakesLabel = isHouse
    ? "1 of 435 U.S. House seats"
    : "1 of 100 — chamber control + judicial confirmations";

  return {
    officeLabel, title, phase, phaseLabel: PHASE_LABEL[phase], seatType,
    seatLabel: incumbent ? `Incumbent — ${incumbent.name} (${incumbent.party})` : "Open seat",
    fieldSummary: fieldSummary(phase, state.candidates), moneySummary: moneySummary(state.finance),
    stakesLabel, competitivenessAvailable: false,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/__tests__/brief-layout.test.ts`
Expected: PASS (all tests, including the earlier derive tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/brief-layout.ts web/src/lib/__tests__/brief-layout.test.ts
git commit -m "feat(web): buildHeaderFacts with honest gap fallbacks"
```

---

## Task 5: buildSections (ordering + inclusion)

**Files:**
- Modify: `web/src/lib/brief-layout.ts`
- Test: `web/src/lib/__tests__/brief-layout.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `web/src/lib/__tests__/brief-layout.test.ts`:

```ts
import { buildSections } from "../brief-layout";

const ids = (s: { id: string }[]) => s.map((x) => x.id);

test("voter incumbent with bills: record present, money/news collapsed", () => {
  const s = buildSections("voter", "incumbent",
    baseState({ legislation: [{ billId: "1", title: "t", introducedDate: null, latestAction: null, memberName: "x" }], finance: [{ candidateId: "1", name: "n", party: "DEM", receipts: 1, disbursements: null, cashOnHand: null, individualContributions: null, pacContributions: null, coverageEndDate: null }], candidates: [{ candidateId: "1", name: "n", party: "DEM", status: "incumbent", photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-03" }] }));
  expect(ids(s)).toEqual(["candidates", "record", "positions", "money", "news"]);
  expect(s.find((x) => x.id === "money")!.defaultOpen).toBe(false);
  expect(s.find((x) => x.id === "positions")!.defaultOpen).toBe(true);
});

test("voter open seat: no record section", () => {
  const s = buildSections("voter", "open",
    baseState({ candidates: [{ candidateId: "1", name: "n", party: "DEM", status: "open_seat", photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-03" }] }));
  expect(ids(s)).toEqual(["candidates", "positions"]);
});

test("incumbent without bills omits the record section", () => {
  const s = buildSections("voter", "incumbent",
    baseState({ legislation: [], candidates: [{ candidateId: "1", name: "n", party: "DEM", status: "incumbent", photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-03" }] }));
  expect(ids(s)).not.toContain("record");
});

test("journalist leads with money, open by default", () => {
  const s = buildSections("journalist", "incumbent",
    baseState({ legislation: [{ billId: "1", title: "t", introducedDate: null, latestAction: null, memberName: "x" }], finance: [{ candidateId: "1", name: "n", party: "DEM", receipts: 1, disbursements: null, cashOnHand: null, individualContributions: null, pacContributions: null, coverageEndDate: null }], candidates: [{ candidateId: "1", name: "n", party: "DEM", status: "incumbent", photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-03" }] }));
  expect(ids(s)).toEqual(["candidates", "money", "record", "positions", "news"]);
  expect(s.find((x) => x.id === "money")!.defaultOpen).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/__tests__/brief-layout.test.ts`
Expected: FAIL — `buildSections` not exported.

- [ ] **Step 3: Write the implementation**

Add to `web/src/lib/brief-layout.ts`:

```ts
import type { AppMode } from "@/types/agent-state";

// Ordered section plans keyed by mode × seat type. Sections absent from state
// are filtered out in buildSections.
const SECTION_PLANS: Record<AppMode, Record<SeatType, SectionPlan[]>> = {
  voter: {
    incumbent: [
      { id: "candidates", defaultOpen: true },
      { id: "record", defaultOpen: true },
      { id: "positions", defaultOpen: true },
      { id: "money", defaultOpen: false },
      { id: "news", defaultOpen: false },
    ],
    open: [
      { id: "candidates", defaultOpen: true },
      { id: "positions", defaultOpen: true },
      { id: "money", defaultOpen: false },
      { id: "news", defaultOpen: false },
    ],
  },
  journalist: {
    incumbent: [
      { id: "candidates", defaultOpen: true },
      { id: "money", defaultOpen: true },
      { id: "record", defaultOpen: true },
      { id: "positions", defaultOpen: false },
      { id: "news", defaultOpen: false },
    ],
    open: [
      { id: "candidates", defaultOpen: true },
      { id: "money", defaultOpen: true },
      { id: "positions", defaultOpen: true },
      { id: "news", defaultOpen: false },
    ],
  },
};

function isIncluded(id: SectionId, seatType: SeatType, state: DistrictLensState): boolean {
  switch (id) {
    case "candidates": return true;
    case "positions": return true;
    case "record": return seatType === "incumbent" && state.legislation.length > 0;
    case "money": return state.finance.length > 0;
    case "news": return state.candidates.length > 0 || state.news.length > 0;
  }
}

export function buildSections(mode: AppMode, seatType: SeatType, state: DistrictLensState): SectionPlan[] {
  return SECTION_PLANS[mode][seatType].filter((p) => isIncluded(p.id, seatType, state));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/__tests__/brief-layout.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/brief-layout.ts web/src/lib/__tests__/brief-layout.test.ts
git commit -m "feat(web): buildSections ordering + honesty inclusion rules"
```

---

## Task 6: buildBriefLayout (compose)

**Files:**
- Modify: `web/src/lib/brief-layout.ts`
- Test: `web/src/lib/__tests__/brief-layout.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `web/src/lib/__tests__/brief-layout.test.ts`:

```ts
import { buildBriefLayout } from "../brief-layout";

test("buildBriefLayout returns header + sections together", () => {
  const layout = buildBriefLayout(baseState({
    candidates: [{ candidateId: "1", name: "Jane Doe", party: "DEM", status: "open_seat", photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-03" }],
  }), null);
  expect(layout.header.title).toBe("U.S. House — Wisconsin District 3");
  expect(layout.sections.map((s) => s.id)).toEqual(["candidates", "positions"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/__tests__/brief-layout.test.ts`
Expected: FAIL — `buildBriefLayout` not exported.

- [ ] **Step 3: Write the implementation**

Add to `web/src/lib/brief-layout.ts`:

```ts
export function buildBriefLayout(state: DistrictLensState, raceStatus: RaceStatus | null): BriefLayout {
  const header = buildHeaderFacts(state, raceStatus);
  const sections = buildSections(state.mode, header.seatType, state);
  return { header, sections };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/__tests__/brief-layout.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/brief-layout.ts web/src/lib/__tests__/brief-layout.test.ts
git commit -m "feat(web): buildBriefLayout composes header + section plan"
```

---

## Task 7: sortByEvidenceStrength

**Files:**
- Create: `web/src/lib/evidence-strength.ts`
- Test: `web/src/lib/__tests__/evidence-strength.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/__tests__/evidence-strength.test.ts`:

```ts
import { test, expect } from "vitest";
import { sortByEvidenceStrength } from "../evidence-strength";
import type { EvidenceCard } from "@/types/agent-state";

const card = (name: string, over: Partial<EvidenceCard>): EvidenceCard => ({
  candidateName: name, issue: "housing", answer: "an answer long enough to be a paraphrase here", sources: [], ...over,
});

test("orders by evidence strength, strongest first", () => {
  const input = [
    card("reported", { evidenceType: "reported" }),
    card("direct", { evidenceType: "direct_quote" }),
    card("voting", { evidenceType: "voting_record" }),
    card("quest", { evidenceType: "questionnaire" }),
  ];
  expect(sortByEvidenceStrength(input).map((c) => c.candidateName))
    .toEqual(["direct", "quest", "voting", "reported"]);
});

test("does not mutate the input array", () => {
  const input = [card("a", { evidenceType: "reported" }), card("b", { evidenceType: "direct_quote" })];
  sortByEvidenceStrength(input);
  expect(input.map((c) => c.candidateName)).toEqual(["a", "b"]);
});

test("cards without evidenceType fall back to a heuristic", () => {
  const quoted = card("quoted", { answer: '"I firmly support this measure for our district"' });
  const none = card("none", { answer: "No direct statement found." });
  const sorted = sortByEvidenceStrength([none, quoted]);
  expect(sorted.map((c) => c.candidateName)).toEqual(["quoted", "none"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/__tests__/evidence-strength.test.ts`
Expected: FAIL — cannot find module `../evidence-strength`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/lib/evidence-strength.ts`:

```ts
import type { EvidenceCard } from "@/types/agent-state";

const TYPE_RANK: Record<string, number> = {
  direct_quote: 0, questionnaire: 1, voting_record: 2, reported: 3,
};

const SHORT_ANSWER_THRESHOLD = 80;

// Heuristic for cards that predate the structured evidenceType field.
function heuristicRank(answer: string): number {
  if (answer.includes('"') || answer.includes("“") || answer.includes("”")) return 0;
  if (answer.length < SHORT_ANSWER_THRESHOLD || answer.toLowerCase().includes("no direct statement")) return 4;
  return 3;
}

export function evidenceRank(card: EvidenceCard): number {
  if (card.evidenceType && card.evidenceType in TYPE_RANK) return TYPE_RANK[card.evidenceType];
  return heuristicRank(card.answer);
}

// Returns a new array sorted strongest-evidence-first (stable for ties).
export function sortByEvidenceStrength(cards: EvidenceCard[]): EvidenceCard[] {
  return [...cards].sort((a, b) => evidenceRank(a) - evidenceRank(b));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/__tests__/evidence-strength.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/evidence-strength.ts web/src/lib/__tests__/evidence-strength.test.ts
git commit -m "feat(web): sortByEvidenceStrength honoring source hierarchy"
```

---

## Task 8: useRaceStatus hook

**Files:**
- Create: `web/src/lib/useRaceStatus.ts`
- Test: `web/src/lib/__tests__/useRaceStatus.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/__tests__/useRaceStatus.test.tsx`:

```tsx
import { test, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useRaceStatus } from "../useRaceStatus";

afterEach(() => vi.restoreAllMocks());

test("returns null before the fetch resolves", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  const { result } = renderHook(() => useRaceStatus("2026-H-WI-03"));
  expect(result.current).toBeNull();
});

test("returns parsed status after fetch resolves", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ status: "confirmed", winners: { DEM: "Jane" }, confidence: 1, confirmationBasis: [], flaggedReason: null, resolvedAt: null, citation: null }),
  })));
  const { result } = renderHook(() => useRaceStatus("2026-H-WI-03"));
  await waitFor(() => expect(result.current?.status).toBe("confirmed"));
});

test("returns null on a 404 / error body", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "no status" }) })));
  const { result } = renderHook(() => useRaceStatus("2026-H-WI-99"));
  await waitFor(() => expect(result.current).toBeNull());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/__tests__/useRaceStatus.test.tsx`
Expected: FAIL — cannot find module `../useRaceStatus`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/lib/useRaceStatus.ts`:

```ts
"use client";
import { useEffect, useState } from "react";
import type { RaceStatus } from "./brief-layout";

// Fetches the resolved nominee status for a race. Returns null until the fetch
// resolves, on 404 (race not resolved), or on error. Tagged with the race key
// so a previous race's status is never returned for the current one.
export function useRaceStatus(raceKey: string | null): RaceStatus | null {
  const [data, setData] = useState<(RaceStatus & { forKey: string }) | null>(null);

  useEffect(() => {
    if (!raceKey) return;
    let cancelled = false;
    fetch(`/api/race/status?race_key=${encodeURIComponent(raceKey)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json && !json.error) {
          setData({ ...(json as RaceStatus), forKey: raceKey });
        }
      })
      .catch(() => {
        /* no status yet — return null */
      });
    return () => {
      cancelled = true;
    };
  }, [raceKey]);

  if (!data || data.forKey !== raceKey) return null;
  return data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/__tests__/useRaceStatus.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/useRaceStatus.ts web/src/lib/__tests__/useRaceStatus.test.tsx
git commit -m "feat(web): useRaceStatus hook sharing the race-status fetch"
```

---

## Task 9: Refactor NomineeStatusBanner to a prop

**Files:**
- Modify: `web/src/components/canvas/NomineeStatusBanner.tsx`
- Modify: `web/src/components/canvas/__tests__/NomineeStatusBanner.test.tsx`

- [ ] **Step 1: Update the test to pass `status` as a prop**

Open `web/src/components/canvas/__tests__/NomineeStatusBanner.test.tsx`. It currently mocks `fetch` and passes `raceKey`. Replace its render calls so the banner receives a `status` object directly. Use this as the full new test file content:

```tsx
import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NomineeStatusBanner } from "../NomineeStatusBanner";
import type { RaceStatus } from "@/lib/brief-layout";

const status = (over: Partial<RaceStatus>): RaceStatus => ({
  status: "provisional", winners: {}, confidence: null, confirmationBasis: [],
  flaggedReason: null, resolvedAt: null, citation: null, ...over,
});

test("renders nothing when status is null", () => {
  const { container } = render(<NomineeStatusBanner status={null} />);
  expect(container).toBeEmptyDOMElement();
});

test("renders a confirmed nominee", () => {
  render(<NomineeStatusBanner status={status({ status: "confirmed", winners: { DEM: "Jane Doe" }, confirmationBasis: ["nbc_decision_desk"] })} />);
  expect(screen.getByText(/Nominee called/i)).toBeInTheDocument();
  expect(screen.getByText("Jane Doe")).toBeInTheDocument();
});

test("renders a not-yet-called provisional state", () => {
  render(<NomineeStatusBanner status={status({ status: "provisional" })} />);
  expect(screen.getByText(/Not yet called/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/canvas/__tests__/NomineeStatusBanner.test.tsx`
Expected: FAIL — `NomineeStatusBanner` still requires `raceKey`, not `status`.

- [ ] **Step 3: Refactor the component**

Replace the full contents of `web/src/components/canvas/NomineeStatusBanner.tsx` with the following. The only changes from the current file: the local `NomineeStatus` interface is replaced by an import of `RaceStatus`, the `useEffect`/`useState`/`fetch` block and the `react` import are removed, and the component now takes a `status` prop. All rendering helpers and status branches are preserved verbatim.

```tsx
"use client";
import type { RaceStatus } from "@/lib/brief-layout";

const PARTY_DOT: Record<string, string> = {
  DEM: "bg-blue-600",
  REP: "bg-red-600",
  IND: "bg-slate-400",
};

const TONE: Record<string, { box: string; label: string }> = {
  green: { box: "border-green-300 bg-green-50", label: "text-green-800" },
  amber: { box: "border-amber-300 bg-amber-50", label: "text-amber-800" },
  indigo: { box: "border-indigo-300 bg-indigo-50", label: "text-indigo-800" },
  slate: { box: "border-slate-200 bg-slate-50", label: "text-slate-600" },
};

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function WinnerList({ winners }: { winners: Record<string, string> }) {
  const entries = Object.entries(winners);
  if (entries.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-1">
      {entries.map(([party, name]) => (
        <li key={party} className="flex items-center gap-2 text-sm text-slate-900">
          <span className={`h-2 w-2 shrink-0 rounded-full ${PARTY_DOT[party.toUpperCase()] ?? "bg-slate-400"}`} />
          <span className="font-medium">{name}</span>
          <span className="text-xs text-slate-500">({party.toUpperCase()})</span>
        </li>
      ))}
    </ul>
  );
}

function SourceLine({
  source,
  date,
  citation,
}: {
  source: string;
  date: string | null;
  citation: { url: string; publisher: string } | null;
}) {
  return (
    <p className="mt-1.5 text-xs text-slate-500">
      via {source}
      {date && ` · ${date}`}
      {citation?.url && (
        <>
          {" · "}
          <a
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 hover:underline"
          >
            source
          </a>
        </>
      )}
    </p>
  );
}

function Banner({
  tone,
  label,
  children,
}: {
  tone: keyof typeof TONE;
  label: string;
  children: React.ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div className={`rounded-[2px] border ${t.box} px-4 py-3`}>
      <p className={`text-xs font-semibold uppercase tracking-widest ${t.label}`}>{label}</p>
      {children}
    </div>
  );
}

export function NomineeStatusBanner({ status }: { status: RaceStatus | null }) {
  if (!status) return null;
  const data = status;

  const date = fmtDate(data.resolvedAt);
  const hasWinners = Object.keys(data.winners ?? {}).length > 0;
  const isProjected = (data.flaggedReason ?? "").includes("projected");
  const viaNbc = data.confirmationBasis?.includes("nbc_decision_desk");

  if (data.status === "confirmed") {
    return (
      <Banner tone="green" label="✓ Nominee called">
        <WinnerList winners={data.winners} />
        <SourceLine source={viaNbc ? "NBC Decision Desk" : "official results"} date={date} citation={data.citation} />
      </Banner>
    );
  }

  if (data.status === "runoff_pending") {
    return (
      <Banner tone="amber" label="Runoff pending">
        <p className="mt-1 text-sm text-amber-800">No nominee yet — this race advances to a runoff.</p>
      </Banner>
    );
  }

  if (data.status === "provisional" && isProjected && hasWinners) {
    return (
      <Banner tone="indigo" label="Projected · unofficial">
        <WinnerList winners={data.winners} />
        <SourceLine source="news projection — not an official call" date={date} citation={data.citation} />
      </Banner>
    );
  }

  if (data.status === "provisional") {
    return (
      <Banner tone="slate" label="Not yet called">
        <p className="mt-1 text-sm text-slate-500">Official primary results aren’t available yet.</p>
      </Banner>
    );
  }

  if (data.status === "contested") {
    return (
      <Banner tone="amber" label="Contested">
        <p className="mt-1 text-sm text-amber-800">Sources disagree on the outcome — flagged for review.</p>
      </Banner>
    );
  }

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/canvas/__tests__/NomineeStatusBanner.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/canvas/NomineeStatusBanner.tsx web/src/components/canvas/__tests__/NomineeStatusBanner.test.tsx
git commit -m "refactor(web): NomineeStatusBanner renders from a status prop"
```

---

## Task 10: DecisionHeader component

**Files:**
- Create: `web/src/components/canvas/DecisionHeader.tsx`
- Test: `web/src/components/canvas/__tests__/DecisionHeader.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/canvas/__tests__/DecisionHeader.test.tsx`:

```tsx
import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DecisionHeader } from "../DecisionHeader";
import type { HeaderFacts } from "@/lib/brief-layout";

const facts: HeaderFacts = {
  officeLabel: "U.S. House", title: "U.S. House — Wisconsin District 3",
  phase: "primary", phaseLabel: "Primary · winner advances to November",
  seatType: "open", seatLabel: "Open seat", fieldSummary: "4 Democrats · 3 Republicans",
  moneySummary: "$4.3M raised · top Smith $2.1M", stakesLabel: "1 of 435 U.S. House seats",
  competitivenessAvailable: false,
};

test("renders title, phase, and all four fact cells", () => {
  render(<DecisionHeader facts={facts} />);
  expect(screen.getByText("U.S. House — Wisconsin District 3")).toBeInTheDocument();
  expect(screen.getByText(/Primary · winner advances/)).toBeInTheDocument();
  expect(screen.getByText("Open seat")).toBeInTheDocument();
  expect(screen.getByText("4 Democrats · 3 Republicans")).toBeInTheDocument();
  expect(screen.getByText("$4.3M raised · top Smith $2.1M")).toBeInTheDocument();
  expect(screen.getByText("1 of 435 U.S. House seats")).toBeInTheDocument();
});

test("always shows the honest competitiveness gap row", () => {
  render(<DecisionHeader facts={facts} />);
  expect(screen.getByText(/Competitiveness rating — not yet available/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/canvas/__tests__/DecisionHeader.test.tsx`
Expected: FAIL — cannot find module `../DecisionHeader`.

- [ ] **Step 3: Write the implementation**

Create `web/src/components/canvas/DecisionHeader.tsx`:

```tsx
import type { HeaderFacts } from "@/lib/brief-layout";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm text-slate-900">{value}</p>
    </div>
  );
}

export function DecisionHeader({ facts }: { facts: HeaderFacts }) {
  return (
    <div className="rounded-[2px] border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">{facts.title}</h2>
      <p className="mt-0.5 text-xs text-slate-500">{facts.phaseLabel}</p>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Fact label="Seat" value={facts.seatLabel} />
        <Fact label="Field" value={facts.fieldSummary} />
        <Fact label="Money" value={facts.moneySummary} />
        <Fact label="At stake" value={facts.stakesLabel} />
      </div>

      <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-400">
        Competitiveness rating — not yet available
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/canvas/__tests__/DecisionHeader.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/canvas/DecisionHeader.tsx web/src/components/canvas/__tests__/DecisionHeader.test.tsx
git commit -m "feat(web): DecisionHeader scoreboard with honest competitiveness gap"
```

---

## Task 11: CandidateField component

**Files:**
- Create: `web/src/components/canvas/CandidateField.tsx`
- Test: `web/src/components/canvas/__tests__/CandidateField.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/canvas/__tests__/CandidateField.test.tsx`:

```tsx
import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CandidateField } from "../CandidateField";
import type { CandidateCard } from "@/types/agent-state";

const mk = (name: string, party: string, status = "challenger"): CandidateCard => ({
  candidateId: name, name, party, status, photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-03",
});

test("primary phase groups by party with column headings", () => {
  render(<CandidateField candidates={[mk("Ann", "DEM"), mk("Bob", "REP")]} financeByCandidate={{}} phase="primary" />);
  expect(screen.getByText(/Democratic/i)).toBeInTheDocument();
  expect(screen.getByText(/Republican/i)).toBeInTheDocument();
  expect(screen.getByText("Ann")).toBeInTheDocument();
  expect(screen.getByText("Bob")).toBeInTheDocument();
});

test("called phase renders a flat field (no party headings)", () => {
  render(<CandidateField candidates={[mk("Ann", "DEM", "incumbent"), mk("Bob", "REP")]} financeByCandidate={{}} phase="called" />);
  expect(screen.queryByText(/Democratic primary/i)).not.toBeInTheDocument();
  expect(screen.getByText("Ann")).toBeInTheDocument();
  expect(screen.getByText("Bob")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/canvas/__tests__/CandidateField.test.tsx`
Expected: FAIL — cannot find module `../CandidateField`.

- [ ] **Step 3: Write the implementation**

Create `web/src/components/canvas/CandidateField.tsx`:

```tsx
import type { CandidateCard as CandidateCardType, FinanceSummary } from "@/types/agent-state";
import type { RacePhase } from "@/lib/brief-layout";
import { CandidateCard } from "./CandidateCard";

interface Props {
  candidates: CandidateCardType[];
  financeByCandidate: Record<string, FinanceSummary>;
  phase: RacePhase;
}

const PARTY_HEADING: Record<string, string> = {
  DEM: "Democratic primary", REP: "Republican primary", IND: "Independent",
};

function partyHeading(party: string): string {
  return PARTY_HEADING[party.toUpperCase()] ?? `${party} field`;
}

function groupByParty(candidates: CandidateCardType[]): Array<[string, CandidateCardType[]]> {
  const groups = new Map<string, CandidateCardType[]>();
  for (const c of candidates) {
    const key = c.party.toUpperCase();
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const order = ["DEM", "REP", ...[...groups.keys()].filter((k) => k !== "DEM" && k !== "REP").sort()];
  return order.filter((k) => groups.has(k)).map((k) => [k, groups.get(k)!]);
}

export function CandidateField({ candidates, financeByCandidate, phase }: Props) {
  if (phase === "called") {
    return (
      <div className="space-y-2">
        {candidates.map((c) => (
          <CandidateCard key={c.candidateId} candidate={c} finance={financeByCandidate[c.candidateId] ?? null} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {groupByParty(candidates).map(([party, group]) => (
        <div key={party} className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">{partyHeading(party)}</p>
          {group.map((c) => (
            <CandidateCard key={c.candidateId} candidate={c} finance={financeByCandidate[c.candidateId] ?? null} />
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/canvas/__tests__/CandidateField.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/canvas/CandidateField.tsx web/src/components/canvas/__tests__/CandidateField.test.tsx
git commit -m "feat(web): CandidateField groups by party in primary, flat when called"
```

---

## Task 12: CollapsibleSection component

**Files:**
- Create: `web/src/components/canvas/CollapsibleSection.tsx`
- Test: `web/src/components/canvas/__tests__/CollapsibleSection.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/canvas/__tests__/CollapsibleSection.test.tsx`:

```tsx
import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CollapsibleSection } from "../CollapsibleSection";

test("renders the title and children", () => {
  render(<CollapsibleSection title="Money detail" defaultOpen><p>inner content</p></CollapsibleSection>);
  expect(screen.getByText("Money detail")).toBeInTheDocument();
  expect(screen.getByText("inner content")).toBeInTheDocument();
});

test("collapsed by default when defaultOpen is false", () => {
  render(<CollapsibleSection title="Recent news" defaultOpen={false}><p>hidden</p></CollapsibleSection>);
  const details = screen.getByText("Recent news").closest("details");
  expect(details).not.toHaveAttribute("open");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/canvas/__tests__/CollapsibleSection.test.tsx`
Expected: FAIL — cannot find module `../CollapsibleSection`.

- [ ] **Step 3: Write the implementation**

Create `web/src/components/canvas/CollapsibleSection.tsx`:

```tsx
import type { ReactNode } from "react";

interface Props {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({ title, defaultOpen = false, children }: Props) {
  return (
    <details open={defaultOpen} className="group rounded-[2px] border border-slate-200 bg-white open:bg-slate-50/40">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 select-none">
        <span className="text-xs font-medium uppercase tracking-widest text-slate-500">{title}</span>
        <span className="text-slate-400 transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="border-t border-slate-100 p-3">{children}</div>
    </details>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/canvas/__tests__/CollapsibleSection.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/canvas/CollapsibleSection.tsx web/src/components/canvas/__tests__/CollapsibleSection.test.tsx
git commit -m "feat(web): generic CollapsibleSection wrapper"
```

---

## Task 13: Rewire RaceCanvas to the descriptor

**Files:**
- Modify: `web/src/components/canvas/RaceCanvas.tsx`
- Test: `web/src/components/canvas/__tests__/RaceCanvas.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/canvas/__tests__/RaceCanvas.test.tsx`:

```tsx
import { test, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RaceCanvas } from "../RaceCanvas";
import { DEFAULT_STATE, type DistrictLensState } from "@/types/agent-state";

afterEach(() => vi.restoreAllMocks());

const state = (over: Partial<DistrictLensState>): DistrictLensState => ({
  ...DEFAULT_STATE, stage: "complete", currentRaceKey: "2026-H-WI-03", ...over,
});

test("idle state shows the empty prompt", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  render(<RaceCanvas state={state({ stage: "idle", currentRaceKey: null })} />);
  expect(screen.getByText(/Enter an address or click a state/i)).toBeInTheDocument();
});

test("renders the decision header for a resolved race", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  render(<RaceCanvas state={state({
    candidates: [{ candidateId: "1", name: "Jane Doe", party: "DEM", status: "open_seat", photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-03" }],
  })} />);
  expect(screen.getByText("U.S. House — Wisconsin District 3")).toBeInTheDocument();
  expect(screen.getByText(/Competitiveness rating — not yet available/)).toBeInTheDocument();
});

test("shows the honest empty state when there are no positions", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  render(<RaceCanvas state={state({
    candidates: [{ candidateId: "1", name: "Jane Doe", party: "DEM", status: "open_seat", photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-03" }],
  })} />);
  expect(screen.getByText(/No position evidence found in indexed sources/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/canvas/__tests__/RaceCanvas.test.tsx`
Expected: FAIL — the current `RaceCanvas` renders neither the `DecisionHeader` title nor the positions empty state.

- [ ] **Step 3: Rewrite RaceCanvas**

Replace the full contents of `web/src/components/canvas/RaceCanvas.tsx` with:

```tsx
"use client";
import type { DistrictLensState, EvidenceCard, SectionId } from "@/types/agent-state";
import { DecisionHeader } from "./DecisionHeader";
import { NomineeStatusBanner } from "./NomineeStatusBanner";
import { CandidateField } from "./CandidateField";
import { CollapsibleSection } from "./CollapsibleSection";
import { FinanceChart } from "./FinanceChart";
import { BillFeed } from "./BillFeed";
import { NewsCard } from "./NewsCard";
import { NewsAccordion } from "./NewsAccordion";
import { IssueAccordion } from "./IssueAccordion";
import { CanVoteStrip } from "./CanVoteStrip";
import { buildBriefLayout, type SectionPlan } from "@/lib/brief-layout";
import { sortByEvidenceStrength } from "@/lib/evidence-strength";
import { useRaceStatus } from "@/lib/useRaceStatus";
import { stateCodeFromRaceKey } from "@/lib/states";

interface Props {
  state: DistrictLensState;
}

function groupByIssue(positions: EvidenceCard[]): Array<[string, EvidenceCard[]]> {
  const groups = new Map<string, EvidenceCard[]>();
  for (const position of positions) {
    groups.set(position.issue, [...(groups.get(position.issue) ?? []), position]);
  }
  return Array.from(groups.entries());
}

export function RaceCanvas({ state }: Props) {
  const raceStatus = useRaceStatus(state.currentRaceKey);

  if (state.stage === "idle" || !state.currentRaceKey) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-slate-400">
        Enter an address or click a state on the map to get started.
      </div>
    );
  }

  const layout = buildBriefLayout(state, raceStatus);
  const financeByCandidate = Object.fromEntries(state.finance.map((s) => [s.candidateId, s]));
  const stateCode = stateCodeFromRaceKey(state.currentRaceKey);
  const isVoter = state.mode === "voter";

  const renderSection = (plan: SectionPlan) => {
    switch (plan.id) {
      case "candidates":
        return (
          <div key="candidates" className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-widest text-slate-500">Candidates · FEC 2026</p>
            <CandidateField candidates={state.candidates} financeByCandidate={financeByCandidate} phase={layout.header.phase} />
          </div>
        );
      case "record":
        return (
          <CollapsibleSection key="record" title={`Legislative record · ${state.legislation[0]?.memberName ?? ""}`.trim()} defaultOpen={plan.defaultOpen}>
            <BillFeed legislation={state.legislation} memberName={state.legislation[0]?.memberName} />
          </CollapsibleSection>
        );
      case "positions":
        return (
          <CollapsibleSection key="positions" title="Issue positions · Perplexity" defaultOpen={plan.defaultOpen}>
            {state.positions.length === 0 ? (
              <p className="text-sm text-slate-500">No position evidence found in indexed sources.</p>
            ) : (
              <div className="space-y-2">
                {groupByIssue(state.positions).map(([issue, cards], index) => (
                  <IssueAccordion key={issue} issue={issue} cards={sortByEvidenceStrength(cards)} defaultOpen={index === 0} />
                ))}
              </div>
            )}
          </CollapsibleSection>
        );
      case "money":
        return (
          <CollapsibleSection key="money" title="Campaign finance · FEC" defaultOpen={plan.defaultOpen}>
            <FinanceChart finance={state.finance} />
          </CollapsibleSection>
        );
      case "news":
        return (
          <CollapsibleSection key="news" title="Recent news · Perplexity" defaultOpen={plan.defaultOpen}>
            {state.news.length > 0 && <NewsCard news={state.news} />}
            <div className="mt-2 space-y-2">
              {state.candidates.map((c) => (
                <NewsAccordion key={c.candidateId} candidateName={c.name} />
              ))}
            </div>
          </CollapsibleSection>
        );
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
      <DecisionHeader facts={layout.header} />
      <NomineeStatusBanner status={raceStatus} />
      {isVoter && stateCode && <CanVoteStrip stateCode={stateCode} />}
      {layout.sections.map(renderSection)}
    </div>
  );
}
```

- [ ] **Step 4: Add the `SectionId` re-export used by the import**

`RaceCanvas` imports `SectionId` from `@/types/agent-state` for clarity, but the type lives in `brief-layout`. To keep the import path honest, change the `RaceCanvas` import line from:

```ts
import type { DistrictLensState, EvidenceCard, SectionId } from "@/types/agent-state";
```

to:

```ts
import type { DistrictLensState, EvidenceCard } from "@/types/agent-state";
```

(`SectionId` is not referenced in the file body — `SectionPlan` is imported from `@/lib/brief-layout` instead. Remove the unused `SectionId` to satisfy lint.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/canvas/__tests__/RaceCanvas.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Run lint on the rewritten file**

Run: `cd web && npx eslint src/components/canvas/RaceCanvas.tsx`
Expected: no errors (no unused imports).

- [ ] **Step 7: Commit**

```bash
git add web/src/components/canvas/RaceCanvas.tsx web/src/components/canvas/__tests__/RaceCanvas.test.tsx
git commit -m "feat(web): rewire RaceCanvas to the brief-layout descriptor"
```

---

## Task 14: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full web test suite**

Run: `cd web && npx vitest run`
Expected: PASS — all suites green, including the pre-existing canvas tests (CandidateCard, EvidenceCard, IssueAccordion, NewsAccordion, RaceTable, ReceiptProgress, CanVoteStrip, fmtMoney) and the new ones.

- [ ] **Step 2: Lint the whole changed surface**

Run: `cd web && npx eslint src/lib src/components/canvas`
Expected: no errors.

- [ ] **Step 3: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Manual browser verification (golden path)**

Use the `browse` or `run` skill (or `npm run dev` in `web/`) and drive the prod voter flow. Note: `AGENT_URL` in `web/.env.local` points at the prod agent, so full briefs take ~30–60s. Verify on at least two races:

- A resolved/incumbent race (e.g. enter an address resolving to a race with a called nominee): decision header shows title, phase "Nominee called · general", incumbent named in SEAT, the legislative-record section is present and open, money + news collapsed, the honest competitiveness row is visible.
- An open-seat primary: candidates render in DEM | REP columns, no legislative-record section, positions open, money/news collapsed.
- Toggle journalist mode: money section leads and is open.

Confirm there are no console errors and the nominee badge still renders (now fed by the shared `useRaceStatus`).

- [ ] **Step 5: Final commit if any verification fixes were needed**

Only if Steps 1–4 surfaced fixes:

```bash
git add -A
git commit -m "fix(web): address verification findings in brief reorg"
```

---

## Post-merge deploy notes (not part of TDD tasks)

These are operational follow-ups for when the reorg ships to prod — flagged in the spec, handled outside this plan:

1. **Web deploy is blocked** by the uncommitted pnpm→bun migration (`web/package.json` + `web/bun.lock` vs committed `pnpm-lock.yaml`; the Dockerfile uses `pnpm install --frozen-lockfile`). Resolve or stash before `gcloud run deploy districtlens-web --source web`.
2. Shipping this redeploys web, which also brings the already-committed `f377a25` evidence-strength labels + chat-path fix live.
3. After redeploy, clear the stale `evidence_cache` positions entries (7-day TTL, `query_type:"positions"`) so they regenerate with the new prompt.
