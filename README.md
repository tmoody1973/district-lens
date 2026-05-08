# DistrictLens Claude Code Build Package

**DistrictLens** is a nonpartisan civic intelligence agent for the 2026 midterm cycle. It helps voters, journalists, students, and civic organizations understand a congressional race by connecting **who is running**, **who funds the race**, **what incumbents have done in Congress**, **what candidates say they support**, and **how district context shapes the race**.

> **Canonical decisions:** [`docs/DECISIONS_LOG.md`](docs/DECISIONS_LOG.md) is the single source of truth for stack, models, partner integrations, and CI/CD choices. When older planning docs in this package conflict with `DECISIONS_LOG.md`, the log wins. Built by Tarik Moody — see [`docs/MAINTAINER_DISCLOSURE.md`](docs/MAINTAINER_DISCLOSURE.md). Apache 2.0.

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
| `specs/MCP_INTEGRATION.md` | Partner MCP integration specification (MongoDB MCP Server, stdio child of the Python ADK process). Carries a cascade banner pointing to `DECISIONS_LOG.md` for any Elastic references that predate the locked decision. |
| `specs/TOOLS.md` | Tool contracts for FEC, Congress.gov, source discovery (Gemini grounding), source retrieval, extraction, and MongoDB. Carries the same cascade banner. |
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
| FEC OpenFEC API | `FEC_API_KEY` | Bulk-import seed data (free FEC bulk files; no API quota) plus live refresh for selected detailed filings. |
| Congress.gov API | `CONGRESS_API_KEY` | Bulk-import seed data plus live refresh for incumbent members, sponsored/cosponsored legislation, bill summaries, subjects, related bills, laws, and votes. |
| Geocod.io API | `GEOCODIO_API_KEY` | Address or coordinate lookup with compound `cd120,cd` field append for 2026 election boundaries plus current 119th Congress fallback. |
| Gemini 3.1 (Pro + Flash-Lite) | `GEMINI_API_KEY` (or Vertex AI ADC via `GOOGLE_GENAI_USE_VERTEXAI=true`) | Agent reasoning + answer composition (`gemini-3.1-pro-preview`), claim extraction + civic-safety output classifier (`gemini-3.1-flash-lite`), and **built-in Google Search grounding** for source discovery. Replaces OpenAI. Locked per the Google Cloud Rapid Agent Hackathon's Gemini requirement. See [`docs/DECISIONS_LOG.md`](docs/DECISIONS_LOG.md) §3.3, §3.4. |
| MongoDB Atlas | `MONGODB_URI` | **Sole** operational data layer: bulk-imported civic memory, Atlas Search + Atlas Vector Search retrieval, evidence + claim + freshness stores, brief cache, optional saved-user artifacts. Surfaced through the MongoDB MCP Server (locked partner integration). Replaces Elastic. |
| Clerk | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Optional sign-in for saved districts, saved briefs, user preferences, correction submissions, and protected admin workflows. |
| Address-privacy salt | `ADDRESS_HASH_SALT` | Server-side salt for SHA-256 hashing of normalized addresses; never rotated during the demo window. See [`docs/PRIVACY_POLICY.md`](docs/PRIVACY_POLICY.md). |
| Internal API token | `INTERNAL_API_TOKEN` | Shared bearer token used by the Next.js web service to call the Python ADK agent service over Cloud Run internal ingress. |
| Upstash Redis | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Public-agent rate limiting in the Next.js API route. |

> **Dropped from MVP, post-MVP only:** Elastic (replaced by MongoDB Atlas Search + Vector Search), OpenAI (replaced by Gemini 3.1 family), and Perplexity Search API (federal-MVP source discovery now uses Gemini built-in Google Search grounding; Perplexity is reserved for post-MVP local-race extraction with TabStack). The corresponding env vars are documented in `.env.example` under a commented "Post-MVP only" block.

## Build stack (locked)

