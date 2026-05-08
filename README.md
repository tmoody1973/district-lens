# DistrictLens Claude Code Build Package

**DistrictLens** is a nonpartisan civic intelligence agent for the 2026 midterm cycle. It helps voters, journalists, students, and civic organizations understand a congressional race by connecting **who is running**, **who funds the race**, **what incumbents have done in Congress**, **what candidates say they support**, and **how district context shapes the race**.

This package is designed to be copied into a repository and handed to **Claude Code** as the build specification. Start with `CLAUDE.md`, then read the hackathon requirements, PRD, architecture, schemas, MCP integration specification, and task plan. The package now explicitly maps DistrictLens to the **Google Cloud Rapid Agent Hackathon** requirements, judging criteria, partner MCP expectations, and Devpost submission needs.

## Recommended Claude Code workflow

Open the project in Claude Code and ask it to work in plan mode before editing code. A good first prompt is:

> Read `CLAUDE.md`, `docs/HACKATHON_REQUIREMENTS.md`, `docs/HACKATHON_TECHNICAL_ARCHITECTURE.md`, `docs/GEOCODIO_INTEGRATION.md`, `docs/COPILOTKIT_UI_DECISION.md`, `docs/UI_RECOMMENDATION.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `specs/MCP_INTEGRATION.md`, `specs/TOOLS.md`, `schemas/mongodb_collections.json`, `tasks/HACKATHON_MVP.md`, and `tasks/BUILD_PLAN.md`. Then propose an implementation plan for the MVP and wait for my approval before writing code.

## Package map

| Path | Purpose |
|---|---|
| `CLAUDE.md` | Project-wide rules, constraints, and coding standards for Claude Code. |
| `AGENTS.md` | Agent roles/personas used by the application and development workflow. |
| `docs/HACKATHON_REQUIREMENTS.md` | Explicit Rapid Agent Hackathon compliance, judging alignment, partner-track decision, and submission checklist. |
| `docs/HACKATHON_TECHNICAL_ARCHITECTURE.md` | Detailed hackathon-specific architecture using Gemini, Google Cloud Agent Builder, partner MCP, Cloud Run, and external civic APIs. |
| `docs/HACKATHON_REQUIREMENTS_AUDIT.md` | Gap audit explaining what was added to align the package with the hackathon. |
| `docs/GEOCODIO_INTEGRATION.md` | Decision memo and implementation notes for using Geocod.io as the address-to-district and civic-enrichment layer. |
| `docs/COPILOTKIT_UI_DECISION.md` | Decision memo recommending CopilotKit over OpenUI for the MVP agent panel, generative UI, and human-in-the-loop experience. |
| `docs/UI_RECOMMENDATION.md` | Recommended product UI pattern for the civic brief experience. |
| `docs/UI_WIREFRAME_SPEC.md` | Wireframe-level UI specification for Claude Code or frontend implementation. |
| `docs/PRD.md` | Product requirements document for DistrictLens. |
| `docs/ARCHITECTURE.md` | Technical architecture and service flow. |
| `docs/DATA_STRATEGY.md` | Data acquisition strategy for races, candidates, finance, issue positions, and evidence. |
| `docs/BULK_IMPORT_REFRESH_STRATEGY.md` | MongoDB bulk-import-first strategy with live FEC, Congress.gov, and GPO refresh tools. |
| `docs/AUTH_STRATEGY.md` | Public-first Clerk authentication strategy for saved user features and protected admin operations. |
| `docs/GUARDRAILS.md` | Nonpartisan civic-safety and citation guardrails. |
| `specs/MCP_INTEGRATION.md` | Partner MCP integration specification for the MongoDB primary track and Elastic alternate track. |
| `specs/TOOLS.md` | Tool contracts for FEC, Congress.gov, search, source retrieval, extraction, MongoDB, and Elastic. |
| `specs/API_SPEC.md` | Proposed backend API surface for the web app and agent. |
| `schemas/mongodb_collections.json` | MongoDB collection shapes and indexes. |
| `schemas/issue_claim.schema.json` | JSON Schema for extracted candidate issue-position claims. |
| `prompts/agent_system_prompt.md` | Draft system prompt for the DistrictLens runtime agent. |
| `prompts/claim_extraction_prompt.md` | Prompt for extracting issue claims from source documents. |
| `tasks/BUILD_PLAN.md` | Claude Code implementation phases and acceptance criteria. |
| `tasks/HACKATHON_MVP.md` | Scope control for a demo-ready hackathon build. |
| `examples/sample_agent_queries.md` | Example user queries and expected answer patterns. |
| `.claude/rules/*.md` | Modular Claude Code rules for data, citations, tests, and UI. |

## MVP thesis

The strongest MVP is not a generic election chatbot. It is a **cited race brief agent**. The demo should let a user choose or type a district, inspect all candidates, compare campaign-finance signals, and ask issue-position questions that return evidence quotes and source links.

DistrictLens should be **public-first** for the core civic experience. Clerk authentication is optional for saved districts, saved briefs, preferences, and user-owned research history, and required for admin-only import, refresh, extraction, and indexing operations. The hosted hackathon demo must remain usable without sign-in.

## External services

The build assumes API keys or service credentials may be provided through environment variables. DistrictLens should **bulk import selected FEC and Congress.gov/GPO-derived records into MongoDB first**, then use official APIs for missing, stale, or user-requested live updates. The public FEC demo key can rate-limit quickly, so use a personal `FEC_API_KEY` for refresh jobs and controlled ingestion. Congress.gov also requires an API key for production refreshes.

| Service | Env var | MVP role |
|---|---|---|
| FEC OpenFEC API | `FEC_API_KEY` | Bulk-import seed data plus live refresh for candidate, committee, finance, filing, and independent-expenditure records. |
| Congress.gov API | `CONGRESS_API_KEY` | Bulk-import seed data plus live refresh for incumbent members, sponsored/cosponsored legislation, bill summaries, subjects, related bills, laws, and votes. |
| Geocod.io API | `GEOCODIO_API_KEY` | Address or coordinate lookup for congressional districts, 2026/120th Congress district context, state legislative districts, Census geography, and civic identifiers. |
| Perplexity or other search API | `PERPLEXITY_API_KEY` or provider-specific key | Optional source discovery for campaign websites, issue pages, questionnaires, and news quotes. |
| MongoDB Atlas | `MONGODB_URI` | Primary app-read layer, bulk-imported civic memory, evidence store, claim store, freshness metadata, refresh results, user-owned saved artifacts, and cached briefs. |
| Elastic Cloud | `ELASTICSEARCH_URL`, `ELASTICSEARCH_API_KEY` | Hybrid search over source documents, claims, and legislative evidence. |
| Clerk | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Optional sign-in for saved districts, saved briefs, user preferences, correction submissions, and protected admin workflows. |
| LLM provider | `OPENAI_API_KEY` or configured provider | Agent reasoning and structured extraction. |

## Build stack recommendation

For speed, build a TypeScript application with a backend API and a simple web UI. Use the Google Cloud Agent Starter Pack or Google Cloud Agent Builder pattern as the agent orchestration foundation where possible, because the hackathon rewards functional agents powered by Gemini and Google Cloud. The default partner track should be **MongoDB**, with MongoDB MCP Server as the visible partner integration. Recommended components are:

| Layer | Recommendation |
|---|---|
| Frontend | Next.js or Vite React with district/race search and agent chat. |
| Backend | FastAPI or Node/Express API with tool endpoints. |
| Agent orchestration | Google Cloud Agent Starter Pack / Google Cloud Agent Builder pattern with Gemini-powered planning and synthesis. |
| Required partner MCP | MongoDB MCP Server for race lookup, finance retrieval, freshness inspection, issue evidence search, source-document storage, refresh-result persistence, and brief cache. |
| Storage | MongoDB Atlas as the **bulk-imported civic memory and primary read model**; Elastic as an optional alternate or secondary hybrid retrieval layer. |
| Deployment | Google Cloud Run for app/API; managed MongoDB and Elastic. |

## Primary Build Path: Google Agents CLI

DistrictLens now uses **Google Agents CLI** as the preferred implementation path for the hackathon build. Claude Code should install/setup Agents CLI, scaffold the `districtlens-agent` project, implement selective FEC and Congress.gov/GPO importers, live refresh tools, source-discovery, MongoDB MCP, and optional Elastic tools inside the generated ADK structure, then run evaluations and deploy through the Google Cloud path.

Read `docs/AGENTS_CLI_IMPLEMENTATION.md` immediately after the hackathon requirements and technical architecture documents. The Google Cloud Agent Starter Pack remains useful as a reference architecture, but Agents CLI is the most concrete Claude Code execution path.

## State and local election extension

DistrictLens now intentionally **defers governor, state senate, state house, county, municipal, school-board, judicial, and ballot-measure race coverage until post-MVP**. See `docs/MVP_SCOPE_DECISION.md` and `docs/STATE_LOCAL_ELECTION_STRATEGY.md`. The hackathon build should focus on congressional district intelligence, federal candidate comparison, FEC finance, Congress.gov incumbent context, source-backed issue evidence, MongoDB civic memory, CopilotKit, and HeroUI Pro.

## Frontend design-system decision

DistrictLens should use **HeroUI Pro** with a restrained **Civic Brutal** theme for the deterministic dashboard UI, while keeping **CopilotKit** for the right-side agent panel and typed generative UI. The package includes `docs/HEROUI_PRO_DECISION.md`, `docs/HEROUI_PRO_ADOPTION_SCOPE.md`, and `.mcp.example.json` for local HeroUI Pro MCP setup. Do not commit a real `HEROUI_PERSONAL_TOKEN`; configure it only in local or secret-managed development environments.


### Post-MVP local-race discovery bridge

Perplexity Search API and TabStack are now **deferred**. They remain documented as a future official-source discovery and extraction bridge, but they should not be implemented for the hackathon MVP unless the team has already finished the federal demo and has extra time.


## Legislator Identity Enrichment Import

DistrictLens now includes the `unitedstates/congress-legislators` dataset as a **MongoDB bulk-import enrichment source** for current congressional member identity, official webpages, social media handles, district offices, committee assignments, FEC crosswalk IDs, and photo-resolution metadata. This enrichment layer is intentionally separate from the official legislative-record layer: **Congress.gov/GovInfo/GPO remain authoritative for bills, votes, laws, summaries, and legislative actions**, while FEC remains authoritative for campaign finance. See `docs/LEGISLATOR_ENRICHMENT_IMPORT.md` for the import contract and source-priority policy.
