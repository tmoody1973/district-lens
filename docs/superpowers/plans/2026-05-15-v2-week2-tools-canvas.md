# DistrictLens v2 — Week 2: New Tools + Full Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the full voter flow end-to-end — address → district → candidates (with photos) → finance chart → legislation → news → position search — with the canvas building progressively via AG-UI shared state.

**Architecture:** Server-side `CopilotRuntime` actions handle all I/O (MongoDB, Perplexity, Geocodio). A new client-side `set_canvas_state` action receives structured JSON from the LLM and updates `agentState`. New API routes expose data endpoints. The system prompt instructs Gemini to call `set_canvas_state` after each data tool. New canvas components (BillFeed, NewsCard, EvidenceCard) render when state slices populate.

**Tech Stack:** CopilotKit 1.57, Next.js 16 App Router, MongoDB Atlas, Perplexity Sonar Pro API, react-simple-maps, Tailwind CSS, HeroUI v3.

---

## Key Architectural Pattern

```
LLM calls get_race_brief (server action)
  → server returns structured JSON string
  → LLM parses it, calls set_canvas_state({ type: "candidates", data: "[...]", race_key: "..." })
  → client useCopilotAction handler updates agentState
  → RaceCanvas re-renders with CandidateCard components
```

The system prompt enforces this chain. The LLM does two calls per data fetch: one server tool for data, one client `set_canvas_state` to render it.

---

## File Map

**Create:**
- `web/src/app/api/races/state/route.ts` — `GET ?state=WI` → all races in a state
- `web/src/app/api/races/heatmap/route.ts` — `GET` → all 503 races with finance_gap
- `web/src/app/api/races/competitive/route.ts` — `GET ?state=WI` → races where challenger outraises incumbent
- `web/src/app/api/candidate/profile/route.ts` — `GET ?race_key=2026-H-WI-04` → full profile incl. bioguide photo
- `web/src/app/api/search/positions/route.ts` — `POST { candidate, issue }` → Perplexity sonar-pro
- `web/src/app/api/search/news/route.ts` — `POST { candidate }` → Perplexity sonar-pro, 7-day recency
- `web/src/app/api/election-dates/route.ts` — `GET ?state=WI` → primary dates, early voting
- `web/src/app/api/political-ads/meta/route.ts` — `GET ?candidate=...&state=...` → Meta Ad Library (placeholder)
- `web/src/lib/perplexity.ts` — shared Perplexity API client
- `web/src/components/canvas/BillFeed.tsx` — incumbent legislation timeline
- `web/src/components/canvas/NewsCard.tsx` — Perplexity news results
- `web/src/components/canvas/EvidenceCard.tsx` — position search quote + source
- `web/tests/lib/perplexity.test.ts` — unit tests for citation extraction

**Modify:**
- `web/src/app/page.tsx` — add `set_canvas_state` client action + new tool actions + updated system prompt
- `web/src/lib/server-actions.ts` — update existing tools to return structured JSON; add 6 new server actions
- `web/src/components/canvas/RaceCanvas.tsx` — add BillFeed, NewsCard, EvidenceCard rendering

---

## Task 1: New API Routes — MongoDB Data

**Files:**
- Create: `web/src/app/api/races/state/route.ts`
- Create: `web/src/app/api/races/heatmap/route.ts`
- Create: `web/src/app/api/races/competitive/route.ts`
- Create: `web/src/app/api/candidate/profile/route.ts`
- Create: `web/src/app/api/election-dates/route.ts`

- [ ] **Step 1: Create GET /api/races/state**