DistrictLens ships as a monorepo with two Cloud Run services: a Python ADK agent (`agent/`, scaffolded from Google Agents CLI) and a TypeScript Next.js 15 web app (`web/`). MongoDB is the only partner integration. See [`docs/DECISIONS_LOG.md`](docs/DECISIONS_LOG.md) for full rationale.

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 15 (TypeScript) with OSS HeroUI (`@heroui/react`, MIT) and a custom Civic Brutal Tailwind theme. CopilotKit for the agent panel and typed generative UI. | Mature React ecosystem; HeroUI Pro was dropped because its source can't ship in a public Apache 2.0 repo. |
| Backend | Python ADK agent in `agent/app/`, FastAPI server, `agents-cli scaffold` template `adk`. | Scaffold is the documented Gemini-Enterprise path; FastAPI is the AG-UI surface that CopilotKit talks to. |
| Models | Gemini 3.1 Pro for reasoning (`gemini-3.1-pro-preview`); Gemini 3.1 Flash-Lite for extraction + output classifier. | Hackathon mandates Gemini; ADK is Gemini-native; Flash-Lite is cheapest at high volume. |
| Source discovery | Gemini built-in Google Search grounding behind a `SourceDiscoveryProvider` interface. | In-stack, free with the Gemini call, one less vendor. Perplexity is post-MVP for local-race extraction. |
| Embeddings | Google embedding model, manually generated and stored on `claim_embedding`; queried via Atlas Vector Search `$vectorSearch`. | All-Gemini story. |
| Required partner MCP | MongoDB MCP Server (stdio child of the Python ADK process) for race lookup, finance retrieval, freshness inspection, issue evidence search, source-document storage, refresh-result persistence, brief cache. | Single visible MCP boundary for the hackathon partner integration. |
| Storage | MongoDB Atlas (M0 free during build, M10 for the hackathon demo week, drop back after). Atlas Search + Atlas Vector Search handle all retrieval. | Drops Elastic entirely. |
| Streaming + auth | CopilotKit (Next.js) → `/api/agent/ask` (Next.js API route, Clerk + Upstash rate limit) → Python ADK over AG-UI with internal-only ingress. | Clerk JS is mature; ADK runs cleanly behind internal ingress. |
| Deployment | Google Cloud Run for both services in `us-central1`, using the auto-generated `*.run.app` URL for the hackathon demo (no custom domain). GitHub Actions with Workload Identity Federation (no service-account JSON keys). Apache 2.0 LICENSE + NOTICE at repo root. | Hackathon-friendly, judge-readable CI config; `us-central1` reaches Vertex AI feature parity first. |

## Primary Build Path: Google Agents CLI

DistrictLens uses **Google Agents CLI** as the implementation scaffold. The agent project at `agent/` was created via `agents-cli scaffold create districtlens-agent -a adk -d cloud_run --cicd-runner github_actions`. Claude Code's job is to implement the FEC bulk imports, Congress.gov enrichment, source discovery via Gemini grounding, MongoDB MCP-backed retrieval, claim extraction, and the layered civic-safety refusal architecture (already wired as ADK before/after-model callbacks at `agent/app/middleware/`), then run Tier 1 + Tier 2 evals and deploy via Cloud Run.

Read `docs/AGENTS_CLI_IMPLEMENTATION.md` immediately after the hackathon requirements and technical architecture documents. The Google Cloud Agent Starter Pack remains useful as a reference architecture, but Agents CLI is the most concrete Claude Code execution path.

## State and local election extension

DistrictLens now intentionally **defers governor, state senate, state house, county, municipal, school-board, judicial, and ballot-measure race coverage until post-MVP**. See `docs/MVP_SCOPE_DECISION.md` and `docs/STATE_LOCAL_ELECTION_STRATEGY.md`. The hackathon build focuses on congressional district intelligence, federal candidate comparison, FEC finance, Congress.gov incumbent context, source-backed issue evidence, MongoDB civic memory, CopilotKit, and OSS HeroUI with a Civic Brutal Tailwind theme.

## Frontend design-system decision

DistrictLens uses **OSS HeroUI** (`@heroui/react`, MIT) with a custom **Civic Brutal** Tailwind theme for the deterministic dashboard UI, alongside **CopilotKit** for the right-side agent panel and typed generative UI. HeroUI Pro was originally proposed but dropped because its source code can't be redistributed in the public Apache 2.0 repo this hackathon submission requires. See [`docs/DECISIONS_LOG.md`](docs/DECISIONS_LOG.md) §1.1; the older `docs/HEROUI_PRO_*.md` decision memos are retained as superseded historical context. `.mcp.example.json` ships only the OSS `@heroui/mcp` and a placeholder MongoDB MCP entry.


### Post-MVP local-race discovery bridge

Perplexity Search API and TabStack are now **deferred**. They remain documented as a future official-source discovery and extraction bridge, but they should not be implemented for the hackathon MVP unless the team has already finished the federal demo and has extra time.


## Legislator Identity Enrichment Import

DistrictLens now includes the `unitedstates/congress-legislators` dataset as a **MongoDB bulk-import enrichment source** for current congressional member identity, official webpages, social media handles, district offices, committee assignments, FEC crosswalk IDs, and photo-resolution metadata. This enrichment layer is intentionally separate from the official legislative-record layer: **Congress.gov/GovInfo/GPO remain authoritative for bills, votes, laws, summaries, and legislative actions**, while FEC remains authoritative for campaign finance. See `docs/LEGISLATOR_ENRICHMENT_IMPORT.md` for the import contract and source-priority policy.
