# DistrictLens v2 — Week 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static sidebar-only UI with a three-zone layout (map / canvas / chat) driven by CopilotKit AG-UI shared state, with candidate cards (including bioguide photos) and a finance chart rendering progressively as the agent queries data.

**Architecture:** Move all 4 existing tools from client-side `useCopilotAction` hooks to server-side `CopilotRuntime({ actions: [...] })` in `route.ts`. Wire `useCoAgentStateRender` with a structured `DistrictLensState` object. The canvas subscribes to this state and renders components as each tool call updates a slice. The map uses `react-simple-maps` for clickable US states.

**Tech Stack:** Next.js 16 App Router, CopilotKit 1.57, `@copilotkit/runtime` server actions, `react-simple-maps`, `@ai-sdk/google-vertex` (Gemini 2.5 Pro), MongoDB Atlas (existing), Tailwind CSS, HeroUI v3.

---

## File Map

**Create:**
- `web/src/types/agent-state.ts` — shared `DistrictLensState` interface + all sub-types
- `web/src/lib/bioguide.ts` — bioguide photo URL builder + fallback avatar logic
- `web/src/lib/server-actions.ts` — all 4 server-side CopilotKit action definitions
- `web/src/components/canvas/RaceHeader.tsx` — race key + office + boundary note
- `web/src/components/canvas/CandidateCard.tsx` — photo, name, party pill, status badge
- `web/src/components/canvas/FinanceChart.tsx` — horizontal bar chart (individual vs PAC)
- `web/src/components/canvas/ResearchProgress.tsx` — stage progress bar
- `web/src/components/canvas/RaceCanvas.tsx` — reads agent state, renders all canvas components
- `web/src/components/map/USMap.tsx` — react-simple-maps clickable states
- `web/tests/lib/bioguide.test.ts` — unit tests for photo URL builder

**Modify:**
- `web/src/app/api/copilotkit/route.ts` — add `CopilotRuntime({ actions })`, remove placeholder runtime
- `web/src/app/page.tsx` — three-zone layout, remove all `useCopilotAction` client hooks, add `useCoAgentStateRender`
- `web/src/lib/mongodb.ts` — add `getRaceFinanceSummaries` helper used by server actions

---

## Task 1: Install Dependencies

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Install react-simple-maps and topojson**

```bash
cd web && pnpm add react-simple-maps
pnpm add -D @types/topojson-specification
```

- [ ] **Step 2: Verify install**

```bash
node -e "require('react-simple-maps'); console.log('ok')"
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add web/package.json web/pnpm-lock.yaml
git commit -m "feat(deps): add react-simple-maps for US map"
```

---

## Task 2: Shared State Types

**Files:**
- Create: `web/src/types/agent-state.ts`

- [ ] **Step 1: Create the types file**

```typescript
// web/src/types/agent-state.ts

export type ResearchStage =
  | "idle"
  | "district"
  | "candidates"
  | "finance"
  | "legislation"
  | "news"
  | "complete";

export type AppMode = "voter" | "journalist";

export type PartyCode = "DEM" | "REP" | "IND" | string;

export type CandidateStatus =
  | "incumbent"
  | "challenger"
  | "open_seat"
  | string;

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

- [ ] **Step 2: Commit**

```bash
git add web/src/types/agent-state.ts
git commit -m "feat(types): DistrictLensState shared state interface"
```

---

## Task 3: Bioguide Photo Helper

**Files:**
- Create: `web/src/lib/bioguide.ts`
- Create: `web/tests/lib/bioguide.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// web/tests/lib/bioguide.test.ts
import { describe, it, expect } from "vitest";
import { bioguidePhotoUrl, placeholderAvatarUrl } from "@/lib/bioguide";

describe("bioguidePhotoUrl", () => {
  it("builds the correct URL for a known bioguide ID", () => {
    expect(bioguidePhotoUrl("M000160")).toBe(
      "https://bioguide.congress.gov/bioguide/photo/M/M000160.jpg"
    );
  });

  it("handles lowercase bioguide ID", () => {
    expect(bioguidePhotoUrl("b000574")).toBe(
      "https://bioguide.congress.gov/bioguide/photo/B/B000574.jpg"
    );
  });

  it("returns null for empty string", () => {
    expect(bioguidePhotoUrl("")).toBeNull();
  });
});

