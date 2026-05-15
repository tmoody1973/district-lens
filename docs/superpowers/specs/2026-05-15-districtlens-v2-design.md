# DistrictLens v2 — Design Spec
**Date:** 2026-05-15
**Deadline:** 2026-06-14 (30 days)
**Hackathon:** Google Cloud Rapid Agent Hackathon — MongoDB track

---

## Problem

DistrictLens v1 is a reactive chatbot in a sidebar. The UI stays static. The agent only responds when spoken to. CopilotKit is barely used — 4 client-side tool trace cards and one `useCopilotReadable` string. Voters have to know what questions to ask. Journalists have no cross-race intelligence. The demo doesn't show anything a judge will remember.

---

## The Shift

The agent stops responding and starts **driving**. The canvas builds itself as the agent queries data. The chat sidebar becomes one of three input surfaces — not the primary one. The map is the centerpiece for both personas.

**Inspiration:** Race to the WH — competitive race tracking, state maps, finance context. DistrictLens answers something harder: not "who will win" but "what do I actually need to know to make an informed decision."

---

## Architecture: Approach C — Server-Side CopilotKit Actions + Shared State

Move all tools from client-side `useCopilotAction` hooks to server-side `CopilotRuntime({ actions: [...] })` in `route.ts`. Use `useCoAgentStateRender` with a structured state object the agent updates as it works. The canvas subscribes to this state and renders components progressively. No ADK bridge required — Gemini 2.5 Pro drives everything through CopilotKit's native tool loop.

### Shared State Object

```typescript
interface DistrictLensState {
  // Navigation
  mode: "voter" | "journalist";
  mapFocus: string | null;           // state code e.g. "WI"
  currentRaceKey: string | null;     // "2026-H-WI-04"

  // Research progress (drives the progress bar)
  stage: "idle" | "district" | "candidates" | "finance" | "legislation" | "news" | "complete";

  // Canvas data — each populated progressively
  candidates: CandidateCard[];
  finance: FinanceSummary[];
  legislation: BillRecord[];
  news: NewsItem[];
  positions: EvidenceCard[];         // Perplexity position search results

  // Journalist mode
  stateRaces: RaceRow[];             // races in selected state
  comparisons: RaceRow[];            // cross-race query results

  // Export
  briefMarkdown: string | null;
  briefReady: boolean;
}
```

The agent never returns a wall of text. Every tool call updates one slice of this state. React re-renders the matching canvas component automatically.

---

## Layout

```
┌─────────────────────────────────────────────────────────┐
│  [DistrictLens]   [Voter | Journalist]   [Search bar]   │  ← Header
├───────────────────────┬─────────────────────────────────┤
│                       │                                 │
│   US Map              │   Race Canvas                   │
│   (react-simple-maps) │   (builds progressively)        │
│                       │                                 │
│   Voter: neutral grey │   idle → race header →          │
│   Journalist: finance │   candidate cards + photos →    │
│   gap heatmap         │   finance chart →               │
│                       │   bill feed →                   │
│                       │   news cards →                  │
│                       │   evidence cards                │
│                       │                                 │
│                       │   [Research progress bar]       │
│                       │   District → Candidates →       │
│                       │   Finance → Record → News       │
│                       │                                 │
└───────────────────────┴─────────────────────────────────┘
│  [CopilotKit Chat Sidebar — follow-up depth]            │
└─────────────────────────────────────────────────────────┘
```

Three input surfaces funnel into the same state machine:
1. **Address bar** → `lookup_district` → agent fires full sequence
2. **Map click** → state selected → race picker → agent fires
3. **Chat** → follow-up questions, journalist queries, position searches

---

## Canvas Components

| Agent state update | Component rendered |
|---|---|
| `stage: "district"` | Race header — race key, state, office, boundary note |
| `candidates: [...]` | `CandidateCard` row — photo, name, party pill, status badge, FEC ID |
| `finance: [...]` | `FinanceChart` — horizontal bars, individual vs PAC breakdown |
| `legislation: [...]` | `BillFeed` — timeline, bill ID, title, committee status |
| `news: [...]` | `NewsCard` stack — headline, source, date, Perplexity snippet |
| `positions: [...]` | `EvidenceCard` — direct quote, source URL, date |
| `stateRaces: [...]` | `RaceTable` — sortable by finance gap, PAC %, competitiveness |
| `briefReady: true` | `ExportButton` — download markdown brief |

---

## Candidate Photos

| Candidate type | Source | Method |
|---|---|---|
| Incumbent (sitting member) | bioguide.congress.gov | `bioguide_id` already in `legislator_profiles` Atlas collection (536 records from Phase 3 import) → `https://bioguide.congress.gov/bioguide/photo/{LETTER}/{ID}.jpg` |
| Challenger (serious FEC filer) | Ballotpedia | `get_legislator_profile` tool scrapes candidate page, extracts `og:image` |
| Any fallback | Styled avatar | Party color + initials — always renders, never breaks layout |

