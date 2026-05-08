# DistrictLens Build Plan

> **Canonical decisions:** [`docs/DECISIONS_LOG.md`](../docs/DECISIONS_LOG.md). When this plan and DECISIONS_LOG disagree, the log wins.
> **Last updated:** 2026-05-08
> **Live repo:** https://github.com/tmoody1973-district-lens

## Status legend

- [DONE] Done (in repo)
- [CRITICAL] Critical-path (must-do for hackathon-ready MVP)
- [STRETCH] Stretch (nice-to-have for hackathon)
- [POST-MVP] Post-MVP (deferred per DECISIONS_LOG)

---

## [DONE] Section 1: Already in the repo

These items are committed and don't need to be redone.

| Item | Location | Reference |
|---|---|---|
| Apache 2.0 LICENSE + NOTICE at repo root | `LICENSE`, `NOTICE` | DECISIONS_LOG §4.5 |
| Public GitHub repo with Apache 2.0 detected | tmoody1973/district-lens | DECISIONS_LOG §4.5 |
| Canonical decisions doc | `docs/DECISIONS_LOG.md` | (this is it) |
| Maintainer COI disclosure | `docs/MAINTAINER_DISCLOSURE.md` | DECISIONS_LOG §4.4 |
| Public-facing privacy policy | `docs/PRIVACY_POLICY.md` | DECISIONS_LOG §4.3 |
| Refusal-architecture explainer | `docs/REFUSAL_DESIGN.md` | DECISIONS_LOG §4.1 |
| Demo video shot list (9 beats, 180s) | `docs/DEMO_VIDEO_SHOTLIST.md` | DECISIONS_LOG §5.3 |
| README aligned with locked decisions | `README.md` | All §§ |
| Google Agents CLI scaffold (ADK template) | `agent/` | DECISIONS_LOG §2.1 |
| Civic-safety system prompt (Layer 1) | `agent/app/prompts/civic_safety.md` | DECISIONS_LOG §4.1 |
| Refusal middleware as ADK callbacks (Layers 2 + 3, fail-secure) | `agent/app/middleware/` | DECISIONS_LOG §4.1 |
| Agent wired with `before_model_callback` + `after_model_callback` | `agent/app/agent.py` | DECISIONS_LOG §4.1 |
| Tier 1 civic-safety evals (10 blocking cases) | `agent/tests/eval/evalsets/tier1_civic_safety.evalset.json` | DECISIONS_LOG §4.2 |
| Tier 2 advisory evals (8 cases) | `agent/tests/eval/evalsets/tier2_advisory.evalset.json` | DECISIONS_LOG §4.2 |
| Eval rubrics (3 criteria, 14 sub-rubrics) | `agent/tests/eval/eval_config.json` | DECISIONS_LOG §4.2 |
| GitHub Actions PR checks (lint, unit-tests, evalset-validity) | `.github/workflows/pr_checks.yaml` | DECISIONS_LOG §2.5 |
| Monorepo dirs (`agent/`, `web/`, `infra/`, `scripts/`) | repo root | DECISIONS_LOG §2.1 |
| Multi-stage Dockerfile + uv.lock | `agent/Dockerfile`, `agent/uv.lock` | scaffold |
| Cloud Run deployment terraform (cicd/, single-project/) | `agent/deployment/terraform/` | scaffold |
| Project memory: stack decisions canonical + README sync feedback | `~/.claude/projects/.../memory/` | (operator-only) |

---

## [CRITICAL] Section 2: Critical path to demo-ready MVP

Phases ordered by dependency. Each task carries an ID, an acceptance criterion, a DECISIONS_LOG reference, and a dependency list.

### Phase A: Foundation infrastructure (mostly manual, parallel-safe)

> **Quality gates:** Eng review — skip (manual setup, no architecture decisions). Refactor pass — skip (no code being written).
>
> **Region (locked):** `us-central1` per DECISIONS_LOG §2.7. All Phase A resources land here: Cloud Run services, Atlas cluster, Artifact Registry, Vertex AI calls. Same-region Atlas keeps cluster latency to single-digit ms.
>
> **Demo URL (locked):** Auto-generated Cloud Run `*.run.app` URL per DECISIONS_LOG §5.7. No custom domain mapping during the hackathon. Phase L uses whatever URL Cloud Run hands back.

| ID | Task | Acceptance | Ref | Depends |
|---|---|---|---|---|
| A1 | Create / select GCP project for DistrictLens | `gcloud projects describe <id>` succeeds; billing linked | §2.5 | — |
| A2 | Create MongoDB Atlas M0 free cluster in `us-central1` | Connection string in hand; `mongosh` connects; cluster region matches `us-central1` | §2.6, §2.7 | — |
| A3 | Obtain Geocod.io API key | Key stored locally; pay-as-you-go tier confirmed (2,500 free/day) | §3.5 | — |
| A4 | Obtain Gemini API key (or set up Vertex AI ADC) | `GEMINI_API_KEY` set OR `gcloud auth application-default login` complete | §3.3 | A1 |
| A5 | Run agent/deployment/terraform/cicd to bootstrap WIF + service accounts + Artifact Registry | `terraform apply` clean; outputs printed | §2.5 | A1 |
| A6 | Configure GitHub repo vars + secrets for CI/CD | `GCP_PROJECT_NUMBER`, `CICD_PROJECT_ID`, `STAGING_PROJECT_ID`, `PROD_PROJECT_ID`, `REGION`, `ARTIFACT_REGISTRY_REPO_NAME`, `CONTAINER_NAME`, `LOGS_BUCKET_NAME_STAGING` set; `WIF_POOL_ID`, `WIF_PROVIDER_ID`, `GCP_SERVICE_ACCOUNT` secret-set | §2.5 | A5 |
| A7 | Populate `agent/app/.env` for local dev with all required keys | `cd agent && uv run python -c "from app.agent import root_agent"` succeeds with all env values set | §2.4 | A2, A3, A4 |

#### Phase A learning notes (MongoDB)

**What Atlas is.** Atlas is MongoDB's hosted-database product. You sign up, click "Create Cluster," pick a region, and within a couple of minutes you have a running database accessible over the internet. Think of it the way GitHub hosts git: the database engine is open-source software, but Atlas runs it for you so you don't have to operate servers, take backups, or patch security.

**M0 vs M10 vs production tiers.** M0 is the free shared-tenancy tier — your data lives on a server that hosts other free-tier users too, capped at 512 MB. Fine for development; not great for demos because shared tenancy means unpredictable latency. M10 is the smallest dedicated tier (~$60/month if billed monthly, prorated by the hour). For DistrictLens we use M0 during build and bump to M10 only for the demo recording window per DECISIONS_LOG §2.6.