```typescript
// web/src/app/api/races/state/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state")?.toUpperCase().trim();
  if (!state) return NextResponse.json({ error: "state required" }, { status: 400 });

  try {
    const db = await getDb();
    const races = await db
      .collection("races")
      .find(
        { state },
        {
          projection: {
            _id: 0,
            race_key: 1,
            state: 1,
            office: 1,
            district: 1,
            incumbent_name_bp: 1,
            incumbent_bioguide_id: 1,
          },
        }
      )
      .toArray();

    // Join with finance to compute gaps
    const raceKeys = races.map((r) => r.race_key as string);
    const candidates = await db
      .collection("candidates")
      .find({ race_key: { $in: raceKeys } })
      .toArray();
    const finance = await db
      .collection("finance_summaries")
      .find({ candidate_id: { $in: candidates.map((c) => c.candidate_id) } })
      .toArray();

    const finMap = Object.fromEntries(
      finance.map((f) => [f.candidate_id as string, f])
    );

    const rows = races.map((race) => {
      const raceCands = candidates.filter((c) => c.race_key === race.race_key);
      const incumbent = raceCands.find((c) => c.incumbent_challenge_status === "incumbent");
      const challengers = raceCands.filter((c) => c.incumbent_challenge_status !== "incumbent");
      const incFin = incumbent ? finMap[incumbent.candidate_id as string] : null;
      const topChallenger = challengers.sort((a, b) => {
        const fa = finMap[a.candidate_id as string]?.receipts ?? 0;
        const fb = finMap[b.candidate_id as string]?.receipts ?? 0;
        return (fb as number) - (fa as number);
      })[0];
      const chalFin = topChallenger ? finMap[topChallenger.candidate_id as string] : null;
      const incReceipts = (incFin?.receipts as number) ?? null;
      const chalReceipts = (chalFin?.receipts as number) ?? null;
      const financeGap =
        incReceipts !== null && chalReceipts !== null
          ? incReceipts - chalReceipts
          : null;
      const pacPct =
        incFin && (incFin.receipts as number) > 0
          ? Math.round(((incFin.pac_contributions as number) / (incFin.receipts as number)) * 100)
          : null;

      return {
        raceKey: race.race_key,
        state: race.state,
        office: race.office,
        district: race.district,
        incumbentName: (incumbent?.name as string) ?? null,
        incumbentParty: (incumbent?.party as string) ?? null,
        incumbentReceipts: incReceipts,
        topChallengerName: (topChallenger?.name as string) ?? null,
        topChallengerReceipts: chalReceipts,
        financeGap,
        pacPct,
      };
    });

    return NextResponse.json({ races: rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create GET /api/races/heatmap**

```typescript
// web/src/app/api/races/heatmap/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export async function GET() {
  try {
    const db = await getDb();

    const candidates = await db
      .collection("candidates")
      .find({}, { projection: { _id: 0, candidate_id: 1, race_key: 1, incumbent_challenge_status: 1, party: 1, name: 1 } })
      .toArray();

    const finance = await db
      .collection("finance_summaries")
      .find({}, { projection: { _id: 0, candidate_id: 1, receipts: 1, pac_contributions: 1 } })
      .toArray();

    const finMap = Object.fromEntries(finance.map((f) => [f.candidate_id as string, f]));

    const byRace: Record<string, { incumbentReceipts: number | null; topChallengerReceipts: number | null; incumbentParty: string | null }> = {};

    for (const cand of candidates) {
      const key = cand.race_key as string;
      if (!byRace[key]) byRace[key] = { incumbentReceipts: null, topChallengerReceipts: null, incumbentParty: null };
      const fin = finMap[cand.candidate_id as string];
      const receipts = (fin?.receipts as number) ?? 0;
      if (cand.incumbent_challenge_status === "incumbent") {
        byRace[key].incumbentReceipts = receipts;
        byRace[key].incumbentParty = cand.party as string;
      } else {
        if (byRace[key].topChallengerReceipts === null || receipts > byRace[key].topChallengerReceipts!) {
          byRace[key].topChallengerReceipts = receipts;
        }
      }
    }

    const heatmap = Object.entries(byRace).map(([raceKey, data]) => ({
      raceKey,
      state: raceKey.split("-")[2],
      financeGap:
        data.incumbentReceipts !== null && data.topChallengerReceipts !== null
          ? data.incumbentReceipts - data.topChallengerReceipts
          : null,
      incumbentParty: data.incumbentParty,
    }));

    return NextResponse.json({ heatmap });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create GET /api/races/competitive**

```typescript
// web/src/app/api/races/competitive/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export async function GET(req: NextRequest) {
  const stateFilter = req.nextUrl.searchParams.get("state")?.toUpperCase().trim() ?? null;

  try {
    const db = await getDb();
    const query = stateFilter ? { state: stateFilter } : {};
    const candidates = await db
      .collection("candidates")
      .find(query, { projection: { _id: 0, candidate_id: 1, race_key: 1, name: 1, party: 1, state: 1, incumbent_challenge_status: 1 } })
      .toArray();

    const finance = await db
      .collection("finance_summaries")
      .find({ candidate_id: { $in: candidates.map((c) => c.candidate_id as string) } })
      .toArray();

    const finMap = Object.fromEntries(finance.map((f) => [f.candidate_id as string, f]));

    const byRace: Record<string, { incumbent: typeof candidates[0] | null; topChallenger: typeof candidates[0] | null; state: string }> = {};
    for (const c of candidates) {
      const key = c.race_key as string;
      if (!byRace[key]) byRace[key] = { incumbent: null, topChallenger: null, state: c.state as string };
      if (c.incumbent_challenge_status === "incumbent") {
        byRace[key].incumbent = c;
      } else {
        const current = byRace[key].topChallenger;
        const currentReceipts = current ? ((finMap[current.candidate_id as string]?.receipts as number) ?? 0) : -1;
        const thisReceipts = (finMap[c.candidate_id as string]?.receipts as number) ?? 0;
        if (thisReceipts > currentReceipts) byRace[key].topChallenger = c;
      }
    }

    const competitive = Object.entries(byRace)
      .filter(([, d]) => d.incumbent && d.topChallenger)
      .map(([raceKey, d]) => {
        const incFin = finMap[d.incumbent!.candidate_id as string];
        const chalFin = finMap[d.topChallenger!.candidate_id as string];
        const incReceipts = (incFin?.receipts as number) ?? 0;
        const chalReceipts = (chalFin?.receipts as number) ?? 0;
        return {
          raceKey,
          state: d.state,
          incumbentName: d.incumbent!.name as string,
          incumbentParty: d.incumbent!.party as string,
          incumbentReceipts: incReceipts,
          topChallengerName: d.topChallenger!.name as string,
          topChallengerReceipts: chalReceipts,
          financeGap: incReceipts - chalReceipts,
          challengerLeading: chalReceipts > incReceipts,
        };
      })
      .filter((r) => r.challengerLeading || r.financeGap < 100_000)
      .sort((a, b) => a.financeGap - b.financeGap)
      .slice(0, 20);

    return NextResponse.json({ competitive });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Create GET /api/candidate/profile**

```typescript
// web/src/app/api/candidate/profile/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { bioguidePhotoUrl, placeholderAvatarUrl } from "@/lib/bioguide";

export async function GET(req: NextRequest) {
  const raceKey = req.nextUrl.searchParams.get("race_key")?.trim();
  if (!raceKey) return NextResponse.json({ error: "race_key required" }, { status: 400 });

  try {
    const db = await getDb();

    const candidates = await db
      .collection("candidates")
      .find({ race_key: raceKey }, {
        projection: {
          _id: 0,
          candidate_id: 1,
          name: 1,
          party: 1,
          incumbent_challenge_status: 1,
          ballotpedia_profile_url: 1,
          official_government_website: 1,
          official_campaign_website: 1,
        },
      })
      .toArray();

    const profiles = await db
      .collection("legislator_profiles")
      .find({ name: { $in: candidates.map((c) => c.name as string) } })
      .toArray();

    const profileMap = Object.fromEntries(
      profiles.map((p) => [p.name as string, p])
    );

    const result = candidates.map((c) => {
      const profile = profileMap[c.name as string];
      const bioguideId = (profile?.bioguide_id as string) ?? null;
      const photoUrl = bioguideId
        ? bioguidePhotoUrl(bioguideId)!
        : placeholderAvatarUrl(c.name as string, c.party as string);

      return {
        candidateId: c.candidate_id,
        name: c.name,
        party: c.party,
        status: c.incumbent_challenge_status ?? "unknown",
        photoUrl,
        photoSource: bioguideId ? "bioguide" : "placeholder",
        raceKey,
        ballotpediaUrl: c.ballotpedia_profile_url ?? null,
        officialWebsite: c.official_government_website ?? profile?.official_website ?? null,
        campaignWebsite: c.official_campaign_website ?? null,
        committees: (profile?.committees as string[]) ?? [],
      };
    });

    return NextResponse.json({ candidates: result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 5: Create GET /api/election-dates**

```typescript
// web/src/app/api/election-dates/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state")?.toUpperCase().trim();
  if (!state) return NextResponse.json({ error: "state required" }, { status: 400 });

  try {
    const db = await getDb();
    const record = await db
      .collection("election_dates")
      .findOne(
        { state_abbreviation: state },
        { projection: { _id: 0, state: 1, state_abbreviation: 1, primary: 1, general_election_date: 1, general_early_in_person_voting: 1, candidate_filing_deadlines: 1, events_chronological: 1 } }
      );

    if (!record) return NextResponse.json({ error: `No election date data for ${state}` }, { status: 404 });
    return NextResponse.json(record);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 6: Verify build**

```bash
cd /Users/tarikmoody/Documents/Projects/districtlens/web && \
  NEXT_TELEMETRY_DISABLED=1 GOOGLE_CLOUD_PROJECT=civicsync-440613 \
  GOOGLE_CLOUD_LOCATION=global MONGODB_URI=placeholder \
  GEOCODIO_API_KEY=placeholder AGENT_URL=placeholder \
  INTERNAL_API_TOKEN=placeholder pnpm build 2>&1 | tail -15
```

Expected: `✓ Compiled successfully`

- [ ] **Step 7: Commit**

```bash
git add web/src/app/api/races/ web/src/app/api/candidate/profile/ web/src/app/api/election-dates/
git commit -m "feat(api): state races, heatmap, competitive, candidate profile, election dates routes"
```

---

## Task 2: Perplexity API Client + Search Routes

**Files:**
- Create: `web/src/lib/perplexity.ts`
- Create: `web/src/app/api/search/positions/route.ts`
- Create: `web/src/app/api/search/news/route.ts`
- Create: `web/tests/lib/perplexity.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// web/tests/lib/perplexity.test.ts
import { describe, it, expect } from "vitest";
import { buildPositionPrompt, buildNewsPrompt, extractCitations } from "@/lib/perplexity";

describe("buildPositionPrompt", () => {
  it("includes candidate name and issue", () => {
    const prompt = buildPositionPrompt("Gwen Moore", "housing");
    expect(prompt).toContain("Gwen Moore");
    expect(prompt).toContain("housing");
  });

  it("requests direct statements", () => {
    const prompt = buildPositionPrompt("Jane Doe", "climate");
    expect(prompt.toLowerCase()).toContain("direct");
  });
});

describe("buildNewsPrompt", () => {
  it("includes candidate name", () => {
    const prompt = buildNewsPrompt("John Smith");
    expect(prompt).toContain("John Smith");
  });
});

describe("extractCitations", () => {
  it("returns empty array for empty citations", () => {
    expect(extractCitations([], [])).toEqual([]);
  });

  it("merges search_results with citation URLs", () => {
    const citations = ["https://example.com/1", "https://example.com/2"];
    const searchResults = [
      { title: "Article 1", url: "https://example.com/1", date: "2026-01-01", snippet: "text" },
    ];
    const result = extractCitations(citations, searchResults);
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe("https://example.com/1");
    expect(result[0].title).toBe("Article 1");
    expect(result[1].url).toBe("https://example.com/2");
    expect(result[1].title).toBe("https://example.com/2"); // fallback
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd web && pnpm test tests/lib/perplexity.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Create web/src/lib/perplexity.ts**

```typescript
// web/src/lib/perplexity.ts

const ENDPOINT = "https://api.perplexity.ai/v1/sonar";
const MODEL = "sonar-pro";
const TIMEOUT_MS = 30_000;

const CIVIC_DOMAINS = [
  "congress.gov", "fec.gov", "ballotpedia.org", "opensecrets.org",
  "votesmart.org", "govtrack.us", "house.gov", "senate.gov", "gpo.gov",
  "politifact.com", "factcheck.org", "apnews.com", "reuters.com",
  "npr.org", "pbs.org", "nytimes.com", "washingtonpost.com",
  "wsj.com", "thehill.com", "rollcall.com",
];

const NONPARTISAN_SYSTEM = [
  "You are a nonpartisan civic research assistant.",
  "Report only what verifiable sources say.",
  "Distinguish direct candidate statements from third-party characterizations.",
  "If no direct statement exists in the sources, say so explicitly.",
  "Never recommend how to vote. Never infer positions from donors or party alone.",
  "Cite every factual claim with inline numeric markers [1], [2], etc.",
].join(" ");

export interface PerplexitySource {
  title: string;
  url: string;
  date: string | null;
  snippet: string;
}

export interface PerplexityResult {
  answer: string;
  sources: PerplexitySource[];
  relatedQuestions: string[];
}

export function buildPositionPrompt(candidateName: string, issue: string): string {
  return (
    `What has ${candidateName} publicly said about ${issue}? ` +
    `Prioritize direct statements (campaign website, press releases, floor speeches, ` +
    `voting record, debate transcripts, verified questionnaires). ` +
    `If only third-party characterizations exist, label them as such. ` +
    `If no direct statement is found in the sources, say so explicitly.`
  );
}

export function buildNewsPrompt(candidateName: string): string {
  return (
    `Summarize news coverage of ${candidateName} from the last 7 days. ` +
    `Focus on campaign activities, public statements, debate appearances, ` +
    `polling, endorsements, and significant controversies. Cite each claim.`
  );
}

export function extractCitations(
  citations: string[],
  searchResults: Array<{ title?: string; url: string; date?: string; snippet?: string }>
): PerplexitySource[] {
  return citations.map((url) => {
    const match = searchResults.find((sr) => sr.url === url);
    return {
      title: match?.title ?? url,
      url,
      date: match?.date ?? null,
      snippet: match?.snippet ?? "",
    };
  });
}

export async function searchPerplexity(
  prompt: string,
  options: {
    recency?: "hour" | "day" | "week" | "month" | "year";
    domainAllowlist?: string[];
    searchContextSize?: "low" | "medium" | "high";
  } = {}
): Promise<PerplexityResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY not configured");

  const payload: Record<string, unknown> = {
    model: MODEL,
    messages: [
      { role: "system", content: NONPARTISAN_SYSTEM },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 1500,
    return_related_questions: true,
    return_images: false,
    web_search_options: { search_context_size: options.searchContextSize ?? "medium" },
  };
  if (options.recency) payload.search_recency_filter = options.recency;
  if (options.domainAllowlist?.length) payload.search_domain_filter = options.domainAllowlist.slice(0, 20);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Perplexity API ${response.status}: ${body}`);
  }

  const data = await response.json();
  const answer: string = data.choices?.[0]?.message?.content ?? "";
  const citations: string[] = data.citations ?? [];
  const rawSources = data.search_results ?? [];
  const sources = extractCitations(citations, rawSources);

  return { answer, sources, relatedQuestions: data.related_questions ?? [] };
}

export { CIVIC_DOMAINS };
```

- [ ] **Step 4: Run tests — confirm pass**

```bash
cd web && pnpm test tests/lib/perplexity.test.ts
```
Expected: all tests PASS

- [ ] **Step 5: Create search routes**

```typescript
// web/src/app/api/search/positions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { searchPerplexity, buildPositionPrompt, CIVIC_DOMAINS } from "@/lib/perplexity";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { candidateName, issue } = body as { candidateName?: string; issue?: string };
  if (!candidateName || !issue)
    return NextResponse.json({ error: "candidateName and issue required" }, { status: 400 });

  try {
    const result = await searchPerplexity(buildPositionPrompt(candidateName, issue), {
      recency: "year",
      domainAllowlist: CIVIC_DOMAINS,
      searchContextSize: "medium",
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

```typescript
// web/src/app/api/search/news/route.ts
import { NextRequest, NextResponse } from "next/server";
import { searchPerplexity, buildNewsPrompt } from "@/lib/perplexity";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { candidateName } = body as { candidateName?: string };
  if (!candidateName)
    return NextResponse.json({ error: "candidateName required" }, { status: 400 });

  try {
    const result = await searchPerplexity(buildNewsPrompt(candidateName), {
      recency: "week",
      searchContextSize: "medium",
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 6: Create Meta Ad Library placeholder route**

```typescript
// web/src/app/api/political-ads/meta/route.ts
import { NextRequest, NextResponse } from "next/server";

// Meta Ad Library API — requires access token from Facebook app
// Docs: https://www.facebook.com/ads/library/api/
// Get token: https://developers.facebook.com/apps/ → create app → get access token
// Permissions needed: ads_read

export async function GET(req: NextRequest) {
  const candidateName = req.nextUrl.searchParams.get("candidate")?.trim();
  const state = req.nextUrl.searchParams.get("state")?.trim();
  if (!candidateName) return NextResponse.json({ error: "candidate required" }, { status: 400 });

  const accessToken = process.env.META_AD_LIBRARY_TOKEN;
  if (!accessToken) {
    return NextResponse.json({
      ads: [],
      note: "META_AD_LIBRARY_TOKEN not configured. Add a Facebook app access token to enable political ad spend data.",
    });
  }

  const url = new URL("https://graph.facebook.com/v21.0/ads_archive");
  url.searchParams.set("ad_type", "POLITICAL_AND_ISSUE_ADS");
  url.searchParams.set("search_terms", candidateName);
  url.searchParams.set("ad_reached_countries", "US");
  if (state) url.searchParams.set("ad_delivery_country", "US");
  url.searchParams.set(
    "fields",
    "id,ad_creative_bodies,ad_snapshot_url,spend,impressions,page_name,funding_entity,ad_delivery_start_time,demographic_distribution"
  );
  url.searchParams.set("limit", "20");
  url.searchParams.set("access_token", accessToken);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return NextResponse.json({ error: `Meta API ${res.status}` }, { status: 502 });
    const data = await res.json();
    return NextResponse.json({ ads: data.data ?? [], paging: data.paging ?? null });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 7: Verify build**

```bash
cd /Users/tarikmoody/Documents/Projects/districtlens/web && \
  NEXT_TELEMETRY_DISABLED=1 GOOGLE_CLOUD_PROJECT=civicsync-440613 \
  GOOGLE_CLOUD_LOCATION=global MONGODB_URI=placeholder \
  GEOCODIO_API_KEY=placeholder AGENT_URL=placeholder \
  INTERNAL_API_TOKEN=placeholder PERPLEXITY_API_KEY=placeholder pnpm build 2>&1 | tail -15
```

Expected: `✓ Compiled successfully`

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/perplexity.ts web/src/app/api/search/ \
        web/src/app/api/political-ads/ web/tests/lib/perplexity.test.ts
git commit -m "feat(search): Perplexity client + positions/news/political-ads routes"
```

---

## Task 3: New Canvas Components

**Files:**
- Create: `web/src/components/canvas/BillFeed.tsx`
- Create: `web/src/components/canvas/NewsCard.tsx`
- Create: `web/src/components/canvas/EvidenceCard.tsx`
- Modify: `web/src/components/canvas/RaceCanvas.tsx`

- [ ] **Step 1: Create BillFeed**

```typescript
// web/src/components/canvas/BillFeed.tsx
"use client";
import type { BillRecord } from "@/types/agent-state";

interface Props { legislation: BillRecord[]; memberName?: string; }

export function BillFeed({ legislation, memberName }: Props) {
  if (!legislation.length) return null;
  const name = memberName ?? legislation[0]?.memberName ?? "The incumbent";

  return (
    <div className="rounded-[2px] border-2 border-slate-900 bg-white p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
          119th Congress · Sponsored Bills
        </p>
        <span className="text-xs text-slate-400">Source: Congress.gov</span>
      </div>
      <p className="text-sm font-semibold text-slate-900">{name}</p>
      <div className="space-y-2">
        {legislation.map((bill) => (
          <div key={bill.billId} className="border-l-2 border-blue-300 pl-3">
            <div className="flex items-start gap-2">
              <span className="font-mono text-xs font-bold text-blue-700 shrink-0 mt-0.5">
                {bill.billId}
              </span>
              <p className="text-sm text-slate-800 leading-snug">{bill.title}</p>
            </div>
            {bill.introducedDate && (
              <p className="text-xs text-slate-400 mt-0.5">Introduced {bill.introducedDate}</p>
            )}
            {bill.latestAction && (
              <p className="text-xs text-slate-500 mt-0.5 truncate">{bill.latestAction}</p>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-400 border-t border-slate-100 pt-2">
        Sponsorship shows legislative priorities, not definitive policy positions.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Create NewsCard**

```typescript
// web/src/components/canvas/NewsCard.tsx
"use client";
import type { NewsItem } from "@/types/agent-state";

interface Props { news: NewsItem[]; }

export function NewsCard({ news }: Props) {
  if (!news.length) return null;

  return (
    <div className="rounded-[2px] border-2 border-slate-900 bg-white p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
          Recent News · Last 7 Days
        </p>
        <span className="text-xs text-slate-400">Source: Perplexity Sonar</span>
      </div>
      <div className="space-y-3">
        {news.slice(0, 5).map((item, i) => (
          <div key={i} className="space-y-0.5">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-blue-700 hover:underline leading-snug block"
            >
              {item.title}
            </a>
            {item.snippet && (
              <p className="text-xs text-slate-600 line-clamp-2">{item.snippet}</p>
            )}
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>{item.source || new URL(item.url).hostname}</span>
              {item.date && <span>· {item.date}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create EvidenceCard**

```typescript
// web/src/components/canvas/EvidenceCard.tsx
"use client";
import type { EvidenceCard as EvidenceCardType } from "@/types/agent-state";

interface Props { evidence: EvidenceCardType; }

export function EvidenceCard({ evidence }: Props) {
  return (
    <div className="rounded-[2px] border-2 border-amber-400 bg-amber-50 p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-widest text-amber-700">
          Position Evidence · Perplexity Sonar
        </p>
        <span className="text-xs text-amber-600 font-medium">{evidence.issue}</span>
      </div>
      <p className="text-sm font-semibold text-slate-900">{evidence.candidateName}</p>
      <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
        {evidence.answer}
      </p>
      {evidence.sources.length > 0 && (
        <div className="space-y-1 border-t border-amber-200 pt-2">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Sources</p>
          {evidence.sources.slice(0, 4).map((s, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="text-xs font-mono text-amber-600 shrink-0">[{i + 1}]</span>
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
      <p className="text-xs text-amber-700 border-t border-amber-200 pt-2">
        Evidence from public sources. Direct statements distinguished from characterizations.
        DistrictLens never recommends how to vote.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Update RaceCanvas to render all components**

Read the current `web/src/components/canvas/RaceCanvas.tsx` first, then replace with:

```typescript
// web/src/components/canvas/RaceCanvas.tsx
"use client";
import type { DistrictLensState } from "@/types/agent-state";
import { RaceHeader } from "./RaceHeader";
import { CandidateCard } from "./CandidateCard";
import { FinanceChart } from "./FinanceChart";
import { ResearchProgress } from "./ResearchProgress";
import { BillFeed } from "./BillFeed";
import { NewsCard } from "./NewsCard";
import { EvidenceCard } from "./EvidenceCard";

interface Props { state: DistrictLensState; }

export function RaceCanvas({ state }: Props) {
  if (state.stage === "idle" || !state.currentRaceKey) {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-400 text-sm p-8">
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

      {state.legislation.length > 0 && (
        <BillFeed
          legislation={state.legislation}
          memberName={state.legislation[0]?.memberName}
        />
      )}

      {state.news.length > 0 && (
        <NewsCard news={state.news} />
      )}

      {state.positions.length > 0 && (
        <div className="space-y-4">
          {state.positions.map((ev, i) => (
            <EvidenceCard key={i} evidence={ev} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify build**

```bash
cd /Users/tarikmoody/Documents/Projects/districtlens/web && \
  NEXT_TELEMETRY_DISABLED=1 GOOGLE_CLOUD_PROJECT=civicsync-440613 \
  GOOGLE_CLOUD_LOCATION=global MONGODB_URI=placeholder \
  GEOCODIO_API_KEY=placeholder AGENT_URL=placeholder \
  INTERNAL_API_TOKEN=placeholder PERPLEXITY_API_KEY=placeholder pnpm build 2>&1 | tail -15
```

Expected: `✓ Compiled successfully`

- [ ] **Step 6: Commit**

```bash
git add web/src/components/canvas/BillFeed.tsx \
        web/src/components/canvas/NewsCard.tsx \
        web/src/components/canvas/EvidenceCard.tsx \
        web/src/components/canvas/RaceCanvas.tsx
git commit -m "feat(canvas): BillFeed, NewsCard, EvidenceCard components"
```

---

## Task 4: set_canvas_state Client Action + New Server Tools + Updated System Prompt

This is the core AG-UI wiring task. The `set_canvas_state` client action receives structured JSON from the LLM and updates `agentState`. New server tools call the new API routes.

**Files:**
- Modify: `web/src/lib/server-actions.ts` — add 6 new tools
- Modify: `web/src/app/page.tsx` — add `set_canvas_state` + new `useCopilotAction` hooks + updated system prompt

- [ ] **Step 1: Add new server tools to web/src/lib/server-actions.ts**

Read the current `server-actions.ts` first, then ADD these tools BEFORE the `allActions` array (do not remove existing tools):

```typescript
export const getStateRacesAction: Action<{ state_code: string }> = {
  name: "get_state_races",
  description: "Get all 2026 congressional races in a US state with finance gap data. Use after the user clicks a state on the map or asks about races in a state.",
  parameters: [
    { name: "state_code", type: "string", description: "Two-letter state code, e.g. 'WI'.", required: true },
  ],
  handler: async ({ state_code }) => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/races/state?state=${encodeURIComponent(state_code)}`);
    if (!res.ok) return `Failed to fetch races for ${state_code}.`;
    const data = await res.json();
    const races = (data.races ?? []) as Array<Record<string, unknown>>;
    if (!races.length) return `No races found for ${state_code}.`;
    const lines = [`Races in ${state_code} (${races.length} total):`];
    for (const r of races.slice(0, 10)) {
      const gap = r.financeGap != null ? ` | Gap: $${Math.abs(r.financeGap as number).toLocaleString()}` : "";
      lines.push(`  ${r.raceKey}: ${r.incumbentName ?? "Open seat"} (${r.incumbentParty ?? "?"})${gap}`);
    }
    return `${lines.join("\n")}\n\nSTRUCTURED_DATA:${JSON.stringify({ stateRaces: races })}`;
  },
};

export const findCompetitiveRacesAction: Action<{ state?: string }> = {
  name: "find_competitive_races",
  description: "Find 2026 congressional races where challenger is outraising the incumbent or finance gap is narrow. Great for journalists looking for story angles.",
  parameters: [
    { name: "state", type: "string", description: "Optional two-letter state code to narrow results.", required: false },
  ],
  handler: async ({ state }) => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const url = `/api/races/competitive${state ? `?state=${state}` : ""}`;
    const res = await fetch(`${baseUrl}${url}`);
    if (!res.ok) return "Failed to fetch competitive races.";
    const data = await res.json();
    const races = (data.competitive ?? []) as Array<Record<string, unknown>>;
    if (!races.length) return "No highly competitive races found matching the criteria.";
    const lines = ["Most competitive races (challenger leading or gap < $100K):"];
    for (const r of races.slice(0, 8)) {
      const direction = r.challengerLeading ? "🔴 challenger leading" : "🟡 close";
      lines.push(`  ${r.raceKey}: ${r.incumbentName} vs ${r.topChallengerName} — ${direction}`);
      lines.push(`    Inc: $${((r.incumbentReceipts as number) / 1000).toFixed(0)}K | Chal: $${((r.topChallengerReceipts as number) / 1000).toFixed(0)}K`);
    }
    return `${lines.join("\n")}\n\nSTRUCTURED_DATA:${JSON.stringify({ comparisons: races })}`;
  },
};

export const getCandidateProfileAction: Action<{ race_key: string }> = {
  name: "build_candidate_profile",
  description: "Get full candidate profiles for a race including photos, Ballotpedia URLs, official websites, and committee memberships. Use after get_race_brief for richer candidate display.",
  parameters: [
    { name: "race_key", type: "string", description: "Race key, e.g. '2026-H-WI-04'.", required: true },
  ],
  handler: async ({ race_key }) => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/candidate/profile?race_key=${encodeURIComponent(race_key)}`);
    if (!res.ok) return `Failed to fetch profiles for ${race_key}.`;
    const data = await res.json();
    const candidates = data.candidates ?? [];
    const lines = [`Full candidate profiles for ${race_key}:`];
    for (const c of candidates) {
      lines.push(`  ${c.name} (${c.party}, ${c.status})`);
      if (c.officialWebsite) lines.push(`    Official: ${c.officialWebsite}`);
      if (c.ballotpediaUrl) lines.push(`    Ballotpedia: ${c.ballotpediaUrl}`);
    }
    return `${lines.join("\n")}\n\nSTRUCTURED_DATA:${JSON.stringify({ candidates })}`;
  },
};

export const searchCandidatePositionsAction: Action<{ candidate_name: string; issue: string }> = {
  name: "search_candidate_positions",
  description: "Search the open web for what a specific candidate has publicly said about a policy issue. Use when the user asks about a candidate's stance on housing, climate, healthcare, immigration, or any other topic.",
  parameters: [
    { name: "candidate_name", type: "string", description: "Full candidate name.", required: true },
    { name: "issue", type: "string", description: "Policy issue, e.g. 'housing affordability'.", required: true },
  ],
  handler: async ({ candidate_name, issue }) => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/search/positions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateName: candidate_name, issue }),
    });
    if (!res.ok) return `Position search failed for ${candidate_name} on ${issue}.`;
    const data = await res.json();
    const sourceLines = (data.sources ?? []).slice(0, 3).map((s: { title: string; url: string; date: string | null }, i: number) =>
      `[${i + 1}] ${s.title} — ${s.url}`
    );
    return `${data.answer ?? "No answer returned."}\n\nSources:\n${sourceLines.join("\n")}\n\nSTRUCTURED_DATA:${JSON.stringify({ positions: [{ candidateName: candidate_name, issue, answer: data.answer, sources: data.sources }] })}`;
  },
};

export const searchCurrentNewsAction: Action<{ candidate_name: string }> = {
  name: "search_current_news",
  description: "Search recent news (last 7 days) about a specific candidate. Use when the user asks about current events, recent statements, or what's happening with a candidate.",
  parameters: [
    { name: "candidate_name", type: "string", description: "Full candidate name.", required: true },
  ],
  handler: async ({ candidate_name }) => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/search/news`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateName: candidate_name }),
    });
    if (!res.ok) return `News search failed for ${candidate_name}.`;
    const data = await res.json();
    return `${data.answer ?? ""}\n\nSTRUCTURED_DATA:${JSON.stringify({ news: data.sources })}`;
  },
};

export const getElectionDatesAction: Action<{ state_code: string }> = {
  name: "get_election_dates",
  description: "Get 2026 primary date, general election date, and early voting information for a US state. Essential for voters asking when they need to vote.",
  parameters: [
    { name: "state_code", type: "string", description: "Two-letter state code, e.g. 'WI'.", required: true },
  ],
  handler: async ({ state_code }) => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/election-dates?state=${encodeURIComponent(state_code)}`);
    if (!res.ok) return `No election date data for ${state_code}.`;
    const data = await res.json();
    const primary = data.primary?.date ?? "Not available";
    const runoff = data.primary?.runoff_date_if_necessary ?? null;
    const general = data.general_election_date ?? "2026-11-03";
    const earlyStart = data.general_early_in_person_voting?.computed_start_date ?? null;
    const earlyEnd = data.general_early_in_person_voting?.computed_end_date ?? null;
    const earlyRule = data.general_early_in_person_voting?.rule_text ?? null;
    const lines = [
      `2026 Election Dates for ${data.state ?? state_code}:`,
      `  Primary: ${primary}${runoff ? ` (Runoff if needed: ${runoff})` : ""}`,
      `  General Election: ${general}`,
    ];
    if (earlyStart && earlyEnd) {
      lines.push(`  Early Voting: ${earlyStart} through ${earlyEnd}`);
    } else if (earlyRule) {
      lines.push(`  Early Voting: ${earlyRule}`);
    }
    lines.push("Source: NCSL, FEC, Vote.org (2026). Confirm with your state's election authority.");
    return lines.join("\n");
  },
};
```

Then update the `allActions` array at the bottom of the file to include the new tools:

```typescript
export const allActions = [
  districtLookupAction,
  getRaceBriefAction,
  getIncumbentLegislationAction,
  findCandidateAction,
  getStateRacesAction,
  findCompetitiveRacesAction,
  getCandidateProfileAction,
  searchCandidatePositionsAction,
  searchCurrentNewsAction,
  getElectionDatesAction,
];
```

- [ ] **Step 2: Add set_canvas_state + updated system prompt to page.tsx**

Read `web/src/app/page.tsx` first. Then:

**2a.** Replace the `SYSTEM_PROMPT` constant with this expanded version:

```typescript
const SYSTEM_PROMPT = `You are DistrictLens, a nonpartisan election-accountability assistant for the 2026 U.S. midterm cycle.

Your job: answer questions about congressional races, candidates, campaign finance, incumbent records, and election dates. Always cite stored sources.

Hard rules:
- NEVER recommend how to vote. If asked, decline and offer to call compare_candidates.
- NEVER write campaign content (ads, talking points, fundraising, persuasion).
- NEVER infer a candidate's position from donors or party affiliation alone.
- NEVER fabricate positions. If evidence is missing say "I found no direct statement in the indexed sources."
- Only cover federal 2026 congressional races.

Available tools:
- lookup_district(address) → race_key. Call first for any address.
- get_race_brief(race_key) → candidates + FEC finance. Call after lookup_district. Returns STRUCTURED_DATA.
- get_incumbent_legislation(race_key) → sponsored bills. Returns STRUCTURED_DATA.
- find_candidate(name, state?) → FEC name search.
- get_state_races(state_code) → all races in a state. Returns STRUCTURED_DATA.
- find_competitive_races(state?) → challenger outraising incumbent. Returns STRUCTURED_DATA.
- build_candidate_profile(race_key) → photos, websites, committees. Returns STRUCTURED_DATA.
- search_candidate_positions(candidate_name, issue) → Perplexity web search. Returns STRUCTURED_DATA.
- search_current_news(candidate_name) → last 7 days news. Returns STRUCTURED_DATA.
- get_election_dates(state_code) → primary dates, early voting.
- set_canvas_state(updates) → UPDATE THE CANVAS DISPLAY. Call this after every tool that returns STRUCTURED_DATA.

CRITICAL CANVAS UPDATE RULE:
After EVERY tool call that returns "STRUCTURED_DATA:" in its response:
1. Parse the JSON after "STRUCTURED_DATA:"
2. Immediately call set_canvas_state with the parsed data as "updates" (JSON string)
3. Also include "stage" and "currentRaceKey" in set_canvas_state when relevant

Example flow:
1. lookup_district("123 Main St") → returns "District: 2026-H-WI-04..."
2. set_canvas_state({ updates: '{"stage":"district","currentRaceKey":"2026-H-WI-04"}' })
3. get_race_brief("2026-H-WI-04") → returns "...STRUCTURED_DATA:{candidates:[...],finance:[...]}"
4. set_canvas_state({ updates: '{"stage":"candidates","candidates":[...],"finance":[...]}' })
5. get_incumbent_legislation("2026-H-WI-04") → returns "...STRUCTURED_DATA:{legislation:[...]}"
6. set_canvas_state({ updates: '{"stage":"legislation","legislation":[...]}' })`;
```

**2b.** Add the `set_canvas_state` client action inside the `HomePage` component, after the existing hooks. The handler must call `setAgentState`:

```typescript
  useCopilotAction({
    name: "set_canvas_state",
    description: "Update the canvas display with structured data from a tool result. Call after every tool that returns STRUCTURED_DATA.",
    parameters: [
      {
        name: "updates",
        type: "string",
        description: "JSON stringified partial DistrictLensState object. Keys: stage, currentRaceKey, candidates, finance, legislation, news, positions, stateRaces, comparisons.",
        required: true,
      },
    ],
    handler: async ({ updates }: { updates: string }) => {
      try {
        const parsed = JSON.parse(updates) as Partial<DistrictLensState>;
        setAgentState((prev) => ({ ...prev, ...parsed }));
        return "Canvas updated.";
      } catch {
        return "Canvas update failed — invalid JSON.";
      }
    },
  });
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/tarikmoody/Documents/Projects/districtlens/web && \
  NEXT_TELEMETRY_DISABLED=1 GOOGLE_CLOUD_PROJECT=civicsync-440613 \
  GOOGLE_CLOUD_LOCATION=global MONGODB_URI=placeholder \
  GEOCODIO_API_KEY=placeholder AGENT_URL=placeholder \
  INTERNAL_API_TOKEN=placeholder PERPLEXITY_API_KEY=placeholder pnpm build 2>&1 | tail -15
```

Expected: `✓ Compiled successfully`

- [ ] **Step 4: Add PERPLEXITY_API_KEY to Cloud Run secrets**

```bash
# Get the Perplexity API key value from the user's .env.local
grep PERPLEXITY_API_KEY /Users/tarikmoody/Documents/Projects/districtlens/web/.env.local | cut -d= -f2
```

If the key is present, create the secret:
```bash
echo -n "THE_KEY_VALUE" | gcloud secrets create districtlens-perplexity-key \
  --data-file=- --project=civicsync-440613
```

Then update the Cloud Run service to include it (add alongside existing secrets):
```bash
gcloud run services update districtlens-web \
  --update-secrets="PERPLEXITY_API_KEY=districtlens-perplexity-key:latest" \
  --region us-central1 --project civicsync-440613
```

If key is not yet in `.env.local`, skip this step and add a TODO comment.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/server-actions.ts web/src/app/page.tsx
git commit -m "feat(agent): 6 new server tools + set_canvas_state client action + full system prompt"
```

---

## Task 5: Run Full Tests + Deploy

- [ ] **Step 1: Run all tests**

```bash
cd /Users/tarikmoody/Documents/Projects/districtlens/web && pnpm test 2>&1
```

Expected: all tests pass

- [ ] **Step 2: Full build**

```bash
cd /Users/tarikmoody/Documents/Projects/districtlens/web && \
  NEXT_TELEMETRY_DISABLED=1 GOOGLE_CLOUD_PROJECT=civicsync-440613 \
  GOOGLE_CLOUD_LOCATION=global MONGODB_URI=placeholder \
  GEOCODIO_API_KEY=placeholder AGENT_URL=placeholder \
  INTERNAL_API_TOKEN=placeholder PERPLEXITY_API_KEY=placeholder pnpm build 2>&1 | tail -15
```

Expected: `✓ Compiled successfully`

- [ ] **Step 3: Cloud Build + deploy**

```bash
gcloud builds submit \
  /Users/tarikmoody/Documents/Projects/districtlens/web/ \
  --tag us-central1-docker.pkg.dev/civicsync-440613/districtlens-web/web:latest \
  --project=civicsync-440613 --region=us-central1 2>&1 | tail -8

gcloud run deploy districtlens-web \
  --image us-central1-docker.pkg.dev/civicsync-440613/districtlens-web/web:latest \
  --region us-central1 --project civicsync-440613 2>&1 | tail -5
```

- [ ] **Step 4: Smoke tests**

```bash
# Election dates endpoint
curl -s "https://districtlens-web-655022470154.us-central1.run.app/api/election-dates?state=WI" | python3 -m json.tool | head -10

# Competitive races
curl -s "https://districtlens-web-655022470154.us-central1.run.app/api/races/competitive?state=WI" | python3 -m json.tool | head -10

# State races
curl -s "https://districtlens-web-655022470154.us-central1.run.app/api/races/state?state=WI" | python3 -m json.tool | head -10
```

Expected: all return JSON with data

- [ ] **Step 5: Push to GitHub**

```bash
cd /Users/tarikmoody/Documents/Projects/districtlens && git push origin main
```

---

## Week 2 Milestone Verification

Manual browser test after deploy:

1. Open `https://districtlens-web-655022470154.us-central1.run.app`
2. Ask in chat: "Tell me about the WI-04 race" → agent calls `lookup_district` + `get_race_brief` + `set_canvas_state` → canvas shows candidates, finance chart
3. Agent continues → `get_incumbent_legislation` + `set_canvas_state` → BillFeed appears
4. Ask: "Any recent news about Gwen Moore?" → `search_current_news` fires → NewsCard appears
5. Ask: "What does Moore say about housing?" → `search_candidate_positions` fires → EvidenceCard appears with citations
6. Ask: "Who should I vote for?" → guardrail fires, no recommendation
7. Switch to Journalist mode → ask "Find competitive races in Wisconsin" → `find_competitive_races` fires → stateRaces data returned
8. Ask "When is the Wisconsin primary?" → `get_election_dates` fires → dates returned in chat

If all 8 checks pass, Week 2 is complete.