`build_candidate_profile` resolves `photoUrl` server-side. Canvas receives a clean string; never fetches photos directly.

---

## Tool Suite (14 tools, up from 6)

### Existing tools — move server-side
- `lookup_district(address)` — Geocod.io, district resolution
- `get_race_brief(race_key)` — candidates + FEC finance summary
- `get_incumbent_legislation(race_key)` — Congress.gov bills from Atlas
- `find_candidate(name, state?)` — FEC name search

### New MongoDB tools
- `get_state_races(state_code)` — all races in a state, sorted by finance gap; feeds map click
- `get_map_heatmap()` — all 503 races with precomputed `finance_gap`; called once on load to color the map
- `get_legislator_profile(race_key)` — full profile from `legislator_profiles` (bio, committees, social, photo metadata)
- `find_competitive_races(state?, min_candidates?)` — races where challenger receipts exceed or approach incumbent receipts
- `flag_finance_patterns(race_key)` — computes PAC concentration ratio, self-funding flags, loan flags from `finance_summaries`
- `build_candidate_profile(candidate_id)` — merges Atlas data (finance, legislation, committees, bio, photo) into a single structured profile object
- `compare_candidates(race_key)` — side-by-side structured comparison; the guardrail-safe response to "who should I vote for?"
- `generate_race_brief(race_key)` — export-ready markdown with numbered citations

### New Perplexity tools
- `search_candidate_positions(candidate_name, issue)` — what has this candidate publicly said about this issue; `sonar-pro`, 1-year recency, civic domain allowlist
- `search_current_news(candidate_name)` — last 7 days news; `sonar-pro`, week recency, broad source pool

### Perplexity configuration (locked from research)
- **Model:** `sonar-pro` for both tools
- **Domain allowlist:** `.gov`, `ballotpedia.org`, `opensecrets.org`, `congress.gov`, `fec.gov`, `politifact.com`, `factcheck.org`, `apnews.com`, `reuters.com`, `npr.org` (max 20 entries, TLD trick for `.gov`)
- **`search_context_size`:** `"medium"` — "high" quadruples cost
- **Citations:** always render from `search_results` (has title + date + snippet); `citations` array maps positionally to `[1][2]` inline markers
- **Rule:** Perplexity never overrides MongoDB data; Congress.gov facts from Atlas take precedence

---

## Voter Flow (primary demo arc)

User pastes address or clicks a state. Agent fires automatically — no prompting needed:

```
1. lookup_district(address)
   → stage = "district" → race header appears

2. get_race_brief(race_key) + get_state_races(state) [parallel]
   → candidates = [...] → CandidateCards render with photos
   → map highlights state, dims others

3. get_race_finance_brief(race_key)
   → finance = [...] → FinanceChart animates in

4. get_incumbent_legislation(race_key)
   → legislation = [...] → BillFeed appears

5. search_current_news(incumbent_name)
   → news = [...] → NewsCards appear
   → stage = "complete"
```

Full sequence: ~8–12 seconds. Canvas fills piece by piece. Judges see the agent working.

**Follow-up queries:**
- "What does Moore say about housing?" → `search_candidate_positions` → `EvidenceCard` inline
- "Who is the challenger?" → answered from state instantly
- "Who should I vote for?" → guardrail fires → `compare_candidates` offered instead

---

## Journalist Flow

**Mode switch:** toggle Voter → Journalist at top. Canvas reframes, doesn't reset.

**Map transforms:** neutral grey → finance-gap heatmap. Red = incumbent dominant, yellow = competitive, green = challenger leading. State badge shows count of competitive races.

**Entry points:**
1. Click state on heatmap → `get_state_races("WI")` → `RaceTable` populates
2. Chat query: "Find incumbents being outraised" → `find_competitive_races()` → filtered table
3. Click any row → full voter-mode canvas for that race

**`RaceTable` columns:** Race | Incumbent | Challenger | Inc. Raised | Chal. Raised | Gap | PAC % — all sortable.

**Journalist-specific queries:**
- "Which candidates have PAC concentration over 60%?" → `flag_finance_patterns()` across state races → rows flagged
- "Build me a brief on WI-04" → `generate_race_brief()` → markdown export with numbered citations
- "What's the most interesting thing about this race?" → agent synthesizes finance anomalies + legislation + Perplexity news → story angle in 2–3 sentences