**The connection string.** `MONGODB_URI` is a URI that looks like `mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/districtlens?retryWrites=true&w=majority`. The `+srv` part means "look up the cluster's actual servers via DNS SRV records" — Atlas uses this so it can move your cluster around without breaking your code. The `districtlens` after the `/` is the database name; Atlas creates databases lazily when you first write to them.

**`mongosh`.** The official MongoDB shell. Run `mongosh "$MONGODB_URI"` and you get an interactive REPL where you can type queries against your cluster. This is the database equivalent of `psql` for Postgres. Useful for ad-hoc inspection: `db.candidates.findOne()` shows you one candidate document.

---

### Phase B: First real agent tool — Geocod.io district lookup

> **Quality gates:** `/plan-eng-review` before B1 (API contract, error model, caching strategy, ZIP ambiguity flow, address-hash invalidation are real design choices). `/simplify` after B6 (catches framework-fit issues — recall how it caught the ADK callback pattern). `/clean-code-review` before merge (apply clean-code patterns from CLAUDE.md to the first new module).

| ID | Task | Acceptance | Ref | Depends |
|---|---|---|---|---|
| B1 | Replace `lookup_district_placeholder` with a real `resolve_district_by_address` tool | Tool returns `{race_key, boundary_source, returned_districts, proportion}` for a known full address | §3.5 | A3, A7 |
| B2 | Compound `cd120,cd` Geocod.io request with `cd` fallback | Test: a state where cd120 is empty falls back to cd; tag `boundary_source` accordingly | §3.5 | B1 |
| B3 | Address normalization + salt-hash + truncated lat/lng (privacy R1–R6) | `lookup_hash` deterministic across normalized input; raw address never leaves the function | §4.3 | B1 |
| B4 | ZIP-only ambiguity detection | When a ZIP touches >1 district, tool returns all districts with proportions; UI prompts for full address | §3.5 | B1 |
| B5 | `district_lookups` MongoDB collection schema + idempotent upsert | Repeated calls with the same lookup_hash + field_set + cycle update `last_checked_at` only | §4.3 | A2, B3 |
| B6 | Unit tests for `resolve_district_by_address` | `pytest agent/tests/unit/test_district_resolver.py` runs ≥6 tests covering full-address, ZIP-only, coordinate-only, empty cd120, no API key, and rate-limit cases | §4.3 | B1–B5 |
| B7 | Tier 2 eval case `t2_06_zip_only_ambiguity_prompt` passes | `agents-cli eval run --evalset tier2_advisory --case t2_06_zip_only_ambiguity_prompt` reports pass | §4.2 | B4 |

#### Phase B learning notes (MongoDB)

**Your first collection.** B5 creates the `district_lookups` collection. In MongoDB, a "collection" is the rough equivalent of a SQL table — it holds documents (JSON-like records). You don't define a schema up front the way you do in Postgres. The first time your code writes a document with a particular shape, the collection accepts it. Schema discipline is your job, not MongoDB's. We enforce it with code-side validation and (in production) Atlas Schema Validation rules.

**Documents look like JSON.** A `district_lookups` document for one address resolution might be:
```javascript
{
  _id: ObjectId("..."),
  lookup_hash: "abc123...",       // salted SHA-256 of normalized address
  field_set: ["cd120", "cd"],
  cycle: 2026,
  returned_districts: [{ district: "WI-3", proportion: 1.0 }],
  boundary_source: "cd120",
  retrieved_at: ISODate("2026-05-08T..."),
  truncated_lat: 43.07,
  truncated_lng: -89.40
}
```
The `_id` field is auto-generated unless you set it; everything else is yours.

**"Idempotent upsert."** The phrase looks scary but the idea is simple: "find the document with this key, and if it exists update it, if not insert it." MongoDB's `updateOne` operation supports an `upsert: true` flag that does exactly this. For B5 we want repeated lookups of the same address to update `last_checked_at` rather than create new rows — that's an upsert.

**Why hash addresses.** Per DECISIONS_LOG §4.3, raw addresses never enter the database. We hash the normalized address with a salt held server-side. The `lookup_hash` field is opaque to anyone reading the database; only code with the salt can match a given address back to its hash. This is why B3 lives in the same phase as B5 — privacy is part of the data layer, not a layer added on top.

---

### Phase C: FEC bulk import (national backbone)

> **Quality gates:** `/plan-eng-review` before C1 (schema design + idempotency + freshness pattern affects every later collection). `/simplify` after C5 (catches duplicate parsing logic, repeated date handling, etc.). `/clean-code-review` before merge (the importer is a future template for D and E imports — get the patterns clean now).

| ID | Task | Acceptance | Ref | Depends |
|---|---|---|---|---|
| C1 | Download script for FEC bulk files (`cn.txt`, `cm.txt`, `weball.txt`) | `scripts/import_fec_bulk.py --cycle 2026 --download` writes files to `data/fec/2026/` | §3.2 | A2 |
| C2 | Parse + normalize into `races`, `candidates`, `committees`, `finance_snapshots` collections | All 2026 House+Senate candidates ingested; counts match FEC's published totals within 1% | §3.2 | C1 |
| C3 | `race_key` construction (`{cycle}-{office}-{state}-{district}`) with House/Senate/UNK variants | Unit tests cover House (`2026-H-NY-04`), Senate (`2026-S-TX-00`), unknown district (`2026-H-CA-UNK`) | §3.2 | C2 |
| C4 | Candidate classification (incumbent/challenger/open-seat) from FEC `incumbent_challenge` field | Each candidate has a `classification` field; verified against 5 known races | §3.2 | C2 |
| C5 | Idempotent upsert with `import_batch_id` + freshness fields | Re-running C1+C2 with same files produces zero new docs (only `last_checked_at` updates) | §3.2, §4.3 | C2 |
| C6 | Acceptance demo: any 2026 federal address resolves through B + C to a real candidate list | Pasting any U.S. address renders a real race card with real candidate names from FEC | §3.2 | B1, C2 |

#### Phase C learning notes (MongoDB)

**Multiple collections, joined by foreign keys.** This phase introduces four collections: `races`, `candidates`, `committees`, `finance_snapshots`. They reference each other by ID fields (`fec_candidate_id`, `committee_id`, `race_key`). MongoDB doesn't have foreign-key constraints the way SQL does — it just stores the IDs as strings, and your code is responsible for join consistency. When you query, you can use `$lookup` in an aggregation pipeline (similar to a SQL JOIN) or do two queries from the application. We mostly do two queries because it's simpler.

**Indexes.** Every collection should have indexes on the fields you query by. For `candidates`, that means `fec_candidate_id` (unique), `race_key`, and `state`. Without an index, MongoDB does a "collection scan" which gets slow once you have thousands of docs. Create indexes via the Atlas UI or `db.candidates.createIndex({ race_key: 1 })`. Atlas auto-suggests indexes based on slow queries — useful during development.

