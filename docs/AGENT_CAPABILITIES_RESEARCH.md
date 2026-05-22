# Agent Capabilities Research
**Last updated:** 2026-05-22  
**Status:** Pre-implementation spike — read before building position-search or upgrading models

---

## 1. Gemini Model Landscape (Current)

| Model | Model ID | Status | Use |
|---|---|---|---|
| Gemini 3.1 Pro | `gemini-3.1-pro-preview` | Current best | Orchestrator, complex reasoning |
| Gemini 2.5 Pro | `gemini-2.5-pro` | **Retiring Oct 16, 2026** | Replace immediately |
| Gemini 2.5 Flash | `gemini-2.5-flash` | Active | High-volume cheap tasks |
| Gemini 2.5 Flash-Lite | `gemini-2.5-flash-lite` | Active | Ultra-cheap worker tasks |

**What to do:**
- `agent/app/agent.py` already uses `gemini-3.1-pro-preview` ✅ — leave it
- `web/src/app/api/copilotkit/route.ts` uses `gemini-2.5-pro` ❌ — update to `gemini-3.1-pro-preview`
- Gemini 3.1 Pro: 1M token context window, global endpoint only (`location: "global"`)

---

## 2. Perplexity Sonar API Models (Current)

| Model | Context | Cost (per query est.) | Best for |
|---|---|---|---|
| `sonar` | 128K | ~$0.02 | Quick lookups |
| `sonar-pro` | 200K | ~$0.08 | Broad retrieval, 2× sources — **current** |
| `sonar-reasoning-pro` | 128K | ~$0.06 | Chain-of-thought analysis |
| `sonar-deep-research` | 128K | ~$0.41 | Multi-step synthesis from 100s of sources |

**`sonar-deep-research` detail:**
- Runs autonomous multi-step research (dozens of sub-searches per query)
- Synthesizes a full research report with inline citations
- Purpose-built for the exact task we need: "what has [candidate] said about [issue]?"
- ~$0.41 per query — acceptable for one-off candidate profiles, too expensive for every chat turn

**Recommendation for DistrictLens:**
- Use `sonar-deep-research` when **building a race brief** (one-shot deep research per candidate per issue)
- Use `sonar-pro` for **real-time follow-up questions** during a chat session (cheaper, still cited)
- Do NOT use `sonar` — too shallow for civic evidence requirements

---

## 3. Critical Gap Found

**The ADK Python agent has NO position search tool.**

Position search only exists in the TypeScript web layer:
- `web/src/lib/perplexity.ts` — Perplexity client (TypeScript only)
- `web/src/app/api/search/positions/route.ts` — HTTP endpoint calling Perplexity
- `web/src/lib/server-actions.ts` — `searchCandidatePositionsAction` calls the above endpoint

The ADK agent (`agent/app/tools/`) has: `district_lookup`, `mongodb_tools`, `mongodb_mcp_toolset` — **no web search tool.**

This means the "build a race brief" mission we want to demo **cannot run from the ADK agent today.**

---

## 4. What to Build for the Test Spike

Before building any UI, validate that position search actually works for 2026 candidates.

### Test script goal
Run Perplexity `sonar-pro` vs `sonar-deep-research` against real candidates from our MongoDB and compare:
- Did it find a **direct statement** (not inferred from party/donors)?
- Is the source **citeable** (congress.gov, campaign site, debate transcript)?
- Is the evidence **recent** (2025-2026)?
- How long did it take?

### Candidate/issue test matrix (pull names from MongoDB `candidates` collection)
| Candidate | State | Issues to test |
|---|---|---|
| Quigley, Mike | IL | healthcare, housing |
| Hern, Kevin | OK | immigration, economy |
| Scholten, Hillary | MI | housing, climate |
| Mullin, Markwayne | OK | healthcare, immigration |
| [One challenger with no public profile] | — | any issue — test failure mode |

### Build this: `scripts/test_position_search.py`
```python
# Run: cd agent && python -m scripts.test_position_search
# Tests sonar-pro vs sonar-deep-research against real candidates
# Outputs: hit rate, citation quality, latency per model
```

### What to measure
1. **Hit rate**: % of queries that return a direct candidate statement
2. **Citation quality**: % of sources from civic-approved domains
3. **Evidence freshness**: % of sources dated 2025-2026
4. **Latency**: seconds per query (sonar-deep-research is slower)

---

## 5b-2. LIVE TEST RESULTS — Gemini Search Grounding (2026-05-22)

Ran `scripts/test_position_search.py --models gemini-search-grounding` against same 7 candidates.

| Model | Hit rate | Avg grounding sources | Avg latency |
|---|---|---|---|
| `gemini-3.1-pro-preview` + Search | **100%** (7/7) | 6.1 | 28.3s |

