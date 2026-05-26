# Handoff — DistrictLens Phase-2: the data-layer map

**Next session's job:** produce the **data-layer map** for the voter brief — a source→brief-section→coverage inventory that says, for every fact the brief wants, *which source provides it, at what cadence, and where the honest gap is (scrape vs. "not available")*. This is the deferred high-value entry point from the original brief-redesign fork. Everything downstream (filling the brief's empty cells, new ingestion, typed tools) depends on it.

Repo: `/Users/tarikmoody/Documents/Projects/districtlens` · prod project `civicsync-440613` (Cloud Run, us-central1).

## Where Phase-1 left things (don't redo this)

The **voter-brief reorg** shipped on branch `feat/voter-brief-reorg` → **PR #3** (https://github.com/tmoody1973/district-lens/pull/3), 19 commits, 94/94 tests, lint+tsc clean. Dogfooded live on ID-01; works. **Not yet merged, not yet deployed.**

The reorg is the *consumer* of the data layer. Read these to see exactly which cells/sections the data must feed — do not re-describe the UI, read the code:
- `web/src/lib/brief-layout.ts` — the pure `buildBriefLayout` descriptor: `HeaderFacts` (the scoreboard cells) + section plan. This is where new data lands.
- `web/src/components/canvas/DecisionHeader.tsx`, `CandidateField.tsx`, `RaceCanvas.tsx` — how it renders today.
- `docs/superpowers/specs/2026-05-25-voter-brief-reorg-design.md` — Phase-1 spec. **Its "Out of scope (deferred)" section is literally the Phase-2 gap list.**

**The honest gaps the brief already admits in the UI** (each is a data-layer target):
- Decision header: `competitivenessAvailable: false` → always renders "Competitiveness rating — not yet available". Needs partisan-lean/competitiveness data.
- Legislative record section (incumbents): currently only bills (Congress.gov). Missing: **vote attendance %, party-line %, bills authored vs. cosponsored vs. voted, committee assignments**.
- Money: currently FEC *summaries* only. Missing: **itemized contributions + independent expenditures** (in/out-district small-donor ratio, leadership-PAC, single-issue-PAC concentration, self-funding %, outside-spending-exceeds-candidate flag).

## The two source docs that define the target (read first)

- `docs/voter-brief-mod.md` — Tarik's product brief, **by office** (House / Senate / Governor). The data-layer map must cover all three offices' asks. Governor is a separate, messier track (state SOS data).
- `docs/voter-brief-architecture.md` — the proposed **warehouse → typed tools → agent-composes → CopilotKit-renders** architecture, with a per-section source map already sketched. **Reviewed and confirmed sound last session** with these corrections (apply them, don't relitigate):
  1. **No Convex** in this stack — it's MongoDB + Next + ADK; Mongo is already in place. Warehouse = Mongo.
  2. **FEC itemized is a big new ingest** vs. the *summaries* currently stored. Scope it as real work.
  3. **ProPublica Congress API is deprecated** → use **Congress.gov + GovTrack + `congress-legislators`** (the latter two partly ingested already; 8.3k actions / 536 legislators in Mongo).
  4. **Daily Kos Elections open dataset** = the right free partisan-lean / district-pres-result source. (Cook/Sabato/538 are paid or HTML-scrape.)
  5. **Pattern A** (single ADK root agent + typed tools) is already the reality — start there; defer Pattern B sub-agents.
  6. **Universal / district-scoped + session-only personalization** — NOT persisted voter profiles (trust/political-backdrop reasons). This is locked.

## Civic-safety spine (non-negotiable — see CLAUDE.md + .claude/rules/)

The whole point of the data layer: **the agent composes from verified data, it never generates facts.** Voting records, donor totals, attendance % come from typed sources into Mongo with `source_url` / `source_type` / `fetched_at` / `as_of_date` / `confidence`, never from an LLM. `as_of_date` matters separately from `fetched_at` (FEC Q3 filed Oct 15 reflects activity through Sept 30 — the brief should say "donor data as of Q3 2025"). Missing data renders explicitly ("not yet available"), never silence, never inference from party/donors.

## What the deliverable should actually be

A document (suggest `docs/DATA_LAYER_MAP.md`) — a table/matrix: **brief section/cell → desired datum → source (API/dataset/scrape) → access method → cadence → coverage estimate → gap verdict (have / ingestable / scrape-only / not-available)**. Plus a recommended ingestion sequence (what's cheap+high-value first). This is research + design, not implementation — it feeds the *next* plan.

## Assets already on hand

- **Official-results URL map JSON:** `/Users/tarikmoody/Downloads/official_2026_primary_results_urls_updated_clean.json` — 51 entries (50 states + DC), each with `primary_results_url`, `confidence`, `source_type`, `status`, `scraper_notes`, `verification_url`. **NOT yet in repo/Mongo.** Three uses: seed an `official_results_sources` Mongo collection; upgrade the nominee resolver's URL picking; governor/state-results baseline. Relevant to the Governor track of the map.
- **Firecrawl** (researched, NOT wired in): fits the **scrape half only** — JS-rendered SOS pages, PDFs, schema-based `/extract` to structured JSON. Good for state results / endorsements / executive-record scraping where no API exists. Paid; validate extracted numbers. Use real APIs (FEC/Congress.gov) where they exist.
- Existing Mongo collections: see `schemas/mongodb_collections.json`. FEC candidates (~3.9k) / races (~503), Congress.gov actions/legislators already imported.

## Gotchas (cost real time)

- **Web deploy is blocked** by Tarik's uncommitted pnpm→bun migration (`web/package.json` + `web/bun.lock` vs committed `pnpm-lock.yaml`; Dockerfile uses `pnpm install --frozen-lockfile`). Not Phase-2's problem but flag before any deploy.
- **Local `web/.env.local` has stale Geocodio/Perplexity/token keys** (Mongo URI is current). Local `next dev` geocoding (`/api/district/suggest`) works, but the brief/agent flow routes to the **prod** agent via `AGENT_URL`, so prod keys apply there. For local runs needing live keys: `gcloud secrets versions access latest --secret=<name> --project=civicsync-440613`.
- **FEC stores candidate names as `"Last, First"`** — bit us in Phase-1 (the `lastName`/matchup fix in commit `1413d17`). Any new FEC-derived display needs the same awareness.
- **Gemini model pin (project mandate):** `gemini-3.1-pro-preview`, `location="global"` everywhere.
- Mongo is the warehouse; cache external API responses with retrieval timestamps; don't overwrite raw evidence on refresh (see `.claude/rules/data_integrity.md`).

## Deferred (not Phase-2, but tracked)

- Dogfood the **party-grouped primary layout** live (`CandidateField` primary path) — Phase-1 only dogfooded a *called* race (ID-01). Unit-tested but not browser-verified.
- Merge PR #3 + deploy (after the bun migration is resolved); clearing stale `evidence_cache` positions post-deploy.

## Suggested skills for next session

- `superpowers:brainstorming` → `superpowers:writing-plans` — the data-layer map is a real research+design problem; scope it before any ingestion code. Tarik responds well to plan-first and **plain-English explanations of ADK/CopilotKit/data concepts** (memory `feedback_plain_english`).
- `Research` / `gsd-ai-researcher` — to inventory source APIs and confirm current access terms: Congress.gov, GovTrack, `congress-legislators`, FEC OpenFEC (itemized + independent expenditures), Daily Kos Elections, OpenStates, Census ACS, state SOS portals. Verify what's free/paid/deprecated *now* (training data is stale on API status — ProPublica already bit us).
- The map is the input to a *later* ingestion plan; don't write ingestion code this session unless Tarik redirects.