**Bulk inserts.** `db.candidates.insertMany([...])` accepts an array of documents and inserts them all in one round-trip. For 5,000 FEC candidates, this is much faster than a loop of `insertOne` calls. The pymongo driver supports the same operation as `collection.insert_many(docs)`. With `ordered=False`, MongoDB continues past errors instead of stopping at the first one — useful for FEC data that occasionally has malformed rows.

**`import_batch_id` and freshness.** Every imported document carries an `import_batch_id` (a UUID per import run) and freshness fields (`ingested_at`, `source_updated_at`, `last_checked_at`, `freshness_status`). This isn't a MongoDB feature — it's a pattern we apply ourselves. The pattern lets you ask "show me all candidates from the latest import" or "find docs that haven't been refreshed in 30 days" via a normal `find` query.

---

### Phase D: unitedstates/congress-legislators import

> **Quality gates:** Eng review — skip (mechanical YAML/JSON import, no architecture decisions). `/simplify` after D4. `/clean-code-review` before merge.

| ID | Task | Acceptance | Ref | Depends |
|---|---|---|---|---|
| D1 | Import `legislators-current.json` into `legislator_profiles` | All 535 current Congress members present, keyed by `bioguide_id` | §3.2 | A2 |
| D2 | Import `legislators-social-media.json`, `legislators-district-offices.json`, `committees-current.json`, `committee-membership-current.json` | Four collections populated and cross-joinable on `bioguide_id` | §3.2 | D1 |
| D3 | Bioguide ↔ FEC crosswalk on `candidates` collection | All FEC candidates whose `name` and `state` match a current legislator carry a `bioguide_id` field | §3.2 | C2, D1 |
| D4 | GPO Pictorial photo URL resolution (incumbents only) | Each incumbent in `legislator_profiles` has a `photo_url` pointing to GPO Pictorial; HEAD-checked | §1.6 | D1 |

#### Phase D learning notes (MongoDB)

**Embedded documents vs separate collections.** D2 stores social accounts, district offices, and committee memberships. You have a design choice: embed them as nested arrays inside `legislator_profiles`, or keep them in separate collections joined by `bioguide_id`. Embedding is faster to read (one query gets everything) but harder to update individually. Separate collections are the SQL-style choice. For DistrictLens we use **separate collections** (`legislator_social_accounts`, `legislator_district_offices`, etc.) because the data updates independently — a social-media handle changes more often than a profile. Rule of thumb: embed when the inner data is read-only with the parent and small (<10 items); separate when either condition fails.

**The `bioguide_id` crosswalk.** D3 adds a `bioguide_id` field to docs in the `candidates` collection. This isn't restructuring data; it's adding one more index-able field that lets us join FEC candidates to congressional members. After D3, a query like `db.candidates.find({ bioguide_id: "N000189" })` works. Crosswalks are a common pattern when integrating multiple authoritative datasets that don't share IDs.

---

### Phase E: Congress.gov enrichment (overnight bulk)

> **Quality gates:** `/plan-eng-review` before E3 (rate-limit strategy + resumable bulk run + error handling for the 6-7 hour overnight job are real design choices). `/simplify` after E3 (catch slow patterns in the hot path of a 27,000-call run). `/clean-code-review` before merge.

| ID | Task | Acceptance | Ref | Depends |
|---|---|---|---|---|
| E1 | Member endpoint client (`/member/{bioguideId}`) | Function returns normalized member record; rate-limited to 5k/hr | §3.2 | A4 |
| E2 | Sponsored/cosponsored legislation + bills/summaries/subjects/votes clients | Each client function returns normalized records with stable IDs | §3.2 | E1 |
| E3 | Bulk run for all 535 current members | `scripts/bulk_congress_enrichment.py` completes overnight (~6–7 hr at 5k req/hr); `legislative_actions` collection populated | §3.2 | E1, E2 |
| E4 | Acceptance: any incumbent in `candidates` returns recent sponsored bills + votes when queried | Live demo: pick a known incumbent, see actual recent sponsored bills | §3.2 | E3 |

#### Phase E learning notes (MongoDB)

**`legislative_actions` collection design.** This is the largest collection by row count — 535 incumbents × maybe 100 sponsored bills × related cosponsors and votes = potentially 50,000+ docs. Design the schema so each row is a single legislative action (one bill sponsorship, one cosponsorship, one vote). That makes filtering by member or by bill easy: `db.legislative_actions.find({ bioguide_id: "N000189", action_type: "sponsored" })`.

**Compound indexes.** When you commonly filter by two fields together, create a single compound index on both. For `legislative_actions`, the most useful index is `{ bioguide_id: 1, action_date: -1 }` — that supports "show recent actions for this member" in milliseconds. The `1` and `-1` are sort orders (ascending/descending). MongoDB can use this index for queries that filter by `bioguide_id` alone too, just not by `action_date` alone.

**Why we run E3 overnight.** Congress.gov has a 5,000 requests/hour rate limit. 535 members × ~50 calls per member = ~27,000 API calls, which is ~5–6 hours of wall-clock time at the rate limit. Running it overnight is the simplest answer. The script should write progress to a `congress_import_progress` collection so a resumable mid-run failure doesn't restart from zero.

---

### Phase F: MongoDB MCP wiring (partner integration)

> **Quality gates:** `/plan-eng-review` before F2 (this is the partner integration story for the hackathon — MCP topology, MCPToolset config, query patterns, index design all matter). `/simplify` after F5 (the F5 audit step IS a refactor pass). `/clean-code-review` before merge.

| ID | Task | Acceptance | Ref | Depends |
|---|---|---|---|---|
| F1 | Add `mongodb-mcp-server` to `agent/Dockerfile` (multi-stage Python + Node) | Container builds; `agent` image contains `npx mongodb-mcp-server` reachable | §2.3 | A2 |
| F2 | Spawn MongoDB MCP as stdio child of ADK process; register MCPToolset on `root_agent` | At agent startup, `root_agent.tools` includes MCP-backed tools (find, search, vector_search, insert_many) | §2.3 | F1 |
| F3 | Atlas Search index on `issue_claims` and `source_documents` | Index built; lexical query against `quote` field returns hits | §3.1 | C2, G3 |
| F4 | Atlas Vector Search index on `claim_embedding` | Index built; `$vectorSearch` query returns top-K claim docs | §2.4, §3.1 | G5 |
| F5 | Replace any direct pymongo calls in `agent/app/` with MCP tool invocations | Audit: zero `pymongo` imports in `agent/app/agent.py`, agent uses MCP exclusively | §2.3 | F2 |