**Export brief format:**
```markdown
# 2026-H-WI-04 — Wisconsin 4th Congressional District
Generated: 2026-05-15 | Source: DistrictLens | Apache 2.0

## Candidates
- Gwen Moore (DEM, incumbent) — raised $844K, 61% PAC [1]
- Purnima Nath (REP, challenger) — raised $0 [1]

## Incumbent Legislative Record (119th Congress)
6 sponsored bills including HR8521 (Protect Moms From Domestic Violence Act) [2]

## Recent News (last 7 days)
...cited Perplexity summary [3][4]

## Sources
[1] FEC bulk data — fec.gov, imported 2026-05-14
[2] Congress.gov — congress.gov/member/...
[3] AP News — apnews.com/...
```

---

## 30-Day Build Plan

### Week 1 — Foundation (Days 1–7)
- Move all 4 existing tools from client-side hooks to server-side `CopilotRuntime({ actions: [...] })`
- Wire `useCoAgentStateRender` with the shared state object
- Build three-zone layout: map / canvas / chat
- `react-simple-maps` — clickable states, voter mode (neutral)
- Canvas renders `CandidateCard` (bioguide photo join) and `FinanceChart`
- Research progress bar

**Milestone:** paste address → candidate cards with photos + finance chart in canvas via agent state

### Week 2 — New Tools + Full Canvas (Days 8–14)
- New MongoDB tools: `get_state_races`, `get_map_heatmap`, `find_competitive_races`, `flag_finance_patterns`, `build_candidate_profile`, `compare_candidates`
- Perplexity integration: `search_candidate_positions`, `search_current_news`
- Remaining canvas components: `BillFeed`, `NewsCard`, `EvidenceCard`
- Full voter flow end-to-end — all stages firing

**Milestone:** full voter demo — address → candidates + photos → finance → legislation → news → "what does Moore say about housing?" → EvidenceCard with Perplexity citation

### Week 3 — Journalist Mode (Days 15–21)
- Mode toggle + canvas reframe
- Finance-gap heatmap on map
- `RaceTable` with column sorting
- `generate_race_brief` + markdown export
- Cross-race queries in chat
- Congressional district boundaries — Census GeoJSON for 435 districts

**Milestone:** full journalist demo — heatmap → click state → race table → sort by PAC % → click race → full brief → export markdown

### Week 4 — Polish + Submission (Days 22–30)
- Guardrail UX polish (refusal feels intentional, not broken)
- `compare_candidates` side-by-side layout
- `/api/health` endpoint
- `.env.example` with safe placeholders
- Demo script rehearsed 3× minimum
- Demo video recorded (~3 min)
- DevPost listing — description, screenshots, tech list, MongoDB track
- README: hosted URL, setup, architecture diagram

**Milestone:** submitted

---

## Demo Script (3 Minutes)

| Time | Beat | Visual |
|---|---|---|
| 0:00–0:15 | "Election information is public but fragmented. DistrictLens builds your race brief in real-time, citing every fact." | Landing page with map |
| 0:15–0:45 | Paste Milwaukee address → canvas builds: race header → candidate cards with photos → finance chart → bill feed → news | Watch the canvas fill |
| 0:45–1:15 | "What does Moore say about housing?" → EvidenceCard appears with quote + source | Perplexity tool fires, trace visible |
| 1:15–1:30 | "Who should I vote for?" → guardrail fires → compare_candidates offered | Clean refusal + offer |
| 1:30–2:00 | Switch to Journalist mode → map goes red/yellow/green → click Wisconsin → RaceTable populates | Mode switch |
| 2:00–2:30 | "Find incumbents being outraised" → table filters → click most interesting race → drill in | Cross-race query |
| 2:30–2:50 | "Build me a brief" → generate_race_brief → markdown export | Export flow |
| 2:50–3:00 | "Built with CopilotKit AG-UI, Gemini 2.5 Pro, MongoDB Atlas, Perplexity Sonar, and public civic data." | Architecture or repo |

---

## Civic Safety (non-negotiable throughout)

- Agent never recommends a vote under any framing
- `compare_candidates` is the only response to voting questions
- Perplexity results labeled by source quality (official statement vs. third-party characterization)
- Finance data explicitly labeled as fundraising context, not position evidence
- Missing evidence stated explicitly: "I found no direct statement in the indexed sources"
- All citations link to stored or live primary sources

---

## Key Dependencies

| Dependency | Status |
|---|---|
| MongoDB Atlas (3,920 candidates, 503 races, 8,373 bills, 536 profiles) | Live |
| Perplexity API key | Available |
| Geocod.io API key | Live |
| Cloud Run (agent + web) | Live |
| `react-simple-maps` | To install |
| Census GeoJSON (435 districts) | To fetch (Week 3) |
| `unitedstates/congress-legislators` | Already imported to Atlas (Phase 3) |
