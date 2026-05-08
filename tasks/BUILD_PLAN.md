
> **Note:** Build plan needs revision per 2026-05-08 grilling decisions before implementation begins. Major changes: monorepo structure (`agent/` + `web/`), drop Elastic phases, use OSS HeroUI not Pro, add evals + privacy + refusal infrastructure phases, Apache 2.0 license at root, GitHub Actions CI/CD with Tier 1 eval gates. See [DECISIONS_LOG.md](../docs/DECISIONS_LOG.md) for the full canonical decision set.

## Phase 0: Agents CLI Scaffold

Before implementing custom application logic, set up Google Agents CLI and create the primary agent scaffold. Run `uvx google-agents-cli setup`, then `agents-cli scaffold districtlens-agent`, followed by `agents-cli install`. The generated scaffold is the implementation root for the hackathon agent. Copy or reference this documentation package inside the scaffold so the implementation remains traceable to the PRD and hackathon requirements.

# DistrictLens Claude Code Build Plan

## Phase 0: Planning and environment

Claude Code should first inspect the repository, confirm the chosen stack, and create a short implementation plan. Do not begin large edits until the plan is approved.

| Task | Acceptance criterion |
|---|---|
| Read package docs | Claude summarizes PRD, architecture, and guardrails. |
| Confirm stack | Developer confirms Next.js/Node/FastAPI or alternative. |
| Create `.env.example` | Includes all required API keys and service URLs. |

## Phase 1: Project skeleton

| Task | Acceptance criterion |
|---|---|
| Create app structure | Frontend, backend/API, services, schemas, tests. |
| Add type definitions | Candidate, race, source, claim, finance, citation types. |
| Add schema validation | Issue claim schema validates extraction output. |

## Phase 1A — Geocod.io district resolver

Implement a typed Geocod.io client with support for `cd120`, `cd`, `stateleg`, and `census` field appends. Add `POST /api/district/lookup`, cache responses in `district_lookups`, normalize district labels such as `VA-08`, and map district results to `race_key` candidates. Add UI handling for ZIP-only ambiguity and API-key-missing states.

## Phase 1B — CopilotKit agent UI layer

Add CopilotKit as the frontend agent experience layer. Embed the DistrictLens copilot panel, connect it to the ADK/Gemini backend route, register typed generative UI components, and expose frontend tools for race selection, evidence drawer opening, issue filtering, candidate focus, and full-address clarification. Keep OpenUI out of the critical path unless the MVP is already stable.

## Phase 2: FEC bulk import, live refresh, and race construction

| Task | Acceptance criterion |
|---|---|
| Implement selective FEC importer | Can import candidates by cycle, office, state, and district into MongoDB with `import_batch_id` and freshness metadata. |
| Implement FEC refresh tool | Can refresh one candidate, committee, race, or finance snapshot when missing, stale, or user-requested. |
| Build race keys | Unit tests cover House, Senate, and unknown district. |
| Implement optional Clerk auth layer | Public routes remain anonymous; saved districts, saved briefs, preferences, and persisted threads require Clerk when enabled. |
| Protect admin operations | Import, refresh, extraction, indexing, and review endpoints require Clerk admin role and/or `ADMIN_API_SECRET`. |
| Classify candidates | Candidates are labeled incumbent/challenger/open-seat candidate where data supports it. |
| Store in MongoDB | Races, candidates, committees, finance snapshots, import batches, and refresh logs are populated idempotently. |

## Phase 3: Congress.gov/GPO bulk import and live refresh

| Task | Acceptance criterion |
|---|---|
| Implement Congress client | Supports member, sponsored legislation, cosponsored legislation, bill subjects, summaries, and votes where available. |
| Map incumbents | Demo incumbents have legislative records. |
| Store actions | Legislative evidence is stored and indexed. |

## Phase 4: Source discovery and issue evidence

| Task | Acceptance criterion |
|---|---|
| Implement search provider interface | Perplexity adapter can return normalized source URLs. |
| Implement source fetcher | Fetches pages and stores clean text with hash. |
| Implement claim extractor | LLM output validates against schema. |
| Seed demo race URLs | 3–5 demo races have campaign/questionnaire sources. |

## Phase 5: Retrieval and agent answering

| Task | Acceptance criterion |
|---|---|
| Implement MongoDB retrieval | Agent can retrieve candidates, finance, claims, and sources. |
| Implement Elastic retrieval | Agent can search relevant evidence by issue query. |
| Implement answer generator | Answers include citations, confidence, and limitations. |
| Add guardrail tests | Vote recommendation and donor inference prompts are handled safely. |

## Phase 6: UI and demo polish

