# DistrictLens v3 Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the DistrictLens frontend to deliver the v3 design — empty state hero, evidence-first receipt canvas, journalist heatmap + race table — on top of the existing CopilotKit + AG-UI wire protocol without changing any backend code.

**Architecture:** The agent on Cloud Run pushes `STATE_DELTA` events via the AG-UI protocol; `useCoAgent` in React applies them to `DistrictLensState`. The receipt steps are derived from `state.stage` in the frontend — no backend changes needed. All visual changes are pure React/Tailwind.

**Tech Stack:** Next.js 15 (App Router), React, TypeScript, Tailwind CSS, `@copilotkit/react-core`, `@copilotkit/react-ui`, `react-simple-maps`, HeroUI

---

## File Map

**Create:**
- `web/src/lib/steps.ts` — pure function: `ResearchStage → BriefStep[]`
- `web/src/components/canvas/CanvasEmptyState.tsx` — hero empty state with address CTA
- `web/src/components/canvas/ReceiptProgress.tsx` — steps checklist + timer
- `web/src/components/canvas/RaceTable.tsx` — journalist sortable race table
- `web/src/components/StartPanel.tsx` — left panel (Start options + race chip)

**Modify:**
- `web/src/types/agent-state.ts` — add `BriefStep`, `briefStartedAt`, update `DistrictLensState`
- `web/src/components/canvas/RaceCanvas.tsx` — reorder evidence-first, swap progress component, add complete state + Share brief
- `web/src/components/canvas/EvidenceCard.tsx` — purple border, issue pill, confidence label
- `web/src/components/canvas/CandidateCard.tsx` — party color left border + inline finance
- `web/src/components/canvas/FinanceChart.tsx` — gap multiplier label
- `web/src/components/map/USMap.tsx` — heatmap mode for journalist
- `web/src/app/page.tsx` — new layout, empty state wiring, journalist toggle, timer start

**Delete:**
- `web/src/components/canvas/ResearchProgress.tsx` — replaced by `ReceiptProgress`

---

## Task 1: Extend state types

**Files:**
- Modify: `web/src/types/agent-state.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// web/src/lib/__tests__/steps.test.ts
import { stepsFromStage } from "@/lib/steps";

test("idle stage returns empty steps", () => {
  expect(stepsFromStage("idle")).toHaveLength(0);
});

test("candidates stage marks first two steps done", () => {
  const steps = stepsFromStage("candidates");
  expect(steps[0].status).toBe("done");
  expect(steps[1].status).toBe("done");
  expect(steps[2].status).toBe("pending");
});

test("complete stage marks all steps done", () => {
  const steps = stepsFromStage("complete");
  expect(steps.every((s) => s.status === "done")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/lib/__tests__/steps.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/steps'`

- [ ] **Step 3: Add `BriefStep` type and extend `DistrictLensState`**

Replace the contents of `web/src/types/agent-state.ts` with:

```typescript
export type ResearchStage =
  | "idle"
  | "district"
  | "candidates"
  | "finance"
  | "legislation"
  | "news"
  | "complete";

export type StepStatus = "pending" | "running" | "done";

export interface BriefStep {
  label: string;
  status: StepStatus;
}

export type AppMode = "voter" | "journalist";
export type PartyCode = "DEM" | "REP" | "IND" | string;
export type CandidateStatus = "incumbent" | "challenger" | "open_seat" | string;
export type PhotoSource = "bioguide" | "ballotpedia" | "placeholder";

export interface CandidateCard {
  candidateId: string;
  name: string;
  party: PartyCode;
  status: CandidateStatus;
  photoUrl: string;
  photoSource: PhotoSource;
  raceKey: string;
}

export interface FinanceSummary {
  candidateId: string;
  name: string;
  party: PartyCode;
  receipts: number | null;
  disbursements: number | null;
  cashOnHand: number | null;
  individualContributions: number | null;
  pacContributions: number | null;
  coverageEndDate: string | null;
}

export interface BillRecord {
  billId: string;
  title: string;
  introducedDate: string | null;
  latestAction: string | null;
  memberName: string;
}

export interface NewsItem {
  title: string;
  url: string;
  date: string | null;
  snippet: string;
  source: string;
}

export interface EvidenceCard {
  candidateName: string;
  issue: string;
  answer: string;
  sources: Array<{ title: string; url: string; date: string | null; snippet: string }>;
}

export interface RaceRow {
  raceKey: string;
  state: string;
  office: string;
  district: string;
  incumbentName: string | null;
  incumbentParty: PartyCode | null;
  incumbentReceipts: number | null;
  topChallengerName: string | null;
  topChallengerReceipts: number | null;
  financeGap: number | null;
  pacPct: number | null;
}

export interface DistrictLensState {
  mode: AppMode;
  mapFocus: string | null;
  currentRaceKey: string | null;
  stage: ResearchStage;
  briefStartedAt: number | null;   // ms timestamp, set when stage leaves idle
  candidates: CandidateCard[];
  finance: FinanceSummary[];
  legislation: BillRecord[];
  news: NewsItem[];
  positions: EvidenceCard[];
  stateRaces: RaceRow[];
  comparisons: RaceRow[];
  briefMarkdown: string | null;
  briefReady: boolean;
}

export const DEFAULT_STATE: DistrictLensState = {
  mode: "voter",
  mapFocus: null,
  currentRaceKey: null,
  stage: "idle",
  briefStartedAt: null,
  candidates: [],
  finance: [],
  legislation: [],
  news: [],
  positions: [],
  stateRaces: [],
  comparisons: [],
  briefMarkdown: null,
  briefReady: false,
};
```

- [ ] **Step 4: Create `web/src/lib/steps.ts`**

