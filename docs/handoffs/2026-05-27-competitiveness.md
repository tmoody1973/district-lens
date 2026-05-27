# Handoff — Competitiveness / partisan-lean in the voter brief

**Next session's job:** ingest district-level partisan lean (The Downballot pres-by-CD dataset) and surface a real **competitiveness rating** in the brief's decision header — replacing the hardcoded "Competitiveness rating — not yet available." This is the highest leverage-per-effort item left on the data-layer map: cheapest source (one free dataset), fixes a gap **every** race shows today, applies to **100% of races** (not just incumbents), and reframes the brief ("is my vote even contested?").

Repo: `/Users/tarikmoody/Documents/Projects/districtlens` · prod project `civicsync-440613` (Cloud Run, us-central1). Today: 2026-05-27.

## Where this session left things (all live in prod; don't redo)

`main` == prod. Shipped + deployed this session (PRs #4–#7, all merged):
- **Record pipeline** (PR #4): House vote attendance % + party-line %, computed from real Congress.gov votes. Ingested **81,903 `member_votes` + 436 `voting_record_summaries`** (119th/2nd session, 191 roll calls). Renders in the record section (`VotingRecordCard`).
- **MongoDB MCP step** (PR #5): a real read-only `count()` via `mongodb-mcp-server` as a visible "Verified via MongoDB MCP" brief step (hackathon MongoDB-track lock).
- **Brief-trace annotations** (PR #6): each brief step shows its tool/source/count (GEOCOD.IO, FEC, MongoDB MCP, Congress.gov, Perplexity) — `annotateSteps()` in `web/src/lib/steps.ts`.
- **Chat tool-trace** (PR #7): agent tool calls render inline in the chat as `TraceCard`s — `web/src/components/canvas/AgentToolTrace.tsx` via `useDefaultTool`.
- Current prod revisions: agent `districtlens-agent-00023-qbn`, web `districtlens-web-00039-swc`.

**Read first:** `docs/DATA_LAYER_MAP.md` — the verified source→section→coverage matrix produced this session. **Section 0 has the live Mongo ground-truth** (the `schemas/mongodb_collections.json` file is aspirational; trust the map). The competitiveness row + Section 4 cover this feature's source. ⚠️ `DATA_LAYER_MAP.md` and `docs/superpowers/plans/2026-05-26-voter-record-pipeline.md` are **uncommitted local files** — commit them if you want them durable.

## The feature

**Source (verified current, 2026):** **The Downballot** (formerly Daily Kos Elections) presidential-results-by-congressional-district dataset — a free public **Google Sheet** at **the-db.co/presbycd** → the-downballot.com. License = **cite + link, no full-sheet republish** (store derived per-district values, not the raw sheet — fine for us). It gives 2024 presidential margins per CD → the "R+N / D+N" partisan lean.
- ⚠️ **Verify the line vintage:** the dataset is keyed to **2024-election district lines**; mid-decade 2026 redraws (e.g. TX) may not be merged. Confirm before trusting a lean for redrawn states; mark unmatched districts as not-available (honest gap), don't guess.
- Optional later: competitiveness *ratings* (tossup/lean/safe) — only **Sabato's Crystal Ball** is free+reusable; Cook/Inside Elections/Silver are paywalled; the free aggregate path is scraping **270toWin**. Start with The Downballot lean alone; ratings are a follow-up.

**Data path (mirror the record pipeline):**
1. **Ingest** — new Python script `agent/scripts/ingest_partisan_lean.py`, mirroring `agent/scripts/ingest_house_votes.py` (pymongo `_get_db`, provenance fields `source_system`/`source_url`/`ingested_at`/`as_of_date`/`freshness_status`, `official_import_batches` audit). Fetch the Google Sheet as CSV (Sheets `export?format=csv` URL), parse per-CD pres margin, map the sheet's district id → our `race_key` format `2026-H-{STATE}-{DISTRICT:02d}` (Senate = statewide; the sheet is House-CD, so Senate uses the statewide pres margin). Write a new `district_partisan_lean` collection keyed by `race_key` (or state+district): `{ race_key, lean_party: "R"|"D"|"EVEN", lean_margin: float, pres_2024_margin, as_of_date, source_url, source_system, ... }`.
2. **Agent tool + brief step** — add a `get_district_context`/`get_partisan_lean(race_key)` tool in `agent/app/tools/mongodb_tools.py` (envelope `{status,data,warnings,source}`, `_to_*` camelCase transform, async `fetch_*` core), register it in `agent/app/agent.py` `_build_tools()`, and add a deterministic step to `agent/app/tools/brief_pipeline.py` (e.g. right after district resolution) that pushes `tool_context.state["competitiveness"]`. **NOTE for the brief pipeline:** if you add a new `stage`, you must also add it to `ResearchStage` in `web/src/types/agent-state.ts` + both maps in `web/src/lib/steps.ts` (they're exhaustive `Record<ResearchStage,...>`), or reuse the existing `district` stage and just attach the data (no new step).
3. **Frontend consumer** — the gap to flip:
   - `web/src/lib/brief-layout.ts`: `HeaderFacts.competitivenessAvailable: false` is **hardcoded** (line ~30 + ~165/183). Add a real field, e.g. `competitiveness: { lean: string; rating?: string; source: string } | null`, and populate it in `buildHeaderFacts` from a new `state.competitiveness` field.
   - `web/src/components/canvas/DecisionHeader.tsx:25-27`: replace the hardcoded "Competitiveness rating — not yet available" with the real lean when present (e.g. "Partisan lean: R+4 (2024 pres) · The Downballot"), keeping the honest gap string only when `competitiveness == null`.
   - `web/src/types/agent-state.ts`: add a `competitiveness` field to `DistrictLensState` + `DEFAULT_STATE` (the agent step pushes it as a `state_delta`).

## Civic-safety spine (non-negotiable — CLAUDE.md + .claude/rules/)
Partisan lean is **district context, not a prediction of any candidate's position** and **must never imply how to vote**. Label it as "2024 presidential result / partisan lean," cite The Downballot + `as_of_date`, and render an explicit gap for districts the dataset doesn't cover (redraws). It's computed from a stored source, never generated.

## Patterns + files to copy
- Ingest template: `agent/scripts/ingest_house_votes.py` (member-loop, flush, provenance, audit). Also `agent/scripts/ingest_legislators.py`.
- Tool template: `get_voting_record` in `agent/app/tools/mongodb_tools.py` (transform + async core + tool, all added this session) — the cleanest recent analog.
- Pipeline step: the `_verify_via_mcp` / voting-record steps in `agent/app/tools/brief_pipeline.py`.
- Tests: `agent/tests/unit/test_voting_metrics.py`, `test_voting_record_tool.py` (pytest, `uv run pytest tests/unit`); web `web/src/lib/__tests__/steps.test.ts` (vitest). TDD throughout — the pure parse/transform functions carry the coverage; live ingest + dogfook verify the I/O.

## Gotchas (cost real time)
- **Deploy = manual `gcloud`** (the GitHub `deploy-to-prod.yaml` requires WIF, which isn't wired → it fails at auth). Pattern that worked all session: `gcloud run deploy districtlens-{agent|web} --source {agent|web} --region us-central1 --project civicsync-440613 --quiet` (preserves existing env/SA). Both services live in us-central1.
- **Uncommitted HeroUI Pro WIP on `main`** (`.gitignore`, `web/package.json`, `web/bun.lock`). The web Dockerfile uses `pnpm install --frozen-lockfile`, so building from the dirty tree fails (package.json ≠ pnpm-lock.yaml). Before any **web** deploy: `git stash push .gitignore web/package.json web/bun.lock`, deploy, then `git stash pop`. (Agent deploys are unaffected.)
- **Stale `agent/app/.env` `MONGODB_URI`** (pre the 2026-05-24 rotation) — local agent scripts fail Atlas auth. Run ingest with the current URI: `export MONGODB_URI="$(grep '^MONGODB_URI=' web/.env.local | sed 's/^MONGODB_URI=//' | tr -d '"')"` then `uv run python ...`. `load_dotenv(override=False)` won't clobber the exported value. (web/.env.local Mongo URI is current; prod uses Secret Manager.)
- **Pre-existing red CI** on every PR: `lint` (codespell flags "ND" in `app/refresh/calendar.py` + `nominee_resolver.py` — not your code) and `unit-tests` (`test_resolve_nominees_job` needs `PERPLEXITY_API_KEY`, not set in CI). `mergeStateStatus` is UNSTABLE not BLOCKED — PRs #4–7 all merged through these. Not your bug; don't chase it (or fix as the "loose ends" task).
- **Headless dogfook is flaky** for the brief (CopilotKit SSE streaming lags in headless; the brief sometimes stalls at "Candidates loaded" in `browse` even though it completes for real users). The chat path dogfooks reliably. To trigger the brief in `browse`: fill the address input, click "Find My Race", then click the geocode suggestion (`@c1`).
- **FEC stores names "Last, First"** (bit us before). Gemini pin: `gemini-3.1-pro-preview`, `location="global"` everywhere.

## Suggested skills / approach
- This is a clean full-stack feature like the record pipeline. `superpowers:writing-plans` → execute (subagent-driven worked well this session). Or implement directly with TDD given it's well-scoped.
- One genuine open decision to resolve early: **how to map The Downballot's district identifiers to `race_key`** (their column format vs `2026-H-XX-NN`), and **how to handle 2026 redrawn districts** the 2024-lines dataset doesn't match (honest gap). Confirm the sheet's actual columns by fetching it first (like the Congress.gov payload was captured before coding).
- Tarik responds well to plan-first + **plain-English explanations of ADK/CopilotKit/data concepts** (memory `feedback_plain_english`).

## Memory worth reading
`districtlens_schema_vs_reality` (schema JSON is aspirational), `districtlens_governor_in_scope` (Governor now in scope, Wave-3), `feedback_plain_english`, `districtlens_secret_hardening_followup` (rotation context).