#### Phase F learning notes (MongoDB MCP — read this carefully)

This phase is the partner integration story for the hackathon, so it's worth understanding deeply.

**What MCP is.** Model Context Protocol is a standard, defined by Anthropic in late 2024 and adopted by Google, OpenAI, and others, for connecting AI agents to external tools. Before MCP, every agent framework had its own tool-calling format and you'd write custom integration code per data source. MCP standardizes the contract: a server exposes tools (functions with typed schemas), and any MCP-aware agent can use them. Think of it as USB for AI tools.

**What `mongodb-mcp-server` is.** A Node.js binary published by MongoDB at `mongodb-js/mongodb-mcp-server`. When you run `npx mongodb-mcp-server`, it starts a process that:
1. Reads `MONGODB_URI` from its environment
2. Connects to your Atlas cluster
3. Exposes a set of MCP tools: `find`, `insert-many`, `update`, `delete`, `aggregate`, `search` (Atlas Search), `vectorSearch`, plus management operations (`createIndex`, etc.)
4. Communicates with its parent process over stdio (stdin/stdout) using JSON-RPC

**Why stdio child of ADK.** Per DECISIONS_LOG §2.3, we run mongodb-mcp-server as a stdio child of the Python ADK process (single Cloud Run service). The flow at startup looks like:
1. Cloud Run launches `python -m app` (the agent)
2. Agent's `__init__` calls ADK's MCPToolset with a `command: ["npx", "mongodb-mcp-server"]` configuration
3. ADK forks the Node binary as a child, opens its stdin/stdout pipes
4. ADK queries the child for tool definitions; the child returns its schema
5. ADK registers each tool on `root_agent.tools` so Gemini can call them

The agent now has `mongodb_find`, `mongodb_search`, `mongodb_vectorSearch`, etc. as tools. When Gemini decides to call one, ADK marshals the call over stdio, the child runs the query against Atlas, returns results over stdio, and Gemini sees the result. From Gemini's perspective, it's calling a Python function — but really there's a Node child process and Atlas in the loop.

**Why MCP and not direct pymongo.** Two reasons:
1. **Hackathon judging.** The Rapid Agent Hackathon requires visible partner-MCP integration. "I imported pymongo and called it" is not the partner story; "the agent calls MongoDB-defined MCP tools" is.
2. **Trace visibility.** ADK's tool trace shows MCP calls with names and arg summaries (per the L2 trace decision). When a judge sees `mongodb.find races where race_key=2026-H-NY-04` in the timeline, they're seeing the partner integration in action. Pymongo calls are invisible to the trace.

**Atlas Search vs `find`.** F3 creates an Atlas Search index. Plain `find` is field-equality lookup ("find the doc where `race_key == X`"). Atlas Search is a full-text search index built on Lucene — it tokenizes text, scores by relevance, supports fuzzy matching, weighted fields, autocomplete, etc. For DistrictLens, Atlas Search is what makes "search for issue claims about housing" actually return relevant results, not just docs that contain the word "housing" verbatim.

**Atlas Vector Search vs Atlas Search.** F4 creates a Vector Search index. Atlas Search is for keyword-style queries ("housing"). Vector Search is for semantic queries — you embed both the query and the indexed docs into a vector space, then find the docs whose vectors are closest. So a query like "what do candidates say about reducing carbon emissions" can match a claim that uses different words ("transition to clean energy") because the meanings cluster together in vector space. We embed each `issue_claim` once at extraction time and store the vector in `claim_embedding` (Phase G5). At query time the agent embeds the user's question and runs `$vectorSearch` against the index.

**`$vectorSearch` aggregation stage.** The query syntax looks like:
```javascript
db.issue_claims.aggregate([
  { $vectorSearch: {
      index: "claim_embedding_idx",
      path: "claim_embedding",
      queryVector: [0.012, -0.34, ...],   // 768 floats from Gemini embedding
      numCandidates: 100,                  // ANN search candidates
      limit: 10                            // top-K returned
  }},
  { $project: { _id: 1, quote: 1, source_id: 1, score: { $meta: "vectorSearchScore" } } }
])
```
The MongoDB MCP server exposes this as a `vectorSearch` tool that takes the query embedding + index name and returns ranked docs. ADK exposes that to Gemini as a callable.

**ADK MCPToolset.** Google ADK's wrapper that takes an MCP server config (command + args + env), spawns it, queries its tool list, and registers each as an ADK tool. Configuration roughly:
```python
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StdioServerParameters

mcp = MCPToolset(
    connection_params=StdioServerParameters(
        command="npx",
        args=["-y", "mongodb-mcp-server"],
        env={"MDB_MCP_CONNECTION_STRING": os.environ["MONGODB_URI"]},
    ),
)
agent = Agent(
    name="districtlens_root",
    model=Gemini(model="gemini-3.1-pro-preview"),
    tools=mcp.get_tools(),  # all MongoDB tools auto-registered
    ...
)
```
This pattern replaces our current placeholder tool list. F2 is exactly this swap.

**The "no pymongo in agent code" rule (F5).** Once F2 is wired, we don't import pymongo from `agent/app/agent.py` or its tools. If the agent needs to query Mongo, it calls an MCP tool. Pymongo can still be used in `scripts/` (the bulk importers run as Python scripts, not as agent tools — they're not part of the request path) and in `agent/app/middleware/` if needed for logging, but never as the agent's read path. F5 is an audit, not a refactor.

---

### Phase G: Issue evidence pipeline (per demo race)

> **Quality gates:** `/plan-eng-review` before G2 (source-discovery → fetch → extract → embed pipeline has real failure modes — partial failures, schema drift, embedding versioning, retry policy). `/simplify` after G6 (most engineering-novel phase, deserves a thorough pass). `/clean-code-review` before merge.

| ID | Task | Acceptance | Ref | Depends |
|---|---|---|---|---|
| G1 | Pick specific demo race candidate names (4 slots: Senate + swing-incumbent House + open-seat House + WI-3) | `data/demo_races.json` lists chosen `race_key` and candidate IDs | §5.1 | C6 |
| G2 | Source discovery via Gemini built-in Google Search grounding | Behind `SourceDiscoveryProvider` interface; returns ranked URLs; cached | §3.4 | A4 |
| G3 | Source fetcher + cleaner, store with `content_hash` | Each fetched page produces one `source_documents` row with hash + retrieval timestamp | §3.4 | G2 |
| G4 | Claim extractor (Gemini Flash-Lite, structured output, schema-validated) | Extraction produces JSON validating against `schemas/issue_claim.schema.json`; failures logged not stored | §3.3 | G3 |
| G5 | Embedding generation per claim using Google embedding model | Each `issue_claims` row has `claim_embedding` populated | §2.4 | G4 |
| G6 | Run extraction for 4 demo races across 4 issue areas (housing, healthcare, climate, economy) | ≥3 cited claims per candidate per issue OR explicit "no direct evidence" marker | §5.1 | G1, G2–G5 |
| G7 | Manual challenger photo curation (~8 photos, attribution metadata in `data/photo_attributions.json`) | Each demo challenger has a CC-licensed photo URL with attribution recorded | §1.6 | G1 |