```typescript
import type { BriefStep, ResearchStage } from "@/types/agent-state";

const STEP_LABELS = [
  "District resolved",
  "Candidates loaded",
  "Finance pulled",
  "Positions searched",
  "Legislation loaded",
  "Brief complete",
] as const;

const STAGE_DONE_COUNT: Record<ResearchStage, number> = {
  idle: 0,
  district: 1,
  candidates: 2,
  finance: 3,
  legislation: 4,
  news: 4,
  complete: 6,
};

const STAGE_RUNNING_INDEX: Record<ResearchStage, number | null> = {
  idle: null,
  district: 0,
  candidates: 1,
  finance: 2,
  legislation: 3,
  news: 3,
  complete: null,
};

export function stepsFromStage(stage: ResearchStage): BriefStep[] {
  if (stage === "idle") return [];
  const doneCount = STAGE_DONE_COUNT[stage];
  const runningIdx = STAGE_RUNNING_INDEX[stage];
  return STEP_LABELS.map((label, i): BriefStep => {
    if (i < doneCount) return { label, status: "done" };
    if (i === runningIdx) return { label, status: "running" };
    return { label, status: "pending" };
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd web && npx vitest run src/lib/__tests__/steps.test.ts
```
Expected: PASS — 3 tests

- [ ] **Step 6: Commit**

```bash
git add web/src/types/agent-state.ts web/src/lib/steps.ts web/src/lib/__tests__/steps.test.ts
git commit -m "feat(v3): BriefStep type + stepsFromStage util"
```

---

## Task 2: ReceiptProgress component

**Files:**
- Create: `web/src/components/canvas/ReceiptProgress.tsx`
- Delete: `web/src/components/canvas/ResearchProgress.tsx` (after this task)

- [ ] **Step 1: Write the failing test**

```typescript
// web/src/components/canvas/__tests__/ReceiptProgress.test.tsx
import { render, screen } from "@testing-library/react";
import { ReceiptProgress } from "../ReceiptProgress";

test("renders running step with amber text", () => {
  const steps = [
    { label: "District resolved", status: "done" as const },
    { label: "Candidates loaded", status: "running" as const },
    { label: "Finance pulled", status: "pending" as const },
  ];
  render(<ReceiptProgress steps={steps} briefStartedAt={Date.now() - 5000} />);
  expect(screen.getByText("Candidates loaded")).toBeInTheDocument();
  expect(screen.getByText(/sec left/)).toBeInTheDocument();
});

test("shows green complete bar when all steps done", () => {
  const steps = [
    { label: "District resolved", status: "done" as const },
    { label: "Brief complete", status: "done" as const },
  ];
  const { container } = render(<ReceiptProgress steps={steps} briefStartedAt={Date.now() - 10000} />);
  expect(container.querySelector(".bg-green-500")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/components/canvas/__tests__/ReceiptProgress.test.tsx
```
Expected: FAIL

- [ ] **Step 3: Create `web/src/components/canvas/ReceiptProgress.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import type { BriefStep } from "@/types/agent-state";

const ESTIMATED_TOTAL_MS = 30_000;

interface Props {
  steps: BriefStep[];
  briefStartedAt: number | null;
}

export function ReceiptProgress({ steps, briefStartedAt }: Props) {
  const [secsLeft, setSecsLeft] = useState<number | null>(null);
  const isComplete = steps.length > 0 && steps.every((s) => s.status === "done");

  useEffect(() => {
    if (!briefStartedAt || isComplete) { setSecsLeft(null); return; }
    const tick = () => {
      const elapsed = Date.now() - briefStartedAt;
      const remaining = Math.max(0, Math.ceil((ESTIMATED_TOTAL_MS - elapsed) / 1000));
      setSecsLeft(remaining);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [briefStartedAt, isComplete]);

  if (steps.length === 0) return null;

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        {isComplete ? (
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs font-semibold text-green-700 uppercase tracking-widest">
              Brief complete
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-xs font-semibold text-blue-700 uppercase tracking-widest">
              Building brief
            </span>
          </div>
        )}
        {secsLeft !== null && secsLeft > 0 && (
          <span className="text-xs text-slate-400">~{secsLeft}s left</span>
        )}
      </div>

      {/* Steps */}
      <div className="space-y-1">
        {steps.map((step) => (
          <div key={step.label} className="flex items-center gap-2">
            {step.status === "done" && (
              <span className="text-green-600 text-xs w-4 shrink-0">✓</span>
            )}
            {step.status === "running" && (
              <span className="text-amber-500 text-xs w-4 shrink-0 animate-spin">⟳</span>
            )}
            {step.status === "pending" && (
              <span className="text-slate-300 text-xs w-4 shrink-0">○</span>
            )}
            <span
              className={[
                "text-xs",
                step.status === "done" && "text-slate-400 line-through",
                step.status === "running" && "text-amber-600 font-medium",
                step.status === "pending" && "text-slate-400",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && npx vitest run src/components/canvas/__tests__/ReceiptProgress.test.tsx
```
Expected: PASS

- [ ] **Step 5: Delete old ResearchProgress**

```bash
rm web/src/components/canvas/ResearchProgress.tsx
```

- [ ] **Step 6: Commit**

```bash
git add web/src/components/canvas/ReceiptProgress.tsx web/src/components/canvas/__tests__/ReceiptProgress.test.tsx
git rm web/src/components/canvas/ResearchProgress.tsx
git commit -m "feat(v3): ReceiptProgress component with timer + remove ResearchProgress"
```

---

## Task 3: Redesign EvidenceCard

**Files:**
- Modify: `web/src/components/canvas/EvidenceCard.tsx`

Plain English: the evidence card gets a purple left border, issue tag pill, and a confidence label ("direct quote" / "no statement found") derived from the answer length.

- [ ] **Step 1: Write the failing test**