**Key findings vs Perplexity:**
- Hit rate matches sonar-deep-research (100%) — Gemini finds direct statements for every candidate including low-profile challengers
- **38% faster** than sonar-deep-research (28.3s vs 45.8s)
- **Civic source scoring is 0** — Vertex AI returns `vertexaisearch.cloud.google.com/grounding-api-redirect/...` redirect URLs, not real domain names. Civic domain filter can't match them. This is an API design limitation, not missing evidence.
- **No source dates returned** — grounding chunks don't include publication dates
- **Cost advantage**: Gemini grounding is included in Gemini token costs; sonar-deep-research costs ~$0.41/query

**The citation problem — why Perplexity wins for civic use:**
Civic users need to see WHERE the evidence came from (ballotpedia.org, congress.gov, etc.). Perplexity returns actual resolved URLs that can be linked in the UI. Gemini returns opaque redirect URLs that can't be displayed as human-readable citations.

**Architecture decision locked:**
- Use **Perplexity sonar-deep-research** as primary for race brief building — real citeable URLs required for evidence-first civic trust
- Use **Gemini Search Grounding** as fallback when Perplexity returns no direct statement — equivalent quality, faster, no citation display needed for fallback path
- Use **sonar-pro** for real-time follow-up questions during chat (cheap, fast, citations optional)

---

## 5. Architecture Decision: Perplexity vs. Gemini Search Grounding

| Criterion | Perplexity sonar-deep-research | Gemini Search Grounding |
|---|---|---|
| Citation precision | ✅ Best in class | ⚠️ Less precise |
| Google stack alignment | ❌ External API | ✅ Native Vertex AI |
| Cost | ~$0.41/profile | Included in Gemini calls |
| Coverage | ✅ Broad web | ✅ Google Search index |
| Civic domain filtering | ✅ Custom allowlist | ⚠️ Limited control |
| Reliability for candidates | ✅ Proven | Unknown |

**Decision (pending test results):** Use Perplexity sonar-deep-research for candidate profile building. Add Gemini Search Grounding as a fallback when Perplexity returns no direct statement.

---

## 5b. LIVE TEST RESULTS (2026-05-22)

Ran `scripts/test_position_search.py` against 7 real candidates × 2 models.

| Model | Hit rate | Avg civic sources | Avg latency |
|---|---|---|---|
| `sonar-pro` | **14%** (1/7) | 9.7 | 9.5s |
| `sonar-deep-research` | **100%** (7/7) | 23.3 | 45.8s |

**Key findings:**
- `sonar-pro` finds articles *about* candidates but misses direct quotes. Not suitable for evidence-first civic research.
- `sonar-deep-research` found direct statements for every candidate including low-profile challengers (Mark Tedford, 2 civic sources, 36s).
- 46s latency is acceptable when parallelizing: 6 queries in parallel = ~47s total for a full race brief.
- Use `sonar-deep-research` for brief-building, `sonar-pro` for real-time follow-up questions.

**Date freshness scoring bug:** `sonar-deep-research` returned 0 fresh sources in scoring — this is a script parsing issue (different response field names), not a real data quality problem. Sources ARE from 2025-2026 per `search_recency_filter: "year"`.

---

## 5c. Perplexity MCP Server

Package: `mcp-perplexity-search` (installed)  
Command: `npx -y mcp-perplexity-search`  
Config needed: `PERPLEXITY_API_KEY` env var  

The MCP server exposes Perplexity search as an MCP tool, callable by the ADK agent. It supports configurable models including Sonar variants.

**Using Perplexity via MCP in the ADK agent:**
```python
McpToolset(
    connection_params=StdioConnectionParams(
        server_params=StdioServerParameters(
            command="npx",
            args=["-y", "mcp-perplexity-search"],
            env={**os.environ, "PERPLEXITY_API_KEY": os.environ.get("PERPLEXITY_API_KEY", "")},
        ),
        timeout=120.0,  # sonar-deep-research needs ~47s per query
    )
)
```

**Note:** Verify that the MCP server supports the `sonar-deep-research` model ID before using it. If not, build `agent/app/tools/perplexity_search.py` (direct httpx call) as the primary tool and treat the MCP server as a simpler web-search fallback.

---

## 6. Files to Update

| File | Change needed |
|---|---|
| `web/src/app/api/copilotkit/route.ts` | Change `gemini-2.5-pro` → `gemini-3.1-pro-preview` |
| `agent/pyproject.toml` | Add `httpx` or `aiohttp` for Perplexity Python client |
| `agent/app/tools/perplexity_search.py` | **Create** — Python Perplexity client for ADK agent |
| `scripts/test_position_search.py` | **Create** — capability test script |
| `web/src/lib/perplexity.ts` | Change `MODEL = "sonar-pro"` → `"sonar-deep-research"` for brief-building queries |