#### Phase G learning notes (MongoDB)

**`source_documents` and `issue_claims` are the agent's read path.** These two collections are what the agent searches at request time. Atlas Search indexes (F3) live on these. Vector Search indexes (F4) live on `issue_claims.claim_embedding`. Bad data here means bad answers.

**Storing embeddings.** G5 generates a Gemini embedding for each claim (768 or 1024 floats depending on model) and stores it as a regular array field on the `issue_claims` doc:
```javascript
{
  claim_id: "...",
  candidate_id: "...",
  issue_area: "housing",
  quote: "I'll fight to expand affordable housing...",
  source_id: "...",
  date: ISODate("2026-04-15"),
  confidence: "medium",
  claim_embedding: [0.012, -0.34, 0.91, ...]  // ~ 768 floats
}
```
Vectors are big — 768 floats × 4 bytes = ~3 KB per doc. For 4 demo races with maybe 50 claims each = 200 docs = ~600 KB of embedding storage. Cheap.

**Why we generate embeddings ourselves vs the MCP auto-embedding feature.** MongoDB MCP's `insertMany` tool can auto-generate Voyage AI embeddings for fields with vector indexes. We don't use that — DECISIONS_LOG §2.4 chose Gemini embeddings for the all-Gemini hackathon story. So we generate the embedding via Vertex AI / Gemini API ourselves and pass the array through MCP's normal `insertMany` (no auto-embed flag).

---

### Phase H: Web app skeleton (Next.js 15)

> **Quality gates:** Eng review — skip (conventional Next.js scaffold, well-trodden patterns). `/simplify` after H6. `/clean-code-review` before merge.

| ID | Task | Acceptance | Ref | Depends |
|---|---|---|---|---|
| H1 | `cd web && pnpm create next-app` (TypeScript, App Router, Tailwind) | `web/package.json` exists; `pnpm dev` serves a Next.js 15 default page | §2.1 | — |
| H2 | OSS HeroUI install (`@heroui/react`) + Civic Brutal Tailwind theme tokens | Theme defines slate/black borders, white panels, civic accent; sample button renders in Brutal style | §1.1 | H1 |
| H3 | CopilotKit install + AG-UI runtime config pointing to `/api/agent/ask` | `<CopilotKit runtimeUrl="/api/agent/ask">` wraps the app; agent panel renders | §2.2 | H1 |
| H4 | `/api/agent/ask` Next.js API route with Upstash rate limit + Clerk optional verification, proxies to ADK | Anonymous request: 30/hr/IP; Clerk-authed request: higher limit; both proxy to internal ADK URL | §2.2, §2.6 | A5 |
| H5 | Three-column layout shell (sidebar, workspace, agent panel) | Responsive layout renders empty workspace and chat panel at 1024px and 320px | §1.2 | H1, H2 |
| H6 | District lookup form + race resolution (calls `/api/district/lookup` → tool B1) | User enters address, hits Lookup, lands on race workspace | §3.5 | B1, H5 |

### Phase I: Race workspace UI

> **Quality gates:** `/plan-eng-review` before I5 (the conflict-evidence bifurcated UI is novel; `/plan-design-review` may also help here). `/simplify` after I6 (multiple components, deduplication patterns likely emerge). `/clean-code-review` before merge.

| ID | Task | Acceptance | Ref | Depends |
|---|---|---|---|---|
| I1 | Race overview card + freshness timestamps from MongoDB docs | Card shows office, district, cycle, candidate count, FEC import timestamp | §1.2 | C2, H5 |
| I2 | Candidate Compare cards (with photos: GPO for incumbents, curated for challengers, SVG initials otherwise) | 2-up or 3-up card grid; finance bars visible | §1.6 | C2, D4, G7 |
| I3 | Money flow charts (receipts, disbursements, cash on hand, debts) | Horizontal bars + KPI cards, each with FEC source link | §1.2 | C2 |
| I4 | Issue evidence drawer (quote, source URL, source type, retrieved date, confidence label) | Click any claim → drawer opens with all metadata visible | §1.2 | G4 |
| I5 | Conflict-evidence bifurcated UI when `issue_claims` for the same `(candidate, issue_area)` disagree | Both claims render side-by-side with "Conflicting evidence" badge; agent prose acknowledges conflict | §1.4 | I4 |
| I6 | Tool trace timeline (L2 trace events streamed from ADK over AG-UI) | Each tool call shows name, arg summary, result summary, latency, status; PII stripped | §5.5 | F2, H3 |

### Phase J: Voter brief generation

> **Quality gates:** `/plan-eng-review` before J1 (composer prompt + structured output schema + civic-safety guards have real design choices). `/simplify` after J3. `/clean-code-review` before merge. Also re-run `Skill("humanizer")` on any default brief copy that ships in the BriefCard component.

| ID | Task | Acceptance | Ref | Depends |
|---|---|---|---|---|
| J1 | `compose_voter_brief` ADK tool with structured-output schema | Tool returns a brief object with race, candidates, finance, legislative record, issue claims, limitations sections | §1.3 | F2, G6 |
| J2 | `BriefCard` typed CopilotKit component renders inline | Click "Generate voter brief" → BriefCard fills workspace with all sections | §1.3 | H3, J1 |
| J3 | Markdown export with citations + mandatory `## Limitations` + non-removable disclaimer | Click "Export" → file `2026-{race_key}-brief-{timestamp}.md` downloads | §1.3 | J2 |
| J4 | `brief_cache` MongoDB collection keyed by `(race_key, issue_filter, version)` | Re-generating same brief returns cached version; version bumps on evidence change | §1.3 | F2 |

#### Phase J learning notes (MongoDB)

**`brief_cache` is a TTL collection candidate.** Briefs go stale when underlying evidence changes. We could expire them on a TTL index — MongoDB lets you create an index with `expireAfterSeconds: 86400` and it auto-deletes docs older than 1 day. For DistrictLens we instead version explicitly: a brief is keyed by `(race_key, issue_filter, version)` where `version` increments when underlying evidence changes. That way we can serve stale briefs intentionally for "show me what we said yesterday" queries.

**Compound unique index.** Create `{ race_key: 1, issue_filter: 1, version: 1 }` as a unique index on `brief_cache`. Two writers trying to insert the same key get a duplicate-key error, which is a useful signal not a problem to suppress.