```typescript
// web/src/components/canvas/__tests__/EvidenceCard.test.tsx
import { render, screen } from "@testing-library/react";
import { EvidenceCard } from "../EvidenceCard";

const mockEvidence = {
  candidateName: "Gwen Moore",
  issue: "housing",
  answer: "Moore supports the Housing Affordability Act and has co-sponsored legislation to expand affordable housing funding in urban areas.",
  sources: [{ title: "Ballotpedia", url: "https://ballotpedia.org/Gwen_Moore", date: "2026-03-14", snippet: "" }],
};

test("renders issue tag as uppercase pill", () => {
  render(<EvidenceCard evidence={mockEvidence} />);
  expect(screen.getByText("HOUSING")).toBeInTheDocument();
});

test("renders candidate name", () => {
  render(<EvidenceCard evidence={mockEvidence} />);
  expect(screen.getByText("Gwen Moore")).toBeInTheDocument();
});

test("renders clickable source URL", () => {
  render(<EvidenceCard evidence={mockEvidence} />);
  expect(screen.getByRole("link", { name: "Ballotpedia" })).toHaveAttribute(
    "href",
    "https://ballotpedia.org/Gwen_Moore"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/components/canvas/__tests__/EvidenceCard.test.tsx
```
Expected: FAIL — "HOUSING" not found (currently renders lowercase)

- [ ] **Step 3: Replace `web/src/components/canvas/EvidenceCard.tsx`**

```tsx
"use client";
import type { EvidenceCard as EvidenceCardType } from "@/types/agent-state";

interface Props { evidence: EvidenceCardType; }

function confidenceLabel(answer: string): string {
  if (answer.length < 80 || answer.toLowerCase().includes("no direct statement")) {
    return "no statement found";
  }
  if (answer.includes('"') || answer.includes("“")) return "direct quote";
  return "paraphrase";
}

export function EvidenceCard({ evidence }: Props) {
  const confidence = confidenceLabel(evidence.answer);
  const confidenceColor =
    confidence === "direct quote"
      ? "text-green-700"
      : confidence === "paraphrase"
      ? "text-amber-700"
      : "text-slate-500";

  return (
    <div className="rounded-[2px] border-l-4 border-l-purple-500 border border-slate-200 bg-white p-4 space-y-2">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700 uppercase tracking-wider">
          {evidence.issue}
        </span>
        <span className={`text-xs font-medium ${confidenceColor}`}>{confidence}</span>
      </div>

      <p className="text-sm font-semibold text-slate-900">{evidence.candidateName}</p>

      <p className="text-sm text-slate-700 leading-relaxed italic whitespace-pre-wrap">
        {evidence.answer}
      </p>

      {evidence.sources.length > 0 && (
        <div className="space-y-1 border-t border-slate-100 pt-2">
          {evidence.sources.slice(0, 3).map((s, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="text-xs font-mono text-purple-400 shrink-0">[{i + 1}]</span>
              <div>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-700 hover:underline"
                >
                  {s.title}
                </a>
                {s.date && <span className="text-xs text-slate-400 ml-1">· {s.date}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400 border-t border-slate-100 pt-2">
        Evidence from public sources only. DistrictLens never recommends how to vote.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && npx vitest run src/components/canvas/__tests__/EvidenceCard.test.tsx
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/canvas/EvidenceCard.tsx web/src/components/canvas/__tests__/EvidenceCard.test.tsx
git commit -m "feat(v3): EvidenceCard — purple border, issue pill, confidence label"
```

---

## Task 4: Redesign CandidateCard with inline finance

**Files:**
- Modify: `web/src/components/canvas/CandidateCard.tsx`

Plain English: add a party-colored left border and show the candidate's finance total + PAC % inline on the card. The `finance` array from state needs to be passed in.

- [ ] **Step 1: Write the failing test**

```typescript
// web/src/components/canvas/__tests__/CandidateCard.test.tsx
import { render, screen } from "@testing-library/react";
import { CandidateCard } from "../CandidateCard";

const candidate = {
  candidateId: "P001",
  name: "Gwen Moore",
  party: "DEM",
  status: "incumbent",
  photoUrl: "",
  photoSource: "placeholder" as const,
  raceKey: "2026-H-WI-04",
};

const finance = {
  candidateId: "P001",
  name: "Gwen Moore",
  party: "DEM",
  receipts: 844000,
  disbursements: null,
  cashOnHand: null,
  individualContributions: 328000,
  pacContributions: 516000,
  coverageEndDate: null,
};

test("renders candidate name", () => {
  render(<CandidateCard candidate={candidate} finance={finance} />);
  expect(screen.getByText("Gwen Moore")).toBeInTheDocument();
});

test("renders finance total", () => {
  render(<CandidateCard candidate={candidate} finance={finance} />);
  expect(screen.getByText("$844K")).toBeInTheDocument();
});

test("renders PAC percentage", () => {
  render(<CandidateCard candidate={candidate} finance={finance} />);
  expect(screen.getByText(/61%/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/components/canvas/__tests__/CandidateCard.test.tsx
```
Expected: FAIL — finance prop not accepted

- [ ] **Step 3: Replace `web/src/components/canvas/CandidateCard.tsx`**

```tsx
"use client";
import { useState } from "react";
import type { CandidateCard as CandidateCardType, FinanceSummary } from "@/types/agent-state";
import { placeholderAvatarUrl } from "@/lib/bioguide";

const PARTY_BORDER: Record<string, string> = {
  DEM: "border-l-blue-600",
  REP: "border-l-red-600",
  IND: "border-l-slate-400",
};

const PARTY_BADGE: Record<string, string> = {
  DEM: "bg-blue-100 text-blue-800 border-blue-300",
  REP: "bg-red-100 text-red-800 border-red-300",
  IND: "bg-slate-100 text-slate-800 border-slate-300",
};

const STATUS_LABELS: Record<string, string> = {
  incumbent: "Incumbent",
  challenger: "Challenger",
  open_seat: "Open Seat",
};

function fmtMoney(val: number | null): string {
  if (val == null) return "—";
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(val / 1_000)}K`;
  return `$${val}`;
}

interface Props {
  candidate: CandidateCardType;
  finance?: FinanceSummary | null;
}