describe("placeholderAvatarUrl", () => {
  it("returns a data URI for DEM party", () => {
    const url = placeholderAvatarUrl("Jane Doe", "DEM");
    expect(url).toContain("data:");
  });

  it("returns a data URI for REP party", () => {
    const url = placeholderAvatarUrl("John Smith", "REP");
    expect(url).toContain("data:");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && pnpm vitest run tests/lib/bioguide.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/bioguide'`

- [ ] **Step 3: Implement bioguide.ts**

```typescript
// web/src/lib/bioguide.ts

const BIOGUIDE_BASE = "https://bioguide.congress.gov/bioguide/photo";

export function bioguidePhotoUrl(bioguideId: string): string | null {
  if (!bioguideId) return null;
  const id = bioguideId.toUpperCase();
  const letter = id[0];
  return `${BIOGUIDE_BASE}/${letter}/${id}.jpg`;
}

const PARTY_COLORS: Record<string, string> = {
  DEM: "1d4ed8",
  REP: "b91c1c",
  IND: "4b5563",
};

export function placeholderAvatarUrl(name: string, party: string): string {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const color = PARTY_COLORS[party.toUpperCase()] ?? "4b5563";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
    <rect width="80" height="80" rx="40" fill="#${color}"/>
    <text x="40" y="52" text-anchor="middle" font-family="system-ui,sans-serif"
      font-size="28" font-weight="600" fill="white">${initials}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && pnpm vitest run tests/lib/bioguide.test.ts
```
Expected: PASS — 4 tests passing

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/bioguide.ts web/tests/lib/bioguide.test.ts
git commit -m "feat(lib): bioguide photo URL builder + placeholder avatar"
```

---

## Task 4: Server-Side CopilotKit Actions

**Files:**
- Create: `web/src/lib/server-actions.ts`
- Modify: `web/src/lib/mongodb.ts` — add `getFinanceSummaries` helper
- Modify: `web/src/app/api/copilotkit/route.ts`

- [ ] **Step 1: Add getFinanceSummaries to mongodb.ts**

Add after the existing `getDb` function:

```typescript
// web/src/lib/mongodb.ts — add this export

export async function getFinanceSummaries(candidateIds: string[]) {
  const db = await getDb();
  return db
    .collection("finance_summaries")
    .find(
      { candidate_id: { $in: candidateIds } },
      {
        projection: {
          _id: 0,
          candidate_id: 1,
          receipts: 1,
          disbursements: 1,
          cash_on_hand: 1,
          individual_contributions: 1,
          pac_contributions: 1,
          coverage_end_date: 1,
        },
      }
    )
    .toArray();
}
```

- [ ] **Step 2: Create server-actions.ts**

```typescript
// web/src/lib/server-actions.ts
import type { Action } from "@copilotkit/runtime";
import { getDb, getFinanceSummaries, fmtMoney } from "@/lib/mongodb";
import { bioguidePhotoUrl, placeholderAvatarUrl } from "@/lib/bioguide";
import type { CandidateCard, FinanceSummary, BillRecord } from "@/types/agent-state";

export const districtLookupAction: Action<{ address: string }> = {
  name: "lookup_district",
  description:
    "Resolve a street address or ZIP code to a 2026 congressional district. " +
    "Returns the race key (e.g. '2026-H-WI-04'), address, and boundary source. " +
    "Always call this first when the user provides any address.",
  parameters: [
    {
      name: "address",
      type: "string",
      description: "Street address, ZIP code, or city+state.",
      required: true,
    },
  ],
  handler: async ({ address }) => {
    const geocodioKey = process.env.GEOCODIO_API_KEY;
    if (!geocodioKey) return "GEOCODIO_API_KEY not configured.";

    const url = new URL("https://api.geocod.io/v1.7/geocode");
    url.searchParams.set("q", address);
    url.searchParams.set("fields", "cd120,cd");
    url.searchParams.set("api_key", geocodioKey);
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString());
    if (!res.ok) return `Geocoding failed: ${res.status}`;
    const data = await res.json();

    const result = data?.results?.[0];
    if (!result) return `No results found for "${address}".`;

    const fields = result.fields ?? {};
    const cd = fields.congressional_districts?.[0];
    if (!cd) return `No congressional district found for "${address}".`;

    const state = result.address_components?.state ?? "";
    const district = String(cd.district_number ?? "0").padStart(2, "0");
    const raceKey = `2026-H-${state}-${district}`;
    const source = cd.source === "cd120" ? "2026 election boundaries" : "119th Congress (2026 maps pending)";

    return `District: ${raceKey}\nAddress: ${result.formatted_address}\nBoundary: ${source}`;
  },
};

export const getRaceBriefAction: Action<{ race_key: string }> = {
  name: "get_race_brief",
  description:
    "Get all candidates and FEC finance summary for a 2026 congressional race. " +
    "Call after lookup_district. Works regardless of boundary source.",
  parameters: [
    {
      name: "race_key",
      type: "string",
      description: "Race key from lookup_district, e.g. '2026-H-WI-04'.",
      required: true,
    },
  ],
  handler: async ({ race_key }) => {
    const db = await getDb();

    const rawCands = await db
      .collection("candidates")
      .find(
        { race_key },
        {
          projection: {
            _id: 0,
            candidate_id: 1,
            name: 1,
            party: 1,
            incumbent_challenge_status: 1,
          },
        }
      )
      .toArray();

    if (!rawCands.length)
      return `No candidates found for ${race_key}.`;

    // Resolve bioguide IDs for incumbents
    const incumbentNames = rawCands
      .filter((c) => c.incumbent_challenge_status === "incumbent")
      .map((c) => c.name as string);

    const profileMap: Record<string, string> = {};
    if (incumbentNames.length > 0) {
      const profiles = await db
        .collection("legislator_profiles")
        .find(
          { name: { $in: incumbentNames } },
          { projection: { _id: 0, name: 1, bioguide_id: 1 } }
        )
        .toArray();
      for (const p of profiles) {
        if (p.name && p.bioguide_id) profileMap[p.name as string] = p.bioguide_id as string;
      }
    }

    const fins = await getFinanceSummaries(rawCands.map((c) => c.candidate_id as string));
    const finMap = Object.fromEntries(fins.map((f) => [f.candidate_id, f]));

    const candidates: CandidateCard[] = rawCands.map((c) => {
      const bioguideId = profileMap[c.name as string];
      const photoUrl = bioguideId
        ? bioguidePhotoUrl(bioguideId)!
        : placeholderAvatarUrl(c.name as string, c.party as string);
      const photoSource = bioguideId ? "bioguide" : "placeholder";
      return {
        candidateId: c.candidate_id as string,
        name: c.name as string,
        party: c.party as string,
        status: (c.incumbent_challenge_status as string) ?? "unknown",
        photoUrl,
        photoSource,
        raceKey: race_key,
      };
    });

    const finance: FinanceSummary[] = rawCands.map((c) => {
      const f = finMap[c.candidate_id as string];
      return {
        candidateId: c.candidate_id as string,
        name: c.name as string,
        party: c.party as string,
        receipts: (f?.receipts as number) ?? null,
        disbursements: (f?.disbursements as number) ?? null,
        cashOnHand: (f?.cash_on_hand as number) ?? null,
        individualContributions: (f?.individual_contributions as number) ?? null,
        pacContributions: (f?.pac_contributions as number) ?? null,
        coverageEndDate: (f?.coverage_end_date as string) ?? null,
      };
    });

    const lines = [`Race brief for ${race_key}:`];
    for (const c of candidates) {
      const f = finance.find((fi) => fi.candidateId === c.candidateId);
      lines.push(
        `${c.name} (${c.party}, ${c.status}) — raised ${fmtMoney(f?.receipts ?? null)}`
      );
    }
    lines.push("Source: FEC bulk data (fec.gov). Finance data does not prove issue positions.");
    return lines.join("\n");
  },
};

export const getIncumbentLegislationAction: Action<{ race_key: string }> = {
  name: "get_incumbent_legislation",
  description:
    "Get recently sponsored bills for the incumbent in a 2026 congressional race " +
    "from the 119th Congress. Use after get_race_brief.",
  parameters: [
    {
      name: "race_key",
      type: "string",
      description: "Race key, e.g. '2026-H-WI-04'.",
      required: true,
    },
  ],
  handler: async ({ race_key }) => {
    const db = await getDb();
    const bills = await db
      .collection("legislative_actions")
      .find(
        { race_key_2026: race_key, action_type: "sponsored_bill" },
        {
          projection: {
            _id: 0,
            bill_id: 1,
            title: 1,
            introduced_date: 1,
            latest_action: 1,
            member_name: 1,
          },
        }
      )
      .sort({ introduced_date: -1 })
      .limit(6)
      .toArray();

    if (!bills.length)
      return `No sponsored legislation found for the incumbent in ${race_key}.`;

    const member = bills[0]?.member_name ?? "The incumbent";
    const lines = [`${member} — recent sponsored legislation (119th Congress, source: Congress.gov):`];
    for (const b of bills) {
      lines.push(`  ${b.bill_id} (${b.introduced_date}): ${b.title}`);
      if (b.latest_action) lines.push(`    Status: ${b.latest_action}`);
    }
    lines.push("Sponsorship shows legislative priorities, not definitive policy positions.");
    return lines.join("\n");
  },
};

export const findCandidateAction: Action<{ name: string; state?: string }> = {
  name: "find_candidate",
  description:
    "Search for a 2026 congressional candidate by name across all FEC filers. " +
    "Use when the user mentions a candidate by name without providing an address.",
  parameters: [
    { name: "name", type: "string", description: "Candidate name or partial name.", required: true },
    { name: "state", type: "string", description: "Optional two-letter state code, e.g. 'WI'.", required: false },
  ],
  handler: async ({ name, state }) => {
    const db = await getDb();
    const query: Record<string, unknown> = { $text: { $search: name } };
    if (state) query.state = state.toUpperCase();

    const results = await db
      .collection("candidates")
      .find(query, {
        projection: {
          _id: 0,
          candidate_id: 1,
          name: 1,
          party: 1,
          race_key: 1,
          incumbent_challenge_status: 1,
          score: { $meta: "textScore" },
        },
      })
      .sort({ score: { $meta: "textScore" } })
      .limit(6)
      .toArray();

    if (!results.length)
      return `No 2026 FEC filers found matching "${name}"${state ? ` in ${state}` : ""}. They may not have filed yet.`;

    const lines = [`Candidates matching "${name}":`];
    for (const r of results) {
      const status = (r.incumbent_challenge_status as string ?? "unknown").replace("_", " ");
      lines.push(`  ${r.name} (${r.party}, ${status}) — ${r.race_key}`);
    }
    return lines.join("\n");
  },
};

export const allActions = [
  districtLookupAction,
  getRaceBriefAction,
  getIncumbentLegislationAction,
  findCandidateAction,
];
```

- [ ] **Step 3: Update the CopilotKit route**

Replace `web/src/app/api/copilotkit/route.ts` entirely:

```typescript
// web/src/app/api/copilotkit/route.ts
import { createVertex } from "@ai-sdk/google-vertex";
import {
  CopilotRuntime,
  copilotRuntimeNextJSAppRouterEndpoint,
  type CopilotServiceAdapter,
  type CopilotRuntimeChatCompletionRequest,
  type CopilotRuntimeChatCompletionResponse,
} from "@copilotkit/runtime";
import { allActions } from "@/lib/server-actions";

class VertexServiceAdapter implements CopilotServiceAdapter {
  readonly name = "VertexAdapter";
  private readonly _lm;

  constructor() {
    const vertex = createVertex({
      project: process.env.GOOGLE_CLOUD_PROJECT ?? "civicsync-440613",
      location: process.env.GOOGLE_CLOUD_LOCATION ?? "global",
    });
    this._lm = vertex("gemini-2.5-pro");
  }

  getLanguageModel() {
    return this._lm;
  }

  async process(
    request: CopilotRuntimeChatCompletionRequest
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    return { threadId: request.threadId ?? crypto.randomUUID() };
  }
}

const runtime = new CopilotRuntime({ actions: allActions });

const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
  runtime,
  serviceAdapter: new VertexServiceAdapter(),
  endpoint: "/api/copilotkit",
});

export { handleRequest as GET, handleRequest as POST };
```

- [ ] **Step 4: Verify build is clean**

```bash
cd web && NEXT_TELEMETRY_DISABLED=1 GOOGLE_CLOUD_PROJECT=civicsync-440613 \
  GOOGLE_CLOUD_LOCATION=global MONGODB_URI=placeholder \
  GEOCODIO_API_KEY=placeholder AGENT_URL=placeholder \
  INTERNAL_API_TOKEN=placeholder pnpm build 2>&1 | tail -15
```
Expected: `✓ Compiled successfully`

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/server-actions.ts web/src/lib/mongodb.ts \
        web/src/app/api/copilotkit/route.ts
git commit -m "feat(copilotkit): move tools to server-side CopilotRuntime actions"
```

---

## Task 5: Canvas Components

**Files:**
- Create: `web/src/components/canvas/RaceHeader.tsx`
- Create: `web/src/components/canvas/CandidateCard.tsx`
- Create: `web/src/components/canvas/FinanceChart.tsx`
- Create: `web/src/components/canvas/ResearchProgress.tsx`
- Create: `web/src/components/canvas/RaceCanvas.tsx`

- [ ] **Step 1: RaceHeader**

```typescript
// web/src/components/canvas/RaceHeader.tsx
"use client";
import type { DistrictLensState } from "@/types/agent-state";

interface Props { raceKey: string; }

export function RaceHeader({ raceKey }: Props) {
  const [, office, state, district] = raceKey.split("-");
  const officeLabel = office === "H" ? "House" : "Senate";
  return (
    <div className="border-b-2 border-slate-900 pb-4 mb-6">
      <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
        2026 Congressional Race
      </p>
      <p className="mt-1 font-mono text-3xl font-bold text-blue-700">{raceKey}</p>
      <p className="text-sm text-slate-600">
        {state} — {officeLabel}{district !== "00" ? ` District ${parseInt(district, 10)}` : ""}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: CandidateCard**

```typescript
// web/src/components/canvas/CandidateCard.tsx
"use client";
import { useState } from "react";
import type { CandidateCard as CandidateCardType } from "@/types/agent-state";
import { placeholderAvatarUrl } from "@/lib/bioguide";

const PARTY_COLORS: Record<string, string> = {
  DEM: "bg-blue-100 text-blue-800 border-blue-300",
  REP: "bg-red-100 text-red-800 border-red-300",
  IND: "bg-slate-100 text-slate-800 border-slate-300",
};

const STATUS_LABELS: Record<string, string> = {
  incumbent: "Incumbent",
  challenger: "Challenger",
  open_seat: "Open Seat",
};

interface Props { candidate: CandidateCardType; }

export function CandidateCard({ candidate }: Props) {
  const [imgSrc, setImgSrc] = useState(candidate.photoUrl);
  const partyClass = PARTY_COLORS[candidate.party.toUpperCase()] ?? PARTY_COLORS.IND;
  const statusLabel = STATUS_LABELS[candidate.status] ?? candidate.status;

  return (
    <div className="flex items-center gap-4 rounded-[2px] border-2 border-slate-900 bg-white p-4">
      <img
        src={imgSrc}
        alt={candidate.name}
        width={64}
        height={64}
        className="rounded-full border-2 border-slate-200 object-cover"
        onError={() => setImgSrc(placeholderAvatarUrl(candidate.name, candidate.party))}
      />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-900 truncate">{candidate.name}</p>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <span className={`rounded-[2px] border px-2 py-0.5 text-xs font-medium ${partyClass}`}>
            {candidate.party}
          </span>
          <span className="rounded-[2px] border border-slate-300 px-2 py-0.5 text-xs text-slate-600">
            {statusLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: FinanceChart**

```typescript
// web/src/components/canvas/FinanceChart.tsx
"use client";
import type { FinanceSummary } from "@/types/agent-state";

function fmtMoney(val: number | null): string {
  if (val == null) return "—";
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

interface Props { finance: FinanceSummary[]; }

export function FinanceChart({ finance }: Props) {
  const maxReceipts = Math.max(...finance.map((f) => f.receipts ?? 0), 1);

  return (
    <div className="rounded-[2px] border-2 border-slate-900 bg-white p-4 space-y-4">
      <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
        Campaign Finance · FEC
      </p>
      {finance.map((f) => {
        const individual = f.individualContributions ?? 0;
        const pac = f.pacContributions ?? 0;
        const total = f.receipts ?? 0;
        const indPct = total > 0 ? (individual / total) * 100 : 0;
        const pacPct = total > 0 ? (pac / total) * 100 : 0;
        const barWidth = total > 0 ? (total / maxReceipts) * 100 : 0;

        return (
          <div key={f.candidateId} className="space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="font-medium text-sm text-slate-900 truncate">{f.name}</span>
              <span className="font-mono text-sm font-bold text-slate-900 ml-2 shrink-0">
                {fmtMoney(total)}
              </span>
            </div>
            <div className="h-4 w-full bg-slate-100 rounded-sm overflow-hidden border border-slate-200">
              <div className="h-full flex">
                <div
                  className="bg-blue-600 transition-all duration-700"
                  style={{ width: `${(indPct / 100) * barWidth}%` }}
                  title={`Individuals: ${fmtMoney(individual)}`}
                />
                <div
                  className="bg-amber-500 transition-all duration-700"
                  style={{ width: `${(pacPct / 100) * barWidth}%` }}
                  title={`PACs: ${fmtMoney(pac)}`}
                />
              </div>
            </div>
            <div className="flex gap-3 text-xs text-slate-500">
              <span><span className="inline-block w-2 h-2 bg-blue-600 rounded-sm mr-1" />Ind {fmtMoney(individual)}</span>
              <span><span className="inline-block w-2 h-2 bg-amber-500 rounded-sm mr-1" />PAC {fmtMoney(pac)}</span>
              {f.coverageEndDate && <span className="ml-auto">through {f.coverageEndDate}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: ResearchProgress**

```typescript
// web/src/components/canvas/ResearchProgress.tsx
"use client";
import type { ResearchStage } from "@/types/agent-state";

const STAGES: ResearchStage[] = [
  "district",
  "candidates",
  "finance",
  "legislation",
  "news",
  "complete",
];

const LABELS: Record<ResearchStage, string> = {
  idle: "Idle",
  district: "District",
  candidates: "Candidates",
  finance: "Finance",
  legislation: "Record",
  news: "News",
  complete: "Done",
};

interface Props { stage: ResearchStage; }

export function ResearchProgress({ stage }: Props) {
  if (stage === "idle") return null;
  const currentIndex = STAGES.indexOf(stage);

  return (
    <div className="flex items-center gap-1 text-xs font-medium">
      {STAGES.map((s, i) => {
        const done = i < currentIndex || stage === "complete";
        const active = s === stage && stage !== "complete";
        return (
          <div key={s} className="flex items-center gap-1">
            <span
              className={[
                "px-2 py-0.5 rounded-[2px] border transition-colors",
                done ? "bg-slate-900 text-white border-slate-900" : "",
                active ? "bg-blue-700 text-white border-blue-700 animate-pulse" : "",
                !done && !active ? "bg-white text-slate-400 border-slate-300" : "",
              ].join(" ")}
            >
              {LABELS[s]}
            </span>
            {i < STAGES.length - 1 && (
              <span className="text-slate-300">→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: RaceCanvas**

```typescript
// web/src/components/canvas/RaceCanvas.tsx
"use client";
import type { DistrictLensState } from "@/types/agent-state";
import { RaceHeader } from "./RaceHeader";
import { CandidateCard } from "./CandidateCard";
import { FinanceChart } from "./FinanceChart";
import { ResearchProgress } from "./ResearchProgress";

interface Props { state: DistrictLensState; }

export function RaceCanvas({ state }: Props) {
  if (state.stage === "idle" || !state.currentRaceKey) {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-400 text-sm">
        Enter an address or click a state on the map to get started.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 overflow-y-auto">
      <ResearchProgress stage={state.stage} />

      <RaceHeader raceKey={state.currentRaceKey} />

      {state.candidates.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
            Candidates · FEC 2026
          </p>
          {state.candidates.map((c) => (
            <CandidateCard key={c.candidateId} candidate={c} />
          ))}
        </div>
      )}

      {state.finance.length > 0 && (
        <FinanceChart finance={state.finance} />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add web/src/components/canvas/
git commit -m "feat(canvas): RaceHeader, CandidateCard, FinanceChart, ResearchProgress, RaceCanvas"
```

---

## Task 6: US Map Component

**Files:**
- Create: `web/src/components/map/USMap.tsx`

- [ ] **Step 1: Create USMap**

```typescript
// web/src/components/map/USMap.tsx
"use client";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";

const GEO_URL =
  "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

interface Props {
  focusedState: string | null;
  onStateClick: (stateCode: string) => void;
}

// FIPS code → state abbreviation map (subset — full map below)
const FIPS_TO_STATE: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA",
  "08": "CO", "09": "CT", "10": "DE", "12": "FL", "13": "GA",
  "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA",
  "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD",
  "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO",
  "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ",
  "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC",
  "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT",
  "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY",
};

export function USMap({ focusedState, onStateClick }: Props) {
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
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  onClick={() => stateCode && onStateClick(stateCode)}
                  style={{
                    default: {
                      fill: isFocused ? "#1d4ed8" : "#e2e8f0",
                      stroke: "#94a3b8",
                      strokeWidth: 0.5,
                      outline: "none",
                      cursor: stateCode ? "pointer" : "default",
                    },
                    hover: {
                      fill: isFocused ? "#1e40af" : "#94a3b8",
                      stroke: "#64748b",
                      strokeWidth: 0.5,
                      outline: "none",
                    },
                    pressed: {
                      fill: "#1e3a8a",
                      outline: "none",
                    },
                  }}
                />
              );
            })
          }
        </Geographies>
      </ComposableMap>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/map/USMap.tsx
git commit -m "feat(map): USMap component with react-simple-maps clickable states"
```

---

## Task 7: Three-Zone Page Layout + AG-UI State Wiring

**Files:**
- Modify: `web/src/app/page.tsx`

This replaces the entire file. Remove all `useCopilotAction` client hooks and all `useCopilotReadable` calls. Wire `useCoAgentStateRender` to the shared state and build the three-zone layout.

- [ ] **Step 1: Replace page.tsx**

```typescript
// web/src/app/page.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { useCoAgentStateRender, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { USMap } from "@/components/map/USMap";
import { RaceCanvas } from "@/components/canvas/RaceCanvas";
import { DEFAULT_STATE, type DistrictLensState, type AppMode } from "@/types/agent-state";

const SYSTEM_PROMPT = `You are DistrictLens, a nonpartisan election-accountability assistant for the 2026 U.S. midterm cycle.

Your job: answer questions about congressional races, candidates, campaign finance, and incumbent legislative records. Always cite the stored source.

Hard rules:
- NEVER recommend how to vote or who is better. If asked, decline and offer to compare cited evidence.
- NEVER write campaign content (ads, talking points, fundraising, persuasion).
- NEVER infer a candidate's position from donors or party affiliation alone.
- NEVER fabricate positions. If evidence is missing, say "I found no direct statement in the indexed sources."
- Only cover federal 2026 congressional races.

Available tools:
- lookup_district(address) → returns race_key. Call first for any address.
- get_race_brief(race_key) → returns all candidates and FEC finance. Always call after lookup_district.
- get_incumbent_legislation(race_key) → sponsored bills from 119th Congress.
- find_candidate(name, state?) → search FEC filers by name.

Typical flow: lookup_district → get_race_brief → get_incumbent_legislation.
After lookup_district resolves, proactively call get_race_brief without waiting to be asked.`;

export default function HomePage() {
  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<AppMode>("voter");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // AG-UI shared state — agent writes this, canvas reads it
  const [agentState, setAgentState] = useState<DistrictLensState>(DEFAULT_STATE);

  useCoAgentStateRender<DistrictLensState>({
    name: "districtlens",
    render: ({ state }) => {
      setAgentState(state ?? DEFAULT_STATE);
      return null;
    },
  });

  // Share mode + current race with the agent
  useCopilotReadable({
    description: "Current app mode and selected race",
    value: `Mode: ${mode}. Current race: ${agentState.currentRaceKey ?? "none"}.`,
  });

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (address.length < 5) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/district/suggest?q=${encodeURIComponent(address)}`);
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
      setShowSuggestions(true);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [address]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node))
        setShowSuggestions(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleStateClick = useCallback((stateCode: string) => {
    setAgentState((prev) => ({ ...prev, mapFocus: stateCode }));
  }, []);

  function handleSuggestionClick(s: string) {
    setAddress(s);
    setSuggestions([]);
    setShowSuggestions(false);
  }

  return (
    <CopilotSidebar
      instructions={SYSTEM_PROMPT}
      defaultOpen={true}
      labels={{
        title: "DistrictLens",
        initial: "Enter an address to find your district, or ask about any 2026 congressional race.",
        placeholder: "Ask about a race, candidate, or issue…",
      }}
    >
      <div className="flex flex-col h-screen">
        {/* Header */}
        <header className="border-b-2 border-slate-900 bg-white px-6 py-3 shrink-0">
          <div className="mx-auto flex max-w-7xl items-center gap-6">
            <span className="text-lg font-bold tracking-tight text-slate-900">DistrictLens</span>

            {/* Mode toggle */}
            <div className="flex rounded-[2px] border-2 border-slate-900 overflow-hidden">
              {(["voter", "journalist"] as AppMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={[
                    "px-4 py-1.5 text-sm font-semibold capitalize transition-colors",
                    mode === m
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-100",
                  ].join(" ")}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Address bar */}
            <div ref={wrapperRef} className="relative flex-1 max-w-md">
              <form
                className="flex gap-2"
                onSubmit={(e) => { e.preventDefault(); }}
              >
                <input
                  type="text"
                  placeholder="Street address or ZIP code"
                  value={address}
                  onChange={(e) => { setAddress(e.target.value); setError(null); }}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  className="flex-1 rounded-[2px] border-2 border-slate-900 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
                <Button
                  type="submit"
                  isDisabled={loading}
                  size="sm"
                  className="rounded-[2px] border-2 border-slate-900 bg-slate-900 px-4 font-semibold text-white"
                >
                  {loading ? "…" : "Find"}
                </Button>
              </form>

              {showSuggestions && suggestions.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded-[2px] border-2 border-slate-900 bg-white shadow-lg">
                  {suggestions.map((s) => (
                    <li
                      key={s}
                      onMouseDown={() => handleSuggestionClick(s)}
                      className="cursor-pointer px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
                    >
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <span className="ml-auto text-xs font-medium uppercase tracking-widest text-slate-400">
              Nonpartisan · Evidence-first
            </span>
          </div>
        </header>

        {/* Three-zone body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Map zone — 40% */}
          <div className="w-2/5 border-r-2 border-slate-900 p-4 overflow-y-auto">
            <USMap
              focusedState={agentState.mapFocus}
              onStateClick={handleStateClick}
            />
            {agentState.mapFocus && (
              <p className="mt-3 text-sm text-slate-600">
                <span className="font-semibold">{agentState.mapFocus}</span> selected —
                ask the agent about races in this state
              </p>
            )}
          </div>

          {/* Canvas zone — 60% */}
          <div className="flex-1 overflow-y-auto">
            <RaceCanvas state={agentState} />
          </div>
        </div>
      </div>
    </CopilotSidebar>
  );
}
```

- [ ] **Step 2: Build to verify no TypeScript errors**

```bash
cd web && NEXT_TELEMETRY_DISABLED=1 GOOGLE_CLOUD_PROJECT=civicsync-440613 \
  GOOGLE_CLOUD_LOCATION=global MONGODB_URI=placeholder \
  GEOCODIO_API_KEY=placeholder AGENT_URL=placeholder \
  INTERNAL_API_TOKEN=placeholder pnpm build 2>&1 | tail -15
```
Expected: `✓ Compiled successfully`

- [ ] **Step 3: Commit**

```bash
git add web/src/app/page.tsx
git commit -m "feat(layout): three-zone layout — map + canvas + chat, AG-UI state wiring"
```

---

## Task 8: Wire Vitest + Integration Smoke Test

**Files:**
- Create: `web/tests/integration/week1-smoke.test.ts`

- [ ] **Step 1: Check if vitest is configured**

```bash
cd web && cat package.json | grep -A5 '"vitest"'
```

If not present, add vitest:

```bash
pnpm add -D vitest @vitejs/plugin-react
```

Add to `web/package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: Write smoke test**

```typescript
// web/tests/integration/week1-smoke.test.ts
import { describe, it, expect } from "vitest";
import { bioguidePhotoUrl, placeholderAvatarUrl } from "@/lib/bioguide";
import { DEFAULT_STATE } from "@/types/agent-state";

describe("Week 1 smoke tests", () => {
  it("DEFAULT_STATE has expected shape", () => {
    expect(DEFAULT_STATE.mode).toBe("voter");
    expect(DEFAULT_STATE.stage).toBe("idle");
    expect(DEFAULT_STATE.candidates).toEqual([]);
    expect(DEFAULT_STATE.briefReady).toBe(false);
  });

  it("bioguidePhotoUrl builds correct URL for Gwen Moore", () => {
    expect(bioguidePhotoUrl("M000160")).toBe(
      "https://bioguide.congress.gov/bioguide/photo/M/M000160.jpg"
    );
  });

  it("placeholderAvatarUrl returns a data URI", () => {
    const url = placeholderAvatarUrl("Gwen Moore", "DEM");
    expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  it("bioguidePhotoUrl returns null for empty string", () => {
    expect(bioguidePhotoUrl("")).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd web && pnpm test
```
Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add web/tests/ web/package.json
git commit -m "test(week1): vitest smoke tests for bioguide, state defaults"
```

---

## Task 9: Deploy Week 1

- [ ] **Step 1: Full build verification**

```bash
cd web && NEXT_TELEMETRY_DISABLED=1 GOOGLE_CLOUD_PROJECT=civicsync-440613 \
  GOOGLE_CLOUD_LOCATION=global MONGODB_URI=placeholder \
  GEOCODIO_API_KEY=placeholder AGENT_URL=placeholder \
  INTERNAL_API_TOKEN=placeholder pnpm build 2>&1 | tail -20
```
Expected: `✓ Compiled successfully`, all 11 routes present

- [ ] **Step 2: Cloud Build**

```bash
gcloud builds submit web/ \
  --tag us-central1-docker.pkg.dev/civicsync-440613/districtlens-web/web:latest \
  --project=civicsync-440613 --region=us-central1
```
Expected: `SUCCESS`

- [ ] **Step 3: Deploy to Cloud Run**

```bash
gcloud run deploy districtlens-web \
  --image us-central1-docker.pkg.dev/civicsync-440613/districtlens-web/web:latest \
  --region us-central1 --project civicsync-440613
```

- [ ] **Step 4: Smoke test deployed endpoint**

```bash
curl -s -o /dev/null -w "%{http_code}" \
  https://districtlens-web-655022470154.us-central1.run.app/api/race/brief?race_key=2026-H-WI-04
```
Expected: `200`

- [ ] **Step 5: Push to GitHub**

```bash
git push origin main
```

---

## Week 1 Milestone Verification

After all tasks, verify manually in the browser:

1. Open `https://districtlens-web-655022470154.us-central1.run.app`
2. Three-zone layout visible: map on left, empty canvas on right, chat sidebar
3. Click Wisconsin on the map → state highlights blue, sidebar message appears
4. Ask in chat: "Tell me about the WI-04 race" → agent calls `lookup_district` + `get_race_brief` → candidate cards with photos appear in canvas
5. Finance chart visible below candidate cards
6. Research progress bar shows stages completing

If step 4 works, Week 1 is complete.
