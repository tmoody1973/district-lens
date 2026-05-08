# DistrictLens Technical Architecture

## Architecture summary

DistrictLens should be implemented as a web application with a backend agent service. The backend owns data ingestion, source retrieval, extraction, storage, and answer generation. The frontend displays race cards, finance snapshots, issue evidence, and a chat-style civic briefing experience.

```text
User
  → Web UI
  → Backend API / Agent Endpoint
  → Entity Resolver
  → MongoDB Structured Store
  → Elastic Hybrid Search
  → Tool Layer: Bulk Importers, FEC Refresh, Congress.gov/GPO Refresh, Search, Source Fetcher, Claim Extractor
  → Cited Answer Generator
  → Web UI with evidence cards
```

## Major components

| Component | Responsibility |
|---|---|
| Web UI | Race search, candidate cards, finance tables, issue cards, agent chat. |
| Backend API | Provides race, candidate, finance, source, claim, and agent endpoints. |
| FEC import/refresh service | Bulk-imports selected candidates, committees, totals, schedules, and outside-spending context into MongoDB; refreshes official records when missing or stale. |
| Congress/GPO import/refresh service | Imports member data, sponsored legislation, cosponsored legislation, bill subjects, summaries, related bills, laws, bill text links, and House votes into MongoDB; refreshes official records when missing or stale. |
| Source discovery service | Uses Perplexity or another provider to find official campaign pages, questionnaires, and local sources. |
| Source fetcher | Fetches full pages and stores raw text with content hashes. |
| Claim extractor | Extracts issue claims from source documents into validated JSON. |
| MongoDB | Primary app-read layer for bulk-imported official data, normalized entities, source documents, claims, freshness metadata, refresh outputs, optional user-owned saved artifacts, and cached briefs. |
| Elastic | Provides hybrid retrieval across documents, claims, and legislative evidence. |
| Clerk auth | Optional identity layer for saved districts, saved briefs, preferences, user correction submissions, and protected admin operations; public civic reads stay anonymous. |
| Agent orchestrator | Plans retrieval, calls tools, verifies evidence, and writes cited answers. |

## Data flow

The ingestion flow should separate **official structured data imports**, **official live refreshes**, and **unstructured web evidence**. FEC and Congress.gov/GovInfo are authoritative structured sources, but DistrictLens should read from MongoDB first after selective import. Search is used only to discover pages, and the system must fetch and store those pages before citing them.

| Flow | Description |
|---|---|
| Race ingestion | FEC candidates are bulk/selectively imported by cycle and office, grouped into races, classified, given freshness metadata, and stored. |
| Finance ingestion | Candidate committees and financial totals are imported into MongoDB and refreshed from FEC only when missing, stale, or requested. |
| Incumbent enrichment | Congress.gov/GPO-derived records are imported for incumbents and refreshed when missing, stale, or requested. |
| Issue evidence ingestion | Search/manual seed URLs are fetched, cleaned, indexed, and passed through claim extraction. |
| Answer generation | User question is resolved to candidate/race/issue; claims and sources are retrieved; answer is generated with citations. |

## Race key convention

Use deterministic keys so every service can reference the same race.

| Race type | Format | Example |
|---|---|---|
| House | `{cycle}-H-{state}-{district}` | `2026-H-NY-04` |
| Senate | `{cycle}-S-{state}-00` | `2026-S-TX-00` |
| Unknown district | `{cycle}-{office}-{state}-UNK` | `2026-H-CA-UNK` |

## Congress.gov endpoint coverage

When enriching incumbents, include comprehensive endpoint support where possible. The MVP may only implement a subset, but the service should be designed to grow.

| Endpoint family | Use |
|---|---|
| `/member/{bioguideId}/sponsored-legislation` | Shows incumbent bills introduced or sponsored. |
| `/member/{bioguideId}/cosponsored-legislation` | Shows cosponsored bills and policy alignment signals. |
| `/bill/{congress}/{billType}/{billNumber}/subjects` | Tags bills with issue areas. |
| `/bill/{congress}/{billType}/{billNumber}/summaries` | Provides plain-language legislative summaries. |
| `/bill/{congress}/{billType}/{billNumber}/committees` | Shows committee routing and policy domain. |
| `/bill/{congress}/{billType}/{billNumber}/cosponsors` | Supports legislative network analysis. |
| `/bill/{congress}/{billType}/{billNumber}/relatedbills` | Identifies similar or companion bills. |
| `/bill/{congress}/{billType}/{billNumber}/text` | Links to official bill text. |
| `/law/{congress}` and law detail endpoints | Connects bills to enacted laws. |
| `/member/congress/{congress}/{stateCode}/{district}` | Maps district incumbents to member records. |
| `/house-vote/{congress}/{session}/{voteNumber}/members` | Shows recorded vote positions where available. |

## Recommended environment variables

> Updated 2026-05-08 per [DECISIONS_LOG.md](./DECISIONS_LOG.md) §3.1, §3.3, §3.4, §4.3, §2.2: dropped Elastic, OpenAI, and primary-track Perplexity; added Gemini, address-hash salt, internal API token.

```bash
# Civic data sources
FEC_API_KEY=
CONGRESS_API_KEY=
GOVINFO_API_KEY=
GEOCODIO_API_KEY=

# Operational data
MONGODB_URI=
MONGODB_DB=districtlens

# Models (Gemini 3.1 family — see DECISIONS_LOG.md §3.3)
GEMINI_API_KEY=
GOOGLE_GENAI_USE_VERTEXAI=false  # set true if using Vertex AI ADC instead

# Auth
CLERK_SECRET_KEY=
CLERK_PUBLISHABLE_KEY=

# Internal service auth (Next.js → ADK)
INTERNAL_API_TOKEN=

# Privacy salt (never rotate during demo; cache invalidation depends on it)
ADDRESS_HASH_SALT=

# Rate limiting
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Web app
APP_BASE_URL=http://localhost:3000

# Post-MVP only — uncomment when local-race extraction lands
# PERPLEXITY_API_KEY=
# TABSTACK_API_KEY=
```

## Error-handling requirements

The agent should report data limitations clearly. If FEC or Congress.gov is rate-limited, the app should use imported MongoDB records. If Congress.gov has no data for a non-incumbent, the agent should say the candidate has no congressional record in the indexed data. If search results cannot be fetched, the system should store the discovery metadata but avoid using it as evidence.


## Authentication and access control

DistrictLens should use a **public-first access model**. Public users can resolve districts, view race dashboards, compare candidates, inspect source evidence, and ask basic agent questions without login. Clerk authentication is optional for user-owned saved features and required for protected operational workflows.

| Access tier | Capabilities | Implementation rule |
|---|---|---|
| Anonymous public user | District lookup, race dashboard, candidate comparison, finance view, evidence drawer, basic agent Q&A. | Do not require Clerk. Apply rate limits where needed. |
| Signed-in Clerk user | Saved districts, saved briefs, user preferences, persisted agent threads, correction submissions. | Map records to `clerk_user_id` in MongoDB. |
| Admin user | Bulk imports, live refresh administration, source fetching, extraction, indexing, review queues. | Require Clerk admin role and/or server-only admin secret. |

The product must not store raw home addresses as normal user profile data. District lookup caching should use normalized hashes or lookup cache keys and should follow the configured retention policy.
