# Claude Code Handoff Prompt

Paste this into Claude Code after opening the repository that contains this package.

> Read `CLAUDE.md`, `AGENTS.md`, `docs/HACKATHON_REQUIREMENTS.md`, `docs/HACKATHON_TECHNICAL_ARCHITECTURE.md`, `docs/AGENTS_CLI_IMPLEMENTATION.md`, `docs/GEOCODIO_INTEGRATION.md`, `docs/COPILOTKIT_UI_DECISION.md`, `docs/HEROUI_PRO_DECISION.md`, `docs/HEROUI_PRO_ADOPTION_SCOPE.md`, `docs/UI_RECOMMENDATION.md`, `docs/UI_WIREFRAME_SPEC.md`, `docs/HACKATHON_REQUIREMENTS_AUDIT.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/DATA_STRATEGY.md`, `docs/GUARDRAILS.md`, `specs/MCP_INTEGRATION.md`, `specs/TOOLS.md`, `specs/API_SPEC.md`, `schemas/mongodb_collections.json`, `schemas/issue_claim.schema.json`, `tasks/BUILD_PLAN.md`, `tasks/HACKATHON_MVP.md`, and `tasks/DEVPOST_SUBMISSION_CHECKLIST.md`. Work in plan mode. First summarize the hackathon requirements, partner-track choice, product, stack assumptions, Geocod.io district resolver, data flow, MCP integration plan, UI plan, judging risks, and Devpost submission needs. Then propose a phase-by-phase implementation plan for the MVP. Do not write code until I approve the plan.

After approving the plan, use this follow-up prompt:

> Implement Phase 1 only: project skeleton, environment template, shared TypeScript types, schema validation for issue claims, Geocod.io district lookup types, and initial tests for race key construction and civic guardrails. Keep changes small and explain every file created.

Use these additional prompts for later phases:

| Phase | Prompt |
|---|---|
| Hackathon foundation | Implement the project skeleton around the hackathon architecture: Gemini/Google Cloud agent orchestration boundary, MongoDB MCP integration boundary, activity trace model, `.env.example`, health checks, and documented deployment assumptions. |
| Geocod.io district resolver | Implement the Geocod.io client, `POST /api/district/lookup`, `district_lookups` cache, `cd120` default behavior for 2026 workflows, ZIP-only ambiguity handling, and race-key mapping from district results. |
| CopilotKit agent UI | Add CopilotKit to the React frontend, connect it to the ADK/Gemini backend, register typed generative UI components, and expose frontend tools for selected race, evidence drawer, issue filters, candidate focus, and full-address clarification. |
| HeroUI Pro Civic Brutal UI | Configure HeroUI Pro, use the Brutalism theme as a restrained Civic Brutal variant, add the app shell, dashboard primitives, Data Grid/candidate comparison, evidence drawer, and `.mcp.example.json` setup guidance. Keep HeroUI Pro MCP as development-time tooling only. |
| FEC import and refresh | Implement selective FEC import jobs, FEC refresh tools, race key construction, candidate normalization, finance snapshot persistence, freshness metadata, and MongoDB-first reads. Add tests for House and Senate race keys, import idempotency, freshness policy, and incumbent/challenger/open-seat classification. |
| Congress.gov/GPO import and refresh | Implement selective Congress.gov/GPO import jobs plus refresh tools for member, sponsored legislation, cosponsored legislation, committees, related bills, bill subjects, bill summaries, laws, bill text links, and House vote records where available. Store legislative actions with source URLs and freshness metadata. |
| Source discovery | Implement the `SourceDiscoveryProvider` interface and a Perplexity adapter. Use search results only to discover URLs; do not cite snippets as evidence. |
| Issue extraction | Implement source fetching, text cleanup, issue-claim extraction, JSON schema validation, confidence labels, and storage. |
| MCP integration | Implement the MongoDB-backed `CivicMemoryProvider`, official-data freshness inspection, refresh-result persistence, and at least one visible MCP-backed agent operation. The demo path must show partner MCP use in the agent trace. |
| Clerk public-first auth | If time permits, add optional Clerk sign-in for saved districts, saved briefs, preferences, and persisted user threads. Do not require sign-in for district lookup, race pages, evidence viewing, or basic agent answers. Protect admin import, refresh, extraction, and indexing endpoints. |
| Agent answering | Implement the retrieval-first answer pipeline with guardrail checks, citations, limitations, refusal behavior for vote recommendations, and activity traces suitable for the three-minute hackathon demo. |
| UI | Build the district/address search flow, race detail page, candidate cards, finance snapshot, issue Q&A panel, evidence cards, and an agent activity trace panel that makes tool execution visible to judges. |
| Submission readiness | Verify hosted app URL, public repository readiness, open-source license, demo script, partner-track selection, screenshots, and `tasks/DEVPOST_SUBMISSION_CHECKLIST.md`. |

Important update: Google Agents CLI is allowed for this hackathon and should be treated as the preferred build path. Start by setting up Agents CLI, scaffolding `districtlens-agent`, and implementing the DistrictLens tools inside the generated ADK/Gemini project structure.


## Fresh state/local ballot data correction

For the hackathon MVP, do **not** implement current governor, state senate, state house, municipal, school-board, judicial, ballot-measure, or other local race coverage. Keep the product focused on federal congressional district intelligence. Treat BallotReady/CivicEngine, Ballotpedia, Democracy Works, AP Elections, official local sources, and Google Civic as post-MVP notes unless the user explicitly reopens this scope.


## Deferred Perplexity + TabStack instruction

Do not build the Perplexity + TabStack local-race bridge for the hackathon MVP. Perplexity may still be used for candidate issue-source discovery in the federal evidence workflow, but local-race extraction is post-MVP.


### Add unitedstates/congress-legislators enrichment import

Include a MongoDB bulk-import path for `unitedstates/congress-legislators`. Import current member identity, terms, official webpages, social media, district offices, committees, FEC crosswalk IDs, and photo resolver metadata. Use Bioguide as the canonical key. Keep Congress.gov/GovInfo/GPO as the official legislative-record source and FEC as the official finance source.