| Task | Acceptance criterion |
|---|---|
| Race search UI | User can search district/candidate and open a race page. |
| Candidate cards | Candidate cards show status and finance snapshot. |
| Issue Q&A | Chat or prompt panel answers issue questions with evidence cards. |
| Demo script | A reproducible script can ingest demo races and run the demo locally. |

## Phase 7: Optional deployment

| Task | Acceptance criterion |
|---|---|
| Cloud Run deployment | App/API deployed with environment variables. |
| Managed databases | MongoDB and Elastic configured. |
| Demo README | Judges can understand data sources, bulk-import baseline, live-refresh behavior, and guardrails. |
| Bulk import validation | Demo races load from MongoDB without external API calls, and refresh tools update records on demand. |

## Deferred Phase 1D — State and local ballot layer

This phase is **post-MVP** and should not be built for the hackathon unless the federal congressional demo is already complete and the user explicitly reopens scope.

| Deferred task | Post-MVP acceptance criteria |
|---|---|
| Add `contest_key` model and new MongoDB collections. | Future `election_events`, `contests`, `contest_candidates`, `ballot_items`, and `state_legislative_actions` schemas validate without disrupting the federal race flow. |
| Implement `/api/ballot/lookup`. | Future full-address lookup returns district context, election events, contests, candidates, ballot items, source freshness, and warnings. |
| Add primary ballot provider. | Future BallotReady/CivicEngine or Ballotpedia responses are cached and normalized for configured jurisdictions; Google Civic remains fallback-only. |
| Add curated official seed importer. | Future CSV/JSON official local election files can fill gaps with review and provenance metadata. |
| Add OpenStates enrichment. | Future state legislative incumbents can show state bills, votes, committees, and source URLs. |
| Update CopilotKit UI. | Future ballot view groups contests by federal, state, local, and ballot-measure sections with coverage labels. |

## Phase 1C — HeroUI Pro Civic Brutal design system

Add HeroUI Pro as the deterministic frontend design system and configure a restrained Civic Brutal variant of the Brutalism theme. Use HeroUI Pro for the app shell, Sidebar, Command Palette, Data Grid, KPI cards, charts, evidence Sheet/Drawer, candidate cards, source-trace timeline, and ballot grouping views. Keep CopilotKit as the agent interaction layer, but require CopilotKit-rendered components to use approved HeroUI-based visual components and typed props.

| Task | Acceptance criteria |
|---|---|
| Configure HeroUI Pro and theme tokens. | App loads a Civic Brutal theme based on Brutalism with neutral civic colors, strong borders, and accessible contrast. |
| Add `.mcp.example.json`. | Local setup documents HeroUI Pro MCP and HeroUI OSS MCP without committing secrets. |
| Build dashboard primitives. | Race overview, candidate compare, finance, evidence, and ballot sections use consistent HeroUI Pro components. |
| Integrate with CopilotKit. | Agent panel can open evidence, focus candidates, and render approved HeroUI-based generative components. |
| Preserve civic neutrality. | Party colors are limited to small metadata pills and all evidence claims show source labels. |


## Deferred Post-MVP: Local and State Race Layer

Do **not** implement local-race provider lookup, official local CSV ingestion, Google Civic voterInfo ingestion, or Perplexity + TabStack extraction for the hackathon MVP. Keep any related variables disabled by default. The team should revisit this layer only after the federal congressional workflow is complete, polished, and demo-ready.


## Optional Clerk auth acceptance tests

| Test | Acceptance criteria |
|---|---|
| Public demo path | A user can open the app, resolve a district, view a race, inspect citations, and ask a basic agent question without sign-in. |
| Saved district flow | A signed-in Clerk user can save and retrieve a district or race by `clerk_user_id`. |
| Saved brief flow | A signed-in Clerk user can save an answer snapshot with source refs and freshness metadata. |
| Admin protection | Anonymous and normal signed-in users cannot call `/api/admin/*` import, refresh, extraction, or indexing endpoints. |
| Missing Clerk keys | The app hides saved-user features but does not block public civic reads. |


## Legislator Enrichment Import Task

Implement a protected selective importer for `unitedstates/congress-legislators`. The importer should fetch current published files, normalize them by `bioguide_id`, and upsert `legislator_profiles`, `legislator_social_accounts`, `legislator_district_offices`, `congress_committees`, and `legislator_committee_memberships`. Candidate cards should use this enrichment to display official webpages, social links, committee context, FEC crosswalks, and photo metadata or deterministic portrait placeholders.

Acceptance criteria: public district pages render from MongoDB without live GitHub requests; admin import endpoints are protected; import batches capture source URL, source commit or published file checksum, counts, errors, and freshness metadata; and Congress.gov/GPO plus FEC remain authoritative for legislative and finance facts.
