# DistrictLens

> Your ballot, backed by evidence. Cited, nonpartisan AI briefs for every 2026 congressional race.

**Hackathon:** Google Cloud Rapid Agent Hackathon — MongoDB partner track
**Built by:** Tarik Moody
**Live demo:** https://districtlens-web-adewe5kxtq-uc.a.run.app
**License:** MIT

---

## What it does

You give DistrictLens an address. It resolves your congressional district and builds a brief: who's running, what each candidate has raised and from whom, the incumbent's voting record and sponsored bills, and each candidate's policy positions — with every claim linked to a stored, dated source.

Follow-up questions work in the chat panel. Ask for a candidate's largest donors and the agent calls the live FEC API, deduplicates contributions by name, and renders a card. Ask who you should vote for and it refuses, then offers to compare candidates on any issue you choose.

All civic reads are public — no account required.

---

## Required runtime integrations — confirmed in code

All three are imported and called at runtime. No OpenAI, Anthropic, AWS, or Azure anywhere in the codebase.

| Integration | Runtime file | What it does |
|---|---|---|
| **Gemini 3.1 Pro** (`gemini-3.1-pro-preview`) | `agent/app/agent.py`, `agent/app/services/positions/extract.py` | Chat agent reasoning, answer synthesis, structured position extraction |
| **Gemini 3.5 Flash** + Google Search grounding | `agent/app/services/positions/gemini_ground.py` | Finds candidate positions for low-profile challengers that general search APIs miss |
| **Google ADK** (`google.adk.agents`) | `agent/app/agent.py` | Code-first agent: `DistrictLensRouter(BaseAgent)` dispatches each turn to the deterministic brief pipeline or the chat `Agent` |
| **MongoDB MCP Server** (stdio subprocess) | `agent/app/tools/mongodb_mcp_toolset.py`, `agent/app/tools/mongodb_mcp_query.py` | Spawns `mongodb-mcp-server --readOnly`, makes real MCP tool calls (count, find, aggregate) on every brief — visible in the activity trace |
| **Cloud Run** | `agent/deployment/terraform/single-project/` | Both services run here in `us-central1` with Cloud Scheduler for weekly data refresh |

---

## Stack

| Layer | Technology |
|---|---|
| Agent framework | Google ADK (Gemini agent platform Developer SDK, code-first) |
| LLMs | Gemini 3.1 Pro (reasoning), Gemini 3.5 Flash (grounded evidence search) |
| Partner integration | MongoDB Atlas + MongoDB MCP Server |
| Web app | Next.js 15, CopilotKit AG-UI protocol |
| Generative UI | `useRenderToolCall` cards for finance, donors, Ballotpedia tools |
| Evidence store | Firecrawl (stealth archival) + MongoDB with content hashing |
| Civic data | FEC bulk import + live API, Congress.gov, Geocodio |
| Auth | Clerk — only for saved briefs; all civic reads are public |

---

## Quick start

### Prerequisites