---

### Phase K: WIF + production CI activation

> **Quality gates:** All — skip. CI activation is mechanical (run terraform + flip workflow flags + set GitHub vars/secrets). No code being written; no review needed.

| ID | Task | Acceptance | Ref | Depends |
|---|---|---|---|---|
| K1 | Re-enable push trigger on `staging.yaml` (uncomment the `on: push:` block) | Push to main triggers staging deploy | §2.5 | A6 |
| K2 | Re-enable `tier1-eval-gate` job in `pr_checks.yaml` (remove `if: false`, add WIF auth step) | PR with a refusal regression fails the gate | §2.5, §4.2 | A6 |
| K3 | First successful staging deploy via GitHub Actions | Cloud Run service URL responds 200; agent answers a known query | §2.5 | K1 |
| K4 | Configure production environment protection rule on GitHub (required reviewer) | Production deploy waits for approval before promotion | §2.5 | K1 |
| K5 | First successful production deploy + hosted URL recorded | URL added to `docs/MAINTAINER_DISCLOSURE.md` and Devpost form | §2.5 | K3 |

### Phase L: Demo prep + recording

> **Quality gates:** All — skip. Demo recording is a production task, not engineering. Use the `DEMO_VIDEO_SHOTLIST` checklist instead.

| ID | Task | Acceptance | Ref | Depends |
|---|---|---|---|---|
| L1 | Run `prepare-demo` workflow (min-instances=1 on web + agent; M10 active) | Both Cloud Run services have `--min-instances=1`; Atlas cluster status `IDLE` on M10 | §2.6 | K3 |
| L2 | 5 public-landmark demo addresses in `data/demo_addresses.json` (one per race + 1 ZIP-only) | All 5 resolve cleanly via Geocod.io to expected race_keys | §5.4 | B1, C6 |
| L3 | Pre-warm cache for all 4 demo races (district lookup, race retrieval, evidence retrieval) | All 4 demo race workspaces render in <500ms from cold-cache flush + warm hit | §5.2 | I1–I4 |
| L4 | Shot-list dry-runs (per beat from DEMO_VIDEO_SHOTLIST) — 2 per live moment | Each live moment confirmed on-tone and within budget | §5.3 | I6, J3 |
| L5 | Record 3–5 takes; cuts between clean takes acceptable | Final 3-min video file produced | §5.3 | L4 |
| L6 | Devpost submission form completed | All required fields filled: title, description, video URL, hosted URL, repo URL, partner track (MongoDB) | §5.3 | K5, L5 |

---

## [STRETCH] Section 3: Stretch (if time permits before submission)

- Humanizer pass on remaining docs (`PRD.md`, `ARCHITECTURE.md`, `HACKATHON_TECHNICAL_ARCHITECTURE.md`)
- Tier 3 eval cases: jailbreak attempts, multi-language refusal beyond Spanish, multi-turn pressure escalation
- Performance tuning: profile `/api/agent/ask` end-to-end latency; aim for p50 < 3s with all 4 demo races warm
- Mobile UI refinement: stack the 3 columns into a tab flow at < 768px
- Accessibility audit: WCAG 2.1 AA on the workspace and the agent panel
- Implement `Skill("simplify")` as a pre-merge git hook for new Python files

---

## [POST-MVP] Section 4: Post-MVP (locked deferrals)

These are recorded in `docs/DECISIONS_LOG.md` as intentionally deferred. Do not implement during the hackathon unless the federal MVP is complete and there is real surplus time.

- **Local + state race coverage** (governor, state senate, state house, county, municipal, school-board, judicial, ballot-measure) — DECISIONS_LOG §1.6, §3.4 anti-decisions
- **Perplexity + TabStack local-race extraction bridge** — `docs/PERPLEXITY_TABSTACK_COMPARISON.md` (relabeled post-MVP)
- **OpenUI dynamic dashboard composition** — `docs/COPILOTKIT_UI_DECISION.md` (CopilotKit chosen instead)
- **Elastic alternate-track retrieval** — replaced by MongoDB Atlas Search + Vector Search per §3.1
- **Full historical congressional data import** — current cycle only for MVP
- **OpenStates state-legislative enrichment** — paired with local-race coverage
- **AP Elections results ingestion** — separates from candidate finance and issue layers
- **Cicero/Melissa officeholder enrichment** — Geocod.io is sufficient for MVP

---

## How to use this plan

1. Read top-to-bottom on first encounter so the dependency graph is in your head.
2. Pick the next [CRITICAL] task whose dependencies are all [DONE] or completed.
3. Read the current phase's "Quality gates" line. It tells you which of the three gates apply: `/plan-eng-review`, `/simplify`, `/clean-code-review`. Skip any gate the phase header explicitly skips; that's intentional.
4. Run the per-feature workflow described in Appendix C (the standard cycle: `/plan-eng-review` → code → `/simplify` → `/clean-code-review` → commit). The BUILD_PLAN is the index; per-feature plans are where architecture conversations happen.
5. When a task ships, mark it [DONE] here and reference the commit SHA.
6. When a decision in this plan and `docs/DECISIONS_LOG.md` disagree, update one of them — don't let drift accumulate.
7. Before ending a session, run `/checkpoint` to save where you stopped. Next session, run `/checkpoint resume` to continue.

## Resolved decisions (2026-05-08)

The four pre-Phase-A open questions are now locked. Cross-references:

- **GCP region:** `us-central1` — DECISIONS_LOG §2.7
- **Atlas region:** `us-central1` (same-region as Cloud Run) — DECISIONS_LOG §2.7
- **Demo URL:** Cloud Run default `*.run.app` URL (no custom domain for hackathon) — DECISIONS_LOG §5.7
- **Phase E scope:** Full bulk for all 535 current Congress members (~6–7 hr overnight at 5k req/hr) — DECISIONS_LOG §3.2; reflected in this plan's Phase E task list

---

## Appendix A: MongoDB primer for new operators

A standalone reference covering the concepts the phases above use. Read this top-to-bottom on first encounter; come back to specific sections as you hit them in tasks.

### A.1 What MongoDB is, in one paragraph

MongoDB is a document database. Where a SQL database stores rows in tables with fixed columns, MongoDB stores **documents** in **collections**. A document is a JSON-like record (technically BSON — binary JSON with extra types like dates and ObjectIds). You can have different shapes in the same collection. There is no `CREATE TABLE`; the first write to a collection creates it. Schemas are conventions you apply through code and validation rules, not contracts the database enforces unless you explicitly turn that on.

This trade-off has costs and benefits:
- **Benefit:** rapid iteration, no migrations for adding optional fields, natural fit for messy real-world data (FEC files have wildly inconsistent schemas across cycles)
- **Cost:** schema drift creeps in unless your code is disciplined; query planning is your job, not the database's

