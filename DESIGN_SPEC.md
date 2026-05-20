# DESIGN_SPEC.md — DistrictLens

**Track:** Google Cloud Rapid Agent Hackathon — MongoDB partner track  
**Status:** Locked (see `docs/DECISIONS_LOG.md` for all architectural decisions)  
**Maintainer:** Tarik Moody

---

## Mission

DistrictLens is a nonpartisan civic transparency agent for the 2026 midterm cycle. It helps voters, journalists, educators, and civic organizations understand a congressional race by connecting who is running, who funds the race, what incumbents have done in Congress, and what candidates say they support — all grounded in cited public records.

DistrictLens is **not** a voter-persuasion product. It never recommends whom to vote for. It produces evidence-backed race briefs and refuses to infer candidate positions from party affiliation, donor patterns, or model memory alone.

---

## Users

| User | Primary goal |
|---|---|
| Voter | Understand who is running in their district, compare finance signals, read incumbent record |
| Journalist | Get a fast-start fact brief with FEC figures and Congress.gov citations |
| Civic educator / librarian | Show students how public election data is structured and cited |
| Researcher | Query cross-race finance patterns and legislative records |

---

## Agent Workflow

1. User provides an address, ZIP code, or race key
2. Agent resolves the congressional district (`lookup_district` → Geocod.io)
3. Agent retrieves all 2026 candidates for the race (`get_race_candidates`)
4. Agent retrieves campaign finance totals and PAC/individual splits (`get_race_finance_brief`)
5. Agent retrieves incumbent-sponsored legislation from the 119th Congress (`get_incumbent_legislation`)
6. Agent answers issue-position questions from indexed evidence, citing source + date
7. Agent produces a cited race brief — finance context, incumbent record, and evidence gaps explicitly stated

---

## Tools

### Custom ADK Function Tools

| Tool | Purpose | Source |
|---|---|---|
| `lookup_district` | Resolve address or ZIP to a 2026 congressional district (race key) | Geocod.io API |
| `get_race_candidates` | List all FEC-registered 2026 candidates for a race | MongoDB `candidates` collection |
| `get_race_finance_brief` | One-call race + finance summary for all candidates | MongoDB `candidates` + `finance_summaries` |
| `get_candidate_finance` | Individual/PAC breakdown for a single candidate | MongoDB `finance_summaries` |
| `get_incumbent_legislation` | Recent sponsored bills from the 119th Congress | MongoDB `legislative_actions` |
| `find_candidate` | Look up a 2026 candidate by name and optional state | MongoDB `candidates` (text index) |

### Partner MCP Integration — MongoDB MCP Server

The agent spawns `mongodb-mcp-server` (Node.js) as a stdio subprocess, registered via ADK `McpToolset`. This is the visible partner integration for hackathon judging.

| MCP Tool | Exposed as | Use |
|---|---|---|
| `find` | `mongodbfind` | Direct collection queries |
| `aggregate` | `mongodbaggregate` | Finance rollups, cross-candidate comparisons |
| `count` | `mongodbcount` | Dataset size, coverage checks |
| `listCollections` | `mongodblistCollections` | Schema exploration |
| `listDatabases` | `mongodblistDatabases` | Database verification |

`tool_filter` limits the surface to these 5 tools. `--readOnly` flag prevents any writes through MCP.

---

## Constraints and Approval Boundaries

| Constraint | Enforcement |
|---|---|
| No voting recommendations | Civic safety system prompt (Layer 1) + before-model callback (Layer 2) + after-model callback (Layer 3) |
| No campaign persuasion content | Same three-layer refusal architecture; Tier 1 eval (`no_persuasion_content` rubric) |
| No position inference from donors | Explicit guardrail in system prompt; `no_donor_to_position_inference` eval rubric |
| No position inference from party | `no_party_to_position_inference` eval rubric |
| No position fabrication | Agent must say "I found no direct statement in the indexed sources" when evidence is absent |
| Federal congressional scope only | Agent declines state, local, judicial, and ballot-measure queries |
| No model-memory answers for data | All candidate, finance, and legislation data must come from tool calls, not model recall |
| Read-only MCP | `--readOnly` on mongodb-mcp-server; no writes through MCP surface |

Approval boundaries are passive (no human-in-the-loop required) because DistrictLens produces information artifacts, not actions. The approval model is civic: the agent drafts evidence, the user decides what to do with it.

---

## Success Criteria

| Criterion | Threshold | Eval set |
|---|---|---|
| Civic safety rubrics (no recommendation, no persuasion, no fabrication) | ≥ 0.95 pass rate | `tier1_civic_safety` |
| Tool use quality (calls tools not model memory, freshness-aware) | ≥ 0.80 pass rate | `tier2_advisory` |
| Happy path completes with cited data | ≥ 0.85 pass rate | `happy_path` |
| MongoDB MCP tools called and data cited | ≥ 0.85 pass rate | `mcp_evidence` |
| Graceful degradation on tool failure | ≥ 0.85 pass rate | `tool_failure` |
| Response quality (relevant, neutral tone) | ≥ 0.80 pass rate | `tier2_advisory` |

---

## Architecture

```
User browser
    │
    ▼
Next.js 15 (web/) ── Cloud Run (us-central1)
    │  CopilotKit proxy + Clerk auth (saved features only)
    │
    ▼ internal bearer token
Python ADK agent (agent/) ── Cloud Run (us-central1)
    │  Gemini (gemini-flash-latest)
    │  before_agent_callback: check_input (civic safety Layer 2)
    │  after_agent_callback:  check_output (civic safety Layer 3)
    │
    ├── ADK function tools (district_lookup.py, mongodb_tools.py)
    │       └── MongoDB Atlas M0 (pymongo)
    │
    └── MongoDB MCP toolset (McpToolset → stdio → npx mongodb-mcp-server --readOnly)
            └── MongoDB Atlas M0 (MDB_MCP_CONNECTION_STRING)
```

**Data:** MongoDB Atlas M0 (`districtlens` DB)  
Collections: `candidates` (3,920), `races` (503), `finance_summaries` (2,542), `legislative_actions` (8,373), `legislator_profiles` (536), `ballotpedia_races` (470), `election_dates` (50)

---

## Known Limitations (Non-Goals for MVP)

- **Issue-position evidence:** Indexed evidence (issue claims, candidate statements) is not yet populated. Agent answers issue questions with "no direct statement found."
- **State and local races:** Scope is federal congressional districts only.
- **Real-time FEC data:** Finance data reflects bulk import; live refresh tools not wired in MVP.
- **2026 district boundaries:** Geocod.io `cd120` field provides 2026 boundaries where available; falls back to 119th Congress boundaries.

---

## Reference Samples Used

- `google/adk-samples: deep-search` — iterative research pattern with citations
- `google/adk-samples: safety-plugins` — layered safety callback architecture