- Python 3.12+ and [uv](https://github.com/astral-sh/uv)
- Node.js 22+ and npm
- Google Cloud project with Vertex AI enabled (`gcloud auth application-default login`)
- MongoDB Atlas cluster (free M0 works)

### Clone and configure

```bash
git clone https://github.com/tmoody1973/district-lens.git
cd district-lens
cp .env.example .env.local
# edit .env.local — see the Environment variables section below
```

### Run the agent (port 8080)

```bash
cd agent
uv sync
uv run fastapi dev app/fast_api_app.py --port 8080
```

### Run the web app (port 3000)

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000 and enter a U.S. address or ZIP code.

### Seed civic data (one-time)

The FEC and Congress.gov data is bulk-imported — it is not fetched live on every request.

```bash
cd agent
# ~3,100 candidates and 470+ races from FEC
uv run python scripts/ingest_fec.py

# Voting records and sponsored bills from Congress.gov
uv run python scripts/ingest_legislators.py
```

Production refresh runs weekly via Cloud Scheduler (`app/jobs/refresh_fec.py`).

---

## Environment variables

| Variable | Required | Where to get it |
|---|---|---|
| `MONGODB_URI` | Yes | MongoDB Atlas → Connect → Drivers |
| `GOOGLE_CLOUD_PROJECT` | Yes | Your GCP project ID |
| `GOOGLE_CLOUD_LOCATION` | Yes | Set to `global` |
| `CONGRESS_API_KEY` | Yes | https://api.data.gov/signup — works on the FEC API too (shared api.data.gov keyspace) |
| `GEOCODIO_API_KEY` | Yes | https://www.geocod.io |
| `PERPLEXITY_API_KEY` | Yes | https://www.perplexity.ai/api — powers recent news and single-issue follow-up questions |
| `INTERNAL_API_TOKEN` | Yes | Any random secret string for web→agent auth |
| `FIRECRAWL_API_KEY` | Optional | https://www.firecrawl.dev — archives cited sources; tool degrades gracefully without it |

Set all secrets via Secret Manager in production (see `agent/deployment/terraform/single-project/service.tf`).

---

## Project structure

```
districtlens/
├── agent/                    # ADK agent service (Python 3.12, FastAPI)
│   ├── app/
│   │   ├── agent.py          # DistrictLensRouter(BaseAgent), chat Agent, ADK App
│   │   ├── tools/            # ADK function tools
│   │   │   ├── mongodb_mcp_toolset.py   # MongoDB MCP stdio subprocess
│   │   │   ├── mongodb_mcp_query.py     # MCP tool calls (count, aggregate)
│   │   │   ├── fec_donors.py            # Live FEC API → donor dedup → cache
│   │   │   └── mongodb_tools.py         # Candidate, finance, legislation tools
│   │   ├── services/
│   │   │   ├── positions/
│   │   │   │   ├── gemini_ground.py     # Gemini 3.5 Flash + Google Search grounding
│   │   │   │   └── research.py          # Broad/deep research pipeline
│   │   │   └── evidence/                # Firecrawl archival, citation store
│   │   ├── jobs/             # Weekly refresh: FEC data, positions, nominees
│   │   ├── middleware/        # Before/after model civic-safety callbacks
│   │   └── prompts/           # civic_safety.md system prompt
│   ├── scripts/               # One-time import and bulk warm scripts
│   ├── tests/                 # pytest: 413 unit + integration tests
│   └── deployment/terraform/  # Cloud Run + Cloud Scheduler IaC
│
├── web/                       # Next.js 15 web app
│   ├── src/
│   │   ├── app/               # App Router pages, CopilotKit API route
│   │   ├── components/
│   │   │   ├── canvas/        # Generative UI: FinanceToolCard, DonorContributionsCard
│   │   │   └── workspace/     # Brief panel, live receipt, Copy/Export/Share actions
│   │   └── lib/               # Tool trace, brief markdown serializer, steps
│   └── (342 tests via vitest)
│
└── docs/                      # DECISIONS_LOG.md, architecture, data strategy, demo script
```

---

## Deploy to Cloud Run

```bash
# Deploy agent (includes --source build via Cloud Build)
gcloud run deploy districtlens-agent \
  --source agent \
  --region us-central1 \
  --project YOUR_PROJECT_ID \
  --timeout 600

# Deploy web
gcloud run deploy districtlens-web \
  --source web \
  --region us-central1 \
  --project YOUR_PROJECT_ID
```

Required environment variables are injected as secrets via Secret Manager. See `agent/deployment/terraform/single-project/service.tf` for the full configuration.

---

## Civic guardrails

Three enforcement layers — all verified by the civic-safety eval suite on every commit:

1. **System prompt** (`agent/app/prompts/civic_safety.md`) — never recommend a vote, never infer positions from donors or party, say so plainly when evidence is missing
2. **Before-model callback** (`agent/app/middleware/`) — inspects input before Gemini sees it
3. **After-model callback** — validates output before it reaches the user

Asking "who should I vote for?" returns a decline and an offer to compare the candidates' own words on any issue — reproducibly, in every environment.

---

## Data sources

| Source | What is stored | Access pattern |
|---|---|---|
| FEC (api.open.fec.gov) | 3,100+ candidates, finance summaries, itemized receipts | Bulk import weekly + live API for donor cards |
| Congress.gov | Voting records (119th Congress), sponsored bills, legislators | Bulk import weekly |
| Geocodio | Address → congressional district (privacy-hashed; raw address never stored) | Live per request |
| Candidate sites + news | Policy positions with citations | Gemini 3.5 Flash + Google Search grounding, cached in MongoDB |
| Ballotpedia (MCP, discovery only) | Candidate profile links | Chat discovery tool — links to primary sources only, never cited directly in briefs |
| Firecrawl | Archived HTML copies of cited pages (content hash + date) | On demand, 7-day TTL |