For DistrictLens, the document model fits well because civic data is messy and shapes evolve. The discipline comes from having typed schemas in `schemas/` and validating extracted data before write.

### A.2 Atlas in one paragraph

Atlas is MongoDB Inc.'s managed-database service. You sign up at cloud.mongodb.com, create a cluster (choose tier, region, MongoDB version), wait a few minutes, get a connection string. Atlas handles backups, patching, replication, sharding, monitoring. It's the GitHub-for-databases pattern: the engine is open-source, but Atlas operates it for you.

Atlas has tiers:
- **M0** — free, shared-tenancy, 512 MB. Build phase only.
- **M2 / M5** — shared-tenancy, paid (~$9 / $25 monthly).
- **M10+** — dedicated. M10 is ~$60/month, M20 ~$160, etc. Step changes give you more RAM, storage, vCPUs.

DECISIONS_LOG §2.6 commits us to M0 for build, M10 for the demo recording window only, then drop back.

### A.3 Documents and collections — the concrete examples we use

Here's what the main DistrictLens collections look like as actual documents.

**`races`:**
```javascript
{
  _id: ObjectId("..."),
  race_key: "2026-H-NY-04",
  cycle: 2026,
  office: "H",
  state: "NY",
  district: "04",
  candidates: ["H4NY04123", "H4NY04456"],   // FEC candidate IDs
  source_system: "fec_bulk",
  source_url: "https://www.fec.gov/data/...",
  import_batch_id: "uuid-...",
  ingested_at: ISODate("2026-05-08T..."),
  last_checked_at: ISODate("2026-05-08T..."),
  freshness_status: "fresh"
}
```

**`candidates`:**
```javascript
{
  _id: ObjectId("..."),
  fec_candidate_id: "H4NY04123",
  bioguide_id: "N000189",          // populated in Phase D3 if incumbent
  name: "DOE, JANE",
  party: "DEM",
  state: "NY",
  district: "04",
  office: "H",
  cycle: 2026,
  classification: "incumbent",     // or "challenger" or "open_seat_candidate"
  race_key: "2026-H-NY-04",
  // freshness fields...
}
```

**`finance_snapshots`:**
```javascript
{
  _id: ObjectId("..."),
  candidate_id: "H4NY04123",
  cycle: 2026,
  report_period: "2026-Q2",
  receipts: 1250000.00,
  disbursements: 980000.00,
  cash_on_hand: 270000.00,
  debts: 0.00,
  source_system: "fec_bulk",
  source_url: "https://www.fec.gov/data/...",
  ingested_at: ISODate("..."),
  // freshness fields...
}
```

### A.4 CRUD operations, the four moves

| What | mongosh | pymongo | MongoDB MCP tool |
|---|---|---|---|
| Read one | `db.candidates.findOne({fec_candidate_id: "H4NY04123"})` | `coll.find_one({"fec_candidate_id": "..."})` | `find` with `limit: 1` |
| Read many with filter | `db.candidates.find({state: "NY"}).sort({name: 1})` | `coll.find({"state": "NY"}).sort("name")` | `find` |
| Write one (insert if new, error if duplicate `_id`) | `db.candidates.insertOne({...})` | `coll.insert_one({...})` | `insertOne` |
| Insert if new, update if exists (upsert) | `db.candidates.updateOne({fec_candidate_id: id}, {$set: doc}, {upsert: true})` | `coll.update_one({"fec_candidate_id": id}, {"$set": doc}, upsert=True)` | `updateOne` with `upsert: true` |

**Update operators.** When you write `{$set: {...}}` in an update, you're using a MongoDB update operator. Common ones:
- `$set` — set fields (overwrite)
- `$inc` — increment a number
- `$push` / `$pull` — append/remove array elements
- `$currentDate` — set a field to "now"
- `$setOnInsert` — set only on the insert side of an upsert (great for `created_at`)

### A.5 Indexes, plain English

An index is a sorted lookup table the database maintains so it doesn't have to scan every document for queries. Without an index, finding "candidates in NY" means reading every candidate doc; with `{ state: 1 }` it's an O(log n) jump straight to the right group.

