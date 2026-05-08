# Agents CLI Implementation Path for DistrictLens

## Purpose

DistrictLens should now treat **Google Agents CLI** as the preferred implementation path for the hackathon build. The previous package already included a Google Cloud agent architecture and the Google Cloud Agent Starter Pack as a reference. This update makes the build path more concrete for Claude Code: scaffold the agent with `agents-cli`, implement the DistrictLens tools inside the generated ADK project, evaluate the agent, and deploy it to Google Cloud.

This document does not replace the Product Requirements Document or the hackathon technical architecture. It gives Claude Code the practical sequence for converting those requirements into a working agent.

## Why Agents CLI Fits DistrictLens

The official `google/agents-cli` README describes the project as **"The CLI and skills for building agents on Gemini Enterprise Agent Platform"** and explains that it works with Claude Code, Gemini CLI, Codex, and other coding agents. It provides project scaffolding, local runs, evaluations, Google Cloud deployment, and Gemini Enterprise publishing workflows.[1] [2]

For DistrictLens, this is especially useful because the hackathon product is not just a web app. It must demonstrate a real agent workflow: tool calls, source retrieval, data-grounded reasoning, MCP-backed partner integration, and an auditable response path. Agents CLI gives Claude Code a Google-native development lifecycle for that agent.

| DistrictLens Need | Agents CLI Fit |
|---|---|
| Create a structured agent project quickly | Use `agents-cli scaffold districtlens-agent`. |
| Implement agent tools | Add ADK tools for FEC, Congress.gov, source discovery, MongoDB MCP, and optional Elastic. |
| Run local agent tests | Use `agents-cli run "prompt"` for smoke tests. |
| Evaluate civic guardrails | Use `agents-cli eval run` with nonpartisanship, citation, and refusal evals. |
| Deploy hackathon demo | Use `agents-cli deploy` or enhance with Cloud Run deployment. |
| Show Google Cloud alignment | Keep Gemini/ADK/Google Cloud deployment visible in the architecture and demo. |

## Recommended Build Sequence

Claude Code should follow this sequence unless the generated scaffold requires minor adaptation.

### Step 1: Install and initialize Agents CLI

```bash
uvx google-agents-cli setup
agents-cli login --status
```

If authentication is not configured, Claude Code should ask the human developer to complete Google Cloud or AI Studio authentication. The build can still proceed locally with environment placeholders.

### Step 2: Scaffold the DistrictLens agent

```bash
agents-cli scaffold districtlens-agent
cd districtlens-agent
agents-cli install
```

The generated project should become the primary implementation workspace. The documentation package should be copied or referenced from a `/docs` directory inside that scaffold.

### Step 3: Implement core DistrictLens tools

Claude Code should implement the following tools in the scaffolded ADK project. Each tool must return structured evidence with source URLs and timestamps rather than only prose.

| Tool | Purpose | Required for MVP |
|---|---|---|
| `import_fec_candidates` | Bulk/selectively import FEC candidate records by cycle, office, state, and district into MongoDB. | Yes |
| `get_races` | Retrieve MongoDB-backed race objects and freshness metadata by cycle, office, state, and district. | Yes |
| `get_candidate_finance` | Retrieve imported candidate committees, receipts, disbursements, cash on hand, debts, and independent expenditures when available. | Yes |
| `refresh_candidate_finance` | Check FEC for newer official finance data and upsert MongoDB when stale or user-requested. | Yes for freshness demo |
| `import_incumbent_record` | Import Congress.gov/GPO-derived member, bill, summary, subject, related bill, law, bill text, and vote records for selected incumbents. | Yes for incumbent races |
| `get_incumbent_record` | Retrieve imported Congress.gov/GPO-derived incumbent context from MongoDB. | Yes for incumbent races |
| `refresh_incumbent_record` | Check Congress.gov/GPO for newer official legislative data and upsert MongoDB when stale or user-requested. | Yes for freshness demo |
| `discover_candidate_sources` | Use a search API such as Perplexity only to discover candidate pages, questionnaires, and issue statements. | Yes for issue claims |
| `extract_issue_claims` | Extract issue-position claims from fetched source pages using the issue-claim schema. | Yes |
| `query_mongodb_context` | Use MongoDB MCP to retrieve cached race, candidate, finance, and issue data through the partner integration. | Yes for partner track |
| `vector_search_issue_claims` | Atlas Vector Search over `claim_embedding` field for semantic retrieval of stored issue claims. | Yes for issue Q&A |