export function CandidateCard({ candidate, finance }: Props) {
  const [imgSrc, setImgSrc] = useState(candidate.photoUrl);
  const partyKey = candidate.party.toUpperCase();
  const borderClass = PARTY_BORDER[partyKey] ?? "border-l-slate-400";
  const badgeClass = PARTY_BADGE[partyKey] ?? PARTY_BADGE.IND;
  const statusLabel = STATUS_LABELS[candidate.status] ?? candidate.status;

  const total = finance?.receipts ?? null;
  const pac = finance?.pacContributions ?? null;
  const pacPct = total && pac ? Math.round((pac / total) * 100) : null;

  return (
    <div className={`flex items-center gap-4 rounded-[2px] border-2 border-slate-200 border-l-4 ${borderClass} bg-white p-4`}>
      <img
        src={imgSrc}
        alt={candidate.name}
        width={48}
        height={48}
        className="rounded-full border-2 border-slate-200 object-cover shrink-0"
        onError={() => setImgSrc(placeholderAvatarUrl(candidate.name, candidate.party))}
      />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-900 truncate">{candidate.name}</p>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
            {candidate.party}
          </span>
          <span className="text-xs text-slate-500">{statusLabel}</span>
        </div>
      </div>
      {total !== null && (
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-slate-900">{fmtMoney(total)}</p>
          {pacPct !== null && (
            <p className="text-xs text-slate-500">{pacPct}% PAC</p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && npx vitest run src/components/canvas/__tests__/CandidateCard.test.tsx
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/canvas/CandidateCard.tsx web/src/components/canvas/__tests__/CandidateCard.test.tsx
git commit -m "feat(v3): CandidateCard — party border + inline finance total + PAC%"
```

---

## Task 5: FinanceChart gap multiplier

**Files:**
- Modify: `web/src/components/canvas/FinanceChart.tsx`

Plain English: add a single line below the chart that says "Moore outraises Nath 844×" when there's a significant gap.

- [ ] **Step 1: Modify `web/src/components/canvas/FinanceChart.tsx`** — add gap label after the bars:

Find the closing `</div>` of the outer `finance.map(...)` section (after the legend row) and add this section AFTER the map, before the closing `</div>` of the container:

```tsx
      {/* Gap multiplier label */}
      {(() => {
        if (finance.length < 2) return null;
        const sorted = [...finance].sort((a, b) => (b.receipts ?? 0) - (a.receipts ?? 0));
        const top = sorted[0].receipts ?? 0;
        const second = sorted[1].receipts ?? 0;
        if (second === 0 || top / second < 2) return null;
        const multiplier = Math.round(top / second);
        return (
          <p className="text-xs text-slate-500 border-t border-slate-100 pt-3 mt-1">
            ⚡ <strong>{sorted[0].name.split(" ").pop()}</strong> outraises{" "}
            <strong>{sorted[1].name.split(" ").pop()}</strong> {multiplier}×
          </p>
        );
      })()}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add web/src/components/canvas/FinanceChart.tsx
git commit -m "feat(v3): FinanceChart — gap multiplier label"
```

---

## Task 6: RaceCanvas — evidence-first + receipt + complete state

**Files:**
- Modify: `web/src/components/canvas/RaceCanvas.tsx`

Plain English: import `ReceiptProgress` and `stepsFromStage`, move positions to the top of the card list, add the "Share brief" button when complete.

- [ ] **Step 1: Replace `web/src/components/canvas/RaceCanvas.tsx`**

```tsx
"use client";
import type { DistrictLensState } from "@/types/agent-state";
import { stepsFromStage } from "@/lib/steps";
import { ReceiptProgress } from "./ReceiptProgress";
import { RaceHeader } from "./RaceHeader";
import { CandidateCard } from "./CandidateCard";
import { FinanceChart } from "./FinanceChart";
import { BillFeed } from "./BillFeed";
import { NewsCard } from "./NewsCard";
import { EvidenceCard } from "./EvidenceCard";

interface Props {
  state: DistrictLensState;
  onShareBrief: () => void;
}

export function RaceCanvas({ state, onShareBrief }: Props) {
  const steps = stepsFromStage(state.stage);
  const isComplete = state.stage === "complete";
  const sourceCount =
    state.positions.reduce((n, p) => n + p.sources.length, 0) +
    state.legislation.length;

  if (state.stage === "idle" || !state.currentRaceKey) return null;

  const financeByCandidate = Object.fromEntries(
    state.finance.map((f) => [f.candidateId, f])
  );

  return (
    <div className="flex flex-col gap-4 p-5 overflow-y-auto h-full">
      {/* Receipt progress + complete bar */}
      <div className="rounded-[2px] border border-slate-200 bg-slate-50 p-3">
        <ReceiptProgress steps={steps} briefStartedAt={state.briefStartedAt} />
        {isComplete && (
          <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">
            <span className="text-xs text-slate-500">{sourceCount} sources</span>
            <button
              onClick={onShareBrief}
              className="rounded-[2px] border-2 border-slate-900 bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700 transition-colors"
            >
              Share brief
            </button>
          </div>
        )}
      </div>

      <RaceHeader raceKey={state.currentRaceKey} />

      {/* Evidence FIRST — the differentiator */}
      {state.positions.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
            Issue Positions · Perplexity
          </p>
          {state.positions.map((ev, i) => (
            <EvidenceCard key={i} evidence={ev} />
          ))}
        </div>
      )}

      {/* Candidates */}
      {state.candidates.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
            Candidates · FEC 2026
          </p>
          {state.candidates.map((c) => (
            <CandidateCard
              key={c.candidateId}
              candidate={c}
              finance={financeByCandidate[c.candidateId] ?? null}
            />
          ))}
        </div>
      )}

      {state.finance.length > 0 && <FinanceChart finance={state.finance} />}

      {state.legislation.length > 0 && (
        <BillFeed
          legislation={state.legislation}
          memberName={state.legislation[0]?.memberName}
        />
      )}

      {state.news.length > 0 && <NewsCard news={state.news} />}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors (page.tsx will error until Task 8 — fix there)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/canvas/RaceCanvas.tsx
git commit -m "feat(v3): RaceCanvas — evidence-first, ReceiptProgress, Share brief button"
```

---

## Task 7: CanvasEmptyState + StartPanel

**Files:**
- Create: `web/src/components/canvas/CanvasEmptyState.tsx`
- Create: `web/src/components/StartPanel.tsx`

- [ ] **Step 1: Create `web/src/components/canvas/CanvasEmptyState.tsx`**

```tsx
"use client";

interface Props {
  address: string;
  onAddressChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
}

export function CanvasEmptyState({ address, onAddressChange, onSubmit, loading }: Props) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-10 text-center gap-4">
      <h1 className="text-2xl font-bold text-slate-900 leading-tight max-w-sm">
        What congressional race do you need to understand?
      </h1>
      <p className="text-sm text-slate-500">
        Evidence-first. Nonpartisan. Cited sources.
      </p>
      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
        className="w-full max-w-sm flex gap-2"
      >
        <input
          type="text"
          placeholder="Enter your street address or ZIP…"
          value={address}
          onChange={(e) => onAddressChange(e.target.value)}
          className="flex-1 rounded-[2px] border-2 border-slate-900 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
        />
        <button
          type="submit"
          disabled={loading || !address.trim()}
          className="rounded-[2px] border-2 border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-slate-700 transition-colors"
        >
          {loading ? "…" : "Find My Race →"}
        </button>
      </form>
      <p className="text-xs text-slate-400">or type any candidate name in the chat below</p>
    </div>
  );
}
```

- [ ] **Step 2: Create `web/src/components/StartPanel.tsx`**

```tsx
"use client";
import type { AppMode } from "@/types/agent-state";

const MODES: { key: AppMode; label: string; icon: string }[] = [
  { key: "voter", label: "Voter Brief", icon: "📋" },
  { key: "journalist", label: "Journalist", icon: "📰" },
];

interface Props {
  mode: AppMode;
  onModeChange: (m: AppMode) => void;
  activeRaceKey: string | null;
  stage: string;
}

export function StartPanel({ mode, onModeChange, activeRaceKey, stage }: Props) {
  const isIdle = stage === "idle" || !activeRaceKey;

  return (
    <div className="flex flex-col h-full border-r-2 border-slate-900 bg-white p-4 gap-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Start</p>

      {isIdle ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center gap-2">
          <span className="text-3xl">🗳️</span>
          <p className="text-xs text-slate-400 leading-snug">Enter your address to get started</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => onModeChange(m.key)}
              className={[
                "rounded-[2px] border-2 px-3 py-2 text-sm font-semibold text-left transition-colors",
                mode === m.key
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-400",
              ].join(" ")}
            >
              {m.icon} {m.label}
            </button>
          ))}
        </div>
      )}

      {activeRaceKey && (
        <div className="mt-auto rounded-[2px] border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500 mb-0.5">Active race</p>
          <p className="text-sm font-semibold text-slate-900 truncate">{activeRaceKey}</p>
          <p className="text-xs text-slate-400 capitalize">{stage === "complete" ? "complete" : "running…"}</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```
Expected: no new errors from these files

- [ ] **Step 4: Commit**

```bash
git add web/src/components/canvas/CanvasEmptyState.tsx web/src/components/StartPanel.tsx
git commit -m "feat(v3): CanvasEmptyState hero + StartPanel"
```

---

## Task 8: Update page.tsx — wire everything together

**Files:**
- Modify: `web/src/app/page.tsx`

Plain English: replace the current page layout with the v3 three-column layout, wire `CanvasEmptyState`, `StartPanel`, `RaceCanvas`, and journalist toggle. Set `briefStartedAt` when stage leaves idle.

- [ ] **Step 1: Replace `web/src/app/page.tsx`**

```tsx
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCopilotReadable, useCoAgent } from "@copilotkit/react-core";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { USMap } from "@/components/map/USMap";
import { RaceCanvas } from "@/components/canvas/RaceCanvas";
import { CanvasEmptyState } from "@/components/canvas/CanvasEmptyState";
import { StartPanel } from "@/components/StartPanel";
import { RaceTable } from "@/components/canvas/RaceTable";
import { DEFAULT_STATE, type DistrictLensState, type AppMode } from "@/types/agent-state";

const SYSTEM_PROMPT = `You are DistrictLens, a nonpartisan election-accountability assistant for the 2026 U.S. midterm cycle.

Your job: answer questions about congressional races, candidates, campaign finance, incumbent legislative records, and election dates. Always cite stored sources.

Hard rules:
- NEVER recommend how to vote. If asked, decline and offer to compare candidates.
- NEVER write campaign content (ads, talking points, fundraising, persuasion).
- NEVER infer a candidate's position from donors or party affiliation alone.
- NEVER fabricate positions. If evidence is missing say "I found no direct statement in the indexed sources."
- Only cover federal 2026 congressional races.

CANVAS STATE RULE — MANDATORY:
After every tool call that returns data, you MUST update the application state canvas using JSON Patch "add" operations. Update the stage field to reflect current progress:
- After lookup_district → stage: "district"
- After get_race_brief → stage: "candidates", add /candidates and /finance
- After search_candidate_positions → stage: "finance", add /positions
- After get_incumbent_legislation → stage: "legislation", add /legislation
- When done → stage: "complete", briefReady: true

Available tools:
- lookup_district(address) → race_key
- get_race_brief(race_key) → candidates + FEC finance
- get_incumbent_legislation(race_key) → sponsored bills
- find_candidate(name, state?) → FEC name search
- get_state_races(state_code) → all races in a state
- find_competitive_races(state?) → challenger outraising incumbent
- build_candidate_profile(race_key) → photos, websites, committees
- search_candidate_positions(candidate_name, issue) → Perplexity web search
- search_current_news(candidate_name) → last 7 days news
- get_election_dates(state_code) → primary dates`;

export default function HomePage() {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const prevStageRef = useRef<string>("idle");

  const { agent } = useAgent({ agentId: "districtlens_root" });
  const { copilotkit } = useCopilotKit();

  const { state: agentState, setState: setAgentState } = useCoAgent<DistrictLensState>({
    name: "districtlens_root",
    initialState: DEFAULT_STATE,
  });

  // Set briefStartedAt the moment stage leaves idle
  useEffect(() => {
    if (prevStageRef.current === "idle" && agentState.stage !== "idle") {
      setAgentState((prev) => ({ ...prev, briefStartedAt: Date.now() }));
    }
    prevStageRef.current = agentState.stage;
  }, [agentState.stage, setAgentState]);

  useCopilotReadable({
    description: "Current app mode and selected race",
    value: `Mode: ${agentState.mode}. Current race: ${agentState.currentRaceKey ?? "none"}.`,
  });

  const runAgent = useCallback(
    async (message: string) => {
      if (agent.isRunning) return;
      setLoading(true);
      try {
        agent.addMessage({ id: crypto.randomUUID(), role: "user", content: message });
        await copilotkit.runAgent({ agent });
      } finally {
        setLoading(false);
      }
    },
    [agent, copilotkit]
  );

  const handleAddressSubmit = useCallback(() => {
    if (!address.trim()) return;
    runAgent(`Look up my congressional district for this address: ${address}`);
  }, [address, runAgent]);

  const handleStateClick = useCallback(
    (stateCode: string) => {
      setAgentState((prev) => ({ ...prev, mapFocus: stateCode, mode: "journalist" }));
      runAgent(`Show me all 2026 congressional races in ${stateCode}.`);
    },
    [runAgent, setAgentState]
  );

  const handleModeChange = useCallback(
    (m: AppMode) => {
      setAgentState((prev) => ({ ...prev, mode: m }));
    },
    [setAgentState]
  );

  const handleShareBrief = useCallback(() => {
    const text = [
      `DistrictLens Race Brief — ${agentState.currentRaceKey}`,
      "",
      agentState.candidates.map((c) => `• ${c.name} (${c.party} · ${c.status})`).join("\n"),
      "",
      agentState.positions
        .map((p) => `[${p.issue.toUpperCase()}] ${p.candidateName}: ${p.answer.slice(0, 200)}…`)
        .join("\n\n"),
    ].join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  }, [agentState]);

  const handleRaceTableClick = useCallback(
    (raceKey: string) => {
      runAgent(`Build a voter brief for race ${raceKey}`);
    },
    [runAgent]
  );

  const isJournalist = agentState.mode === "journalist";
  const isIdle = agentState.stage === "idle" || !agentState.currentRaceKey;
  const showTable = isJournalist && agentState.stateRaces.length > 0 && isIdle;

  return (
    <CopilotSidebar
      instructions={SYSTEM_PROMPT}
      defaultOpen={true}
      labels={{
        title: "DistrictLens",
        initial: "Enter an address or click a state to find your race. Ask me anything about 2026 congressional candidates.",
        placeholder: "Ask about a race, candidate, or issue…",
      }}
    >
      <div className="flex flex-col h-screen bg-white">
        {/* Header */}
        <header className="border-b-2 border-slate-900 px-4 py-2 shrink-0 flex items-center gap-4">
          <span className="text-base font-bold tracking-tight text-slate-900">DistrictLens</span>
          {agentState.currentRaceKey && (
            <span className="text-xs text-slate-400 truncate max-w-xs">
              {agentState.currentRaceKey}
            </span>
          )}
          <span className="ml-auto text-xs font-medium uppercase tracking-widest text-slate-400 hidden lg:block">
            Nonpartisan · Evidence-first
          </span>
        </header>

        {/* Three-column body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Col 1 — Start Panel (26%) */}
          <div className="w-[22%] shrink-0">
            <StartPanel
              mode={agentState.mode}
              onModeChange={handleModeChange}
              activeRaceKey={agentState.currentRaceKey}
              stage={agentState.stage}
            />
          </div>

          {/* Col 2 — Map (34%) */}
          <div className="w-[32%] shrink-0 border-x-2 border-slate-900 flex flex-col p-3 gap-2">
            <p className="text-xs text-slate-400 font-medium uppercase tracking-widest shrink-0">
              {isJournalist ? "Finance heatmap" : "Or click a state"}
            </p>
            <USMap
              focusedState={agentState.mapFocus}
              mode={agentState.mode}
              heatmapData={agentState.stateRaces}
              onStateClick={handleStateClick}
            />
          </div>

          {/* Col 3 — Canvas (flex-1) */}
          <div className="flex-1 overflow-y-auto">
            {isIdle && !showTable && (
              <CanvasEmptyState
                address={address}
                onAddressChange={setAddress}
                onSubmit={handleAddressSubmit}
                loading={loading || agent.isRunning}
              />
            )}
            {showTable && (
              <RaceTable races={agentState.stateRaces} onRaceClick={handleRaceTableClick} />
            )}
            {!isIdle && (
              <RaceCanvas state={agentState} onShareBrief={handleShareBrief} />
            )}
          </div>
        </div>
      </div>
    </CopilotSidebar>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```
Expected: errors only on USMap (heatmap props not added yet) and RaceTable (not created yet) — both fixed in Tasks 9 and 10

- [ ] **Step 3: Commit**

```bash
git add web/src/app/page.tsx
git commit -m "feat(v3): page.tsx — v3 layout, empty state hero, journalist toggle, briefStartedAt"
```

---

## Task 9: USMap heatmap mode

**Files:**
- Modify: `web/src/components/map/USMap.tsx`

Plain English: accept a `mode` prop and a `heatmapData` array of `RaceRow`. In journalist mode, color each state by whether its races are competitive (red), lean (amber), or safe (green).

- [ ] **Step 1: Replace `web/src/components/map/USMap.tsx`**

```tsx
"use client";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import type { AppMode, RaceRow } from "@/types/agent-state";

const GEO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

const FIPS_TO_STATE: Record<string, string> = {
  "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT",
  "10":"DE","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN",
  "19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD","25":"MA",
  "26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV",
  "33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH",
  "40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN",
  "48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY",
};

function heatmapColor(stateCode: string, races: RaceRow[]): string {
  const stateRaces = races.filter((r) => r.state === stateCode);
  if (stateRaces.length === 0) return "#e2e8f0";
  const competitive = stateRaces.filter((r) => {
    if (!r.incumbentReceipts || !r.topChallengerReceipts) return false;
    const ratio = r.incumbentReceipts / r.topChallengerReceipts;
    return ratio < 1.5;
  });
  const lean = stateRaces.filter((r) => {
    if (!r.incumbentReceipts || !r.topChallengerReceipts) return false;
    const ratio = r.incumbentReceipts / r.topChallengerReceipts;
    return ratio >= 1.5 && ratio < 3;
  });
  if (competitive.length > 0) return "#fca5a5"; // red-300
  if (lean.length > 0) return "#fcd34d"; // amber-300
  return "#86efac"; // green-300
}

interface Props {
  focusedState: string | null;
  mode: AppMode;
  heatmapData: RaceRow[];
  onStateClick: (stateCode: string) => void;
}

export function USMap({ focusedState, mode, heatmapData, onStateClick }: Props) {
  const isHeatmap = mode === "journalist" && heatmapData.length > 0;

  return (
    <div className="w-full border-2 border-slate-900 rounded-[2px] bg-slate-50 overflow-hidden">
      <ComposableMap
        projection="geoAlbersUsa"
        projectionConfig={{ scale: 1000 }}
        style={{ width: "100%", height: "auto" }}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const stateCode = FIPS_TO_STATE[geo.id as string] ?? "";
              const isFocused = stateCode === focusedState;
              const fill = isFocused
                ? "#1d4ed8"
                : isHeatmap
                ? heatmapColor(stateCode, heatmapData)
                : "#e2e8f0";
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  onClick={() => stateCode && onStateClick(stateCode)}
                  style={{
                    default: { fill, stroke: "#94a3b8", strokeWidth: 0.5, outline: "none", cursor: stateCode ? "pointer" : "default" },
                    hover: { fill: isFocused ? "#1e40af" : "#94a3b8", stroke: "#64748b", strokeWidth: 0.5, outline: "none" },
                    pressed: { fill: "#1e3a8a", outline: "none" },
                  }}
                />
              );
            })
          }
        </Geographies>
      </ComposableMap>
      {isHeatmap && (
        <div className="flex gap-4 justify-center px-3 pb-2 text-xs text-slate-500">
          <span><span className="inline-block w-3 h-3 rounded-sm bg-red-300 mr-1" />Competitive</span>
          <span><span className="inline-block w-3 h-3 rounded-sm bg-amber-300 mr-1" />Lean</span>
          <span><span className="inline-block w-3 h-3 rounded-sm bg-green-300 mr-1" />Safe</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```
Expected: only RaceTable error remaining

- [ ] **Step 3: Commit**

```bash
git add web/src/components/map/USMap.tsx
git commit -m "feat(v3): USMap — journalist heatmap mode (competitive/lean/safe)"
```

---

## Task 10: RaceTable component

**Files:**
- Create: `web/src/components/canvas/RaceTable.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// web/src/components/canvas/__tests__/RaceTable.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { RaceTable } from "../RaceTable";

const races = [
  { raceKey: "2026-H-OH-01", state: "OH", office: "H", district: "01",
    incumbentName: "Steve Chabot", incumbentParty: "REP", incumbentReceipts: 2100000,
    topChallengerName: "Challenger A", topChallengerReceipts: 100000,
    financeGap: 2000000, pacPct: 78 },
  { raceKey: "2026-H-WI-04", state: "WI", office: "H", district: "04",
    incumbentName: "Gwen Moore", incumbentParty: "DEM", incumbentReceipts: 844000,
    topChallengerName: "Purnima Nath", topChallengerReceipts: 0,
    financeGap: 844000, pacPct: 61 },
];

test("renders race rows", () => {
  render(<RaceTable races={races} onRaceClick={jest.fn()} />);
  expect(screen.getByText("Steve Chabot")).toBeInTheDocument();
  expect(screen.getByText("Gwen Moore")).toBeInTheDocument();
});

test("calls onRaceClick with raceKey when row clicked", () => {
  const handler = jest.fn();
  render(<RaceTable races={races} onRaceClick={handler} />);
  fireEvent.click(screen.getByText("Steve Chabot"));
  expect(handler).toHaveBeenCalledWith("2026-H-OH-01");
});

test("sorts by finance gap descending by default", () => {
  render(<RaceTable races={races} onRaceClick={jest.fn()} />);
  const rows = screen.getAllByRole("row");
  expect(rows[1]).toHaveTextContent("Steve Chabot");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/components/canvas/__tests__/RaceTable.test.tsx
```
Expected: FAIL

- [ ] **Step 3: Create `web/src/components/canvas/RaceTable.tsx`**

```tsx
"use client";
import { useState } from "react";
import type { RaceRow } from "@/types/agent-state";

type SortKey = "financeGap" | "pacPct" | "state";
type SortDir = "asc" | "desc";

function fmtMoney(val: number | null): string {
  if (val == null) return "—";
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(val / 1_000)}K`;
  return `$${val}`;
}

interface Props {
  races: RaceRow[];
  onRaceClick: (raceKey: string) => void;
}

export function RaceTable({ races, onRaceClick }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("financeGap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = [...races].sort((a, b) => {
    const av = sortKey === "state" ? a.state : (a[sortKey] ?? 0);
    const bv = sortKey === "state" ? b.state : (b[sortKey] ?? 0);
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "desc" ? " ↓" : " ↑") : "";

  return (
    <div className="flex flex-col h-full overflow-auto p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">
        {races.length} races · click to build brief
      </p>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-900 text-xs font-semibold uppercase tracking-widest text-slate-500">
            <th className="text-left py-2 pr-3">Race</th>
            <th className="text-left py-2 pr-3 cursor-pointer hover:text-slate-900" onClick={() => toggleSort("state")}>
              State{arrow("state")}
            </th>
            <th className="text-right py-2 pr-3 cursor-pointer hover:text-slate-900" onClick={() => toggleSort("financeGap")}>
              Gap{arrow("financeGap")}
            </th>
            <th className="text-right py-2 cursor-pointer hover:text-slate-900" onClick={() => toggleSort("pacPct")}>
              PAC%{arrow("pacPct")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.raceKey}
              onClick={() => onRaceClick(r.raceKey)}
              className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
            >
              <td className="py-2 pr-3 font-medium text-slate-900">{r.incumbentName ?? r.raceKey}</td>
              <td className="py-2 pr-3 text-slate-500">{r.state}-{r.district}</td>
              <td className="py-2 pr-3 text-right font-mono text-slate-700">{fmtMoney(r.financeGap)}</td>
              <td className={`py-2 text-right font-mono ${(r.pacPct ?? 0) > 60 ? "text-amber-600 font-semibold" : "text-slate-500"}`}>
                {r.pacPct != null ? `${r.pacPct}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && npx vitest run src/components/canvas/__tests__/RaceTable.test.tsx
```
Expected: PASS

- [ ] **Step 5: Verify full TypeScript compile clean**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add web/src/components/canvas/RaceTable.tsx web/src/components/canvas/__tests__/RaceTable.test.tsx
git commit -m "feat(v3): RaceTable — sortable journalist race table"
```

---

## Task 11: Fix CORS and redeploy web to Cloud Run

**Files:**
- Modify: `web/.env.local` (verify AGENT_URL)
- Shell: `gcloud run deploy districtlens-web`

- [ ] **Step 1: Verify AGENT_URL in `web/.env.local`**

Confirm this line is present and points to Cloud Run:
```
AGENT_URL=https://districtlens-agent-adewe5kxtq-uc.a.run.app
```

- [ ] **Step 2: Fix CORS on the agent — update ALLOW_ORIGINS to the real web URL**

```bash
gcloud run services update districtlens-agent \
  --project=civicsync-440613 \
  --region=us-central1 \
  --update-env-vars="^|^ALLOW_ORIGINS=https://districtlens-web-adewe5kxtq-uc.a.run.app,http://localhost:3000"
```
Expected: revision deploys, serving 100% traffic

- [ ] **Step 3: Build and push the web Docker image**

```bash
cd /Users/tarikmoody/Documents/Projects/districtlens
SHORT_SHA=$(git rev-parse --short HEAD)
gcloud builds submit web/ \
  --project=civicsync-440613 \
  --tag=us-central1-docker.pkg.dev/civicsync-440613/districtlens-agent/districtlens-web:${SHORT_SHA}
```

- [ ] **Step 4: Deploy web to Cloud Run**

```bash
gcloud run deploy districtlens-web \
  --project=civicsync-440613 \
  --region=us-central1 \
  --image=us-central1-docker.pkg.dev/civicsync-440613/districtlens-agent/districtlens-web:${SHORT_SHA} \
  --set-env-vars="AGENT_URL=https://districtlens-agent-adewe5kxtq-uc.a.run.app"
```
Expected: `districtlens-web-XXXXX` serving 100% traffic

- [ ] **Step 5: Smoke test**

Open `https://districtlens-web-adewe5kxtq-uc.a.run.app` in browser.
- Verify empty state hero renders (big headline + address bar)
- Type "Milwaukee, WI" → click "Find My Race →"
- Verify receipt progress starts and cards appear in canvas
- Verify evidence cards appear before candidate cards

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "feat(v3): deploy v3 frontend — empty state hero, receipt canvas, journalist heatmap"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Empty state hero with address CTA → Task 7 (`CanvasEmptyState`)
- ✅ Three-column layout B1 → Task 8 (`page.tsx`)
- ✅ Receipt mode with timer → Task 2 (`ReceiptProgress`)
- ✅ Evidence-first ordering → Task 6 (`RaceCanvas`)
- ✅ Rich candidate cards with finance → Task 4 (`CandidateCard`)
- ✅ Finance gap multiplier → Task 5 (`FinanceChart`)
- ✅ "Share brief" button → Task 6 (`RaceCanvas`)
- ✅ "Start" language, "Voter Brief" → Task 7 (`StartPanel`)
- ✅ Journalist mode toggle → Task 8 (`page.tsx`)
- ✅ Heatmap map → Task 9 (`USMap`)
- ✅ Sortable race table → Task 10 (`RaceTable`)
- ✅ CORS fix + deploy → Task 11
- ⚠️ Guardrail chips — the system prompt already handles the guardrail text response. Quick-action chip injection via `CopilotSidebar` suggestions is out of scope for this plan (CopilotKit sidebar doesn't expose a simple chips API). The refusal text response works; chips can be a follow-on task.

**Type consistency:**
- `BriefStep` defined in Task 1, used in Tasks 2, 6 ✅
- `FinanceSummary` passed to `CandidateCard` as `finance?: FinanceSummary | null` — defined in Task 4 ✅
- `stepsFromStage` returns `BriefStep[]` — imported in Task 6 ✅
- `RaceRow[]` used in `heatmapData` prop (Task 9) and `RaceTable` (Task 10) — same type ✅
- `onShareBrief: () => void` added to `RaceCanvas` props in Task 6, wired in Task 8 ✅