| Index type | What it's for | DistrictLens example |
|---|---|---|
| **Standard B-tree** | Equality + range queries on one or more fields | `{ race_key: 1 }` on `candidates` |
| **Compound** | Filtering by multiple fields together | `{ bioguide_id: 1, action_date: -1 }` on `legislative_actions` |
| **Unique** | Enforces no duplicates | `{ fec_candidate_id: 1 }` unique on `candidates` |
| **TTL** | Auto-deletes docs after N seconds | candidate for `district_lookups` (we don't currently use it) |
| **Atlas Search** | Full-text search (Lucene under the hood) | `quote` field on `issue_claims` |
| **Atlas Vector Search** | Semantic similarity over embedding arrays | `claim_embedding` on `issue_claims` |

**Rule of thumb:** index every field you put in a `find` filter, and every field you sort by. Atlas's Performance Advisor flags missing indexes after running for a while; trust it.

### A.6 Aggregation pipelines

Beyond simple `find`, MongoDB has aggregation pipelines: a sequence of stages that transform documents. Each stage takes input docs and emits output docs. Common stages:

- `$match` — filter (like a `find` filter)
- `$project` — pick / rename / compute fields (like SQL `SELECT col1, col2 AS x`)
- `$group` — group + aggregate (like SQL `GROUP BY`)
- `$lookup` — left-outer-join from another collection (the closest thing to SQL JOIN)
- `$sort`, `$limit`, `$skip` — pagination
- `$search` — Atlas Search query
- `$vectorSearch` — Atlas Vector Search query

Example: total receipts per state for 2026 House candidates:
```javascript
db.finance_snapshots.aggregate([
  { $lookup: { from: "candidates", localField: "candidate_id", foreignField: "fec_candidate_id", as: "candidate" } },
  { $unwind: "$candidate" },
  { $match: { "candidate.cycle": 2026, "candidate.office": "H" } },
  { $group: { _id: "$candidate.state", total_receipts: { $sum: "$receipts" } } },
  { $sort: { total_receipts: -1 } }
])
```
The MongoDB MCP server exposes `aggregate` as a tool, so the agent can call this kind of pipeline too.

### A.7 What MCP is and why it matters

Model Context Protocol is a wire-protocol standard for connecting AI agents to external tools. Each MCP server exposes tools (functions with typed JSON schemas), and any MCP-aware agent client (Claude, ChatGPT, Cursor, Gemini ADK, etc.) can call them.

The win: before MCP, every agent framework reinvented tool integration. With MCP, MongoDB ships one server, and it works everywhere. The agent doesn't need MongoDB-specific code — it just uses the tools the server advertises.

In DistrictLens, the chain is:

```
User input
   ↓
Next.js /api/agent/ask
   ↓
Python ADK process
   ↓ (stdio)
mongodb-mcp-server (Node child)
   ↓ (TCP)
Atlas cluster
```

Each ↓ is a hop with its own latency, but they're all in the same Cloud Run container (except Atlas, which is a few ms away in the same region). End-to-end overhead from MCP ~5–15 ms.

### A.8 Atlas Search, in plain English

Atlas Search is Lucene-as-a-service inside Atlas. You define a search index on specific fields of a collection, and Atlas builds a tokenized inverted index. You query via the `$search` aggregation stage:

```javascript
db.issue_claims.aggregate([
  { $search: {
      index: "issue_claims_text",
      text: { query: "affordable housing", path: ["quote", "summary"] }
  }},
  { $project: { quote: 1, source_id: 1, score: { $meta: "searchScore" } } },
  { $limit: 10 }
])
```

This handles tokenization, stemming, fuzzy matching, etc. Plain `find` with regex would only match literal "affordable" and "housing"; `$search` matches "affordability," "housed," "house," weighted by relevance.

### A.9 Atlas Vector Search, in plain English

Vector Search finds documents whose embedding vector is closest to a query vector. "Closest" usually means cosine similarity — the angle between vectors. Conceptually:

1. At index time, each doc has a `claim_embedding` field — an array of ~768 floats produced by an embedding model. Documents with similar meaning end up at similar positions in this 768-dimensional space.
2. At query time, you embed the user's question with the same model and run `$vectorSearch` to find the docs nearest to the query vector.

This catches semantic similarity that keyword search misses. "Reduce carbon emissions" and "transition to clean energy" share no common keywords but their embeddings are close.

For DistrictLens, this is how the agent answers "what do candidates say about climate" — embed that query, find the nearest 10 issue claims, return them with citations.

### A.10 Operational reminders

- **Always use indexes.** Atlas Performance Advisor will tell you when you're missing one. Listen to it.
- **Never store secrets in documents.** No API keys, no passwords. Connection strings live in env vars.
- **Backup is automatic on M10+.** On M0, treat data as ephemeral. Use `mongodump` if you need to keep something locally.
- **Watch the metrics tab in Atlas.** It tells you what queries are slow and what indexes are unused.
- **`mongosh` is your friend during development.** When something looks off, `mongosh "$MONGODB_URI"` and inspect.

---

## Appendix B: Per-feature quality workflow

The phase headers reference three skills as quality gates. They run at different points in the implementation cycle and catch different things. Use them as a stack, not as alternatives.

### The cycle for a non-trivial feature

```
1. Pick the phase. Read its "Quality gates" line.
2. (If gate says yes) /plan-eng-review on a fresh per-feature implementation spec.
   --> Output: a reviewed plan with architecture, data flow, edge cases, test matrix.
   --> Stop and resolve any concerns the eng review surfaces before coding.
3. Code the feature against the reviewed plan.
4. (If gate says yes) /simplify against the new code.
   --> Output: 3 parallel review agents (reuse, quality, efficiency) with findings.
   --> Fix P0 + P1 findings. Skip false positives, note them as skipped with reason.
5. (If gate says yes) /clean-code-review against the new code.
   --> Output: clean-code patterns review, refactor opportunities, code-smell catches.
   --> Apply the changes. Re-run unit tests after.
6. Commit + push. Mark the phase task [DONE] in this BUILD_PLAN with the commit SHA.
7. (Optional) Run /checkpoint to bookmark progress.
```

### What each gate catches (different from each other)

| Gate | When | What it's good at | What it misses |
|---|---|---|---|
| `/plan-eng-review` | Before coding | Architecture choices, data flow, edge cases, test coverage gaps, performance concerns at the design level | Code-level issues (naming, duplication, idioms) |
| `/simplify` | Immediately after coding (3 parallel agents: reuse, quality, efficiency) | Framework-fit issues (e.g. "this should be an ADK callback"), duplicated logic, hot-path inefficiency, leaky abstractions | Higher-level architecture decisions; clean-code patterns from a handbook |
| `/clean-code-review` | After `/simplify`, before merge | Clean-code handbook patterns, code-smell hunting (god objects, nested conditionals, primitive obsession), refactor opportunities the user's CLAUDE.md Clean Code Standards section calls out | Architecture concerns; performance |

### When to skip

- **Skip `/plan-eng-review`** when the phase is mechanical scaffolding (a YAML/JSON import, a conventional Next.js skeleton, CI activation). The phase header marks these `Eng review — skip`.
- **Skip `/simplify`** rarely. Even mechanical code benefits from a reuse + quality + efficiency review. The only phases that skip it are infra-only phases that produce no code (Phase A, K, L).
- **Skip `/clean-code-review`** for similar phases. It's cheap (~5 min) and the project's CLAUDE.md has a Clean Code Standards section explicitly committed to as non-negotiable defaults — running it enforces those.

### Cost estimate

Per non-trivial feature:

- `/plan-eng-review` — ~5–10 minutes (interactive, with the user)
- code itself — variable (the actual work)
- `/simplify` — ~3–5 minutes (3 review agents in parallel, then fix findings)
- `/clean-code-review` — ~5–10 minutes (review + apply changes)

Quality gates total: ~15–25 minutes per feature on top of the coding time. For a hackathon that ships in ~2 weeks across ~10 non-trivial features, that's ~3–4 hours of quality-gate time. Worth it for code that judges and journalists will scrutinize in a public Apache 2.0 repo.

### Refactoring is part of the feature, not a separate phase

There is no "Phase R: refactor" in this plan. Refactoring happens **within** the feature cycle above — `/simplify` and `/clean-code-review` produce findings, and you fix them before commit. The Boy Scout Rule from the project's CLAUDE.md Clean Code Standards (`Leave every file cleaner than you found it`) applies to every PR. If you find yourself wanting to "come back later and refactor," that's a signal to do it now, in this PR, before merge.

The exception is when a future feature reveals that an earlier feature's design was wrong — in that case, refactor as part of the new feature's work, not as a standalone refactor PR. Refactor PRs that aren't tied to a feature tend to bit-rot.

---

## Appendix C: Where to learn more

- MongoDB official docs: https://www.mongodb.com/docs/
- Atlas Search reference: https://www.mongodb.com/docs/atlas/atlas-search/
- Atlas Vector Search reference: https://www.mongodb.com/docs/atlas/atlas-vector-search/
- mongodb-mcp-server: https://github.com/mongodb-js/mongodb-mcp-server
- Model Context Protocol spec: https://modelcontextprotocol.io/
- ADK MCPToolset docs: https://google.github.io/adk-docs/tools/mcp/