### Step 4: Add a simple web or API surface

The agent can be exposed through a lightweight FastAPI service, a small React interface, or the generated Agents CLI serving pattern if available in the scaffold. The hackathon demo should make the agent workflow visible: a user asks about a race, the agent calls tools, retrieves sources, and returns a cited, nonpartisan brief.

### Step 5: Add evaluations

Claude Code should create evaluation cases for the highest-risk behavior before polishing UI. These cases should test citation discipline, nonpartisanship, refusal to make voting recommendations, and source-grounded issue-position claims.

```bash
agents-cli eval run
```

### Step 6: Deploy

Use the deployment path supported by the scaffold. The preferred hackathon path is:

```bash
agents-cli deploy
```

If additional web hosting is needed, use Cloud Run for the web/API layer while preserving the Agents CLI-created agent project as the core runtime.

## Updated Architecture Decision

DistrictLens should use this hierarchy:

| Layer | Preferred Choice | Rationale |
|---|---|---|
| Agent scaffold | Google Agents CLI | Fastest Google-native path for Claude Code to create and deploy an ADK/Gemini agent. |
| Agent framework | Google ADK via Agents CLI scaffold | Keeps the implementation aligned with Google Cloud agent tooling. |
| Reasoning model | **Gemini 3.1 Pro** (1M context) | Latest as of 2026-05; 3 Pro Preview deprecated 2026-03-09. See [DECISIONS_LOG.md](../docs/DECISIONS_LOG.md) §3.3. |
| Extraction model | **Gemini 3.1 Flash-Lite** ($0.25/$1.50 per 1M tokens) | Cost-efficient for high-volume schema extraction with structured-output mode. |
| Primary partner track | MongoDB MCP (stdio child of ADK process) | Single visible MCP boundary; Atlas Search + Vector Search for retrieval. |
| Embeddings | Gemini embeddings, manually generated | All-Gemini stack story; stored on `claim_embedding` field for `$vectorSearch`. |
| Data import and refresh | FEC bulk files (free, no API key) for candidates/finance summaries; Congress.gov API for legislative drilldowns; `unitedstates/congress-legislators` JSON for member identity | Bulk-everything-cheap, selective-on-deep. See [DECISIONS_LOG.md](../docs/DECISIONS_LOG.md) §3.2. |
| Source discovery | **Gemini built-in Google Search grounding** for MVP. Wrap behind `SourceDiscoveryProvider` interface; Perplexity is post-MVP for local-race extraction only. | In-stack, free with Gemini call, no extra vendor key. |

## Claude Code Instruction

Claude Code must not build DistrictLens as a generic chatbot. It should build a **tool-using civic evidence agent**. The agent should answer only from retrieved or cached evidence, cite sources, and clearly label unknowns.

Before implementation, Claude Code must read these files in order:

1. `docs/HACKATHON_REQUIREMENTS.md`
2. `docs/HACKATHON_TECHNICAL_ARCHITECTURE.md`
3. `docs/AGENTS_CLI_IMPLEMENTATION.md`
4. `specs/MCP_INTEGRATION.md`
5. `docs/PRD.md`
6. `docs/GUARDRAILS.md`
7. `tasks/BUILD_PLAN.md`
8. `tasks/DEVPOST_SUBMISSION_CHECKLIST.md`

## References

[1]: https://github.com/google/agents-cli "google/agents-cli GitHub repository"
[2]: https://raw.githubusercontent.com/google/agents-cli/main/README.md "google/agents-cli README"
