# MCP Integration Specification for DistrictLens

> **Note:** Some sections superseded by 2026-05-08 grilling decisions. MongoDB MCP is the **only** partner MCP for MVP — Elastic dropped. Runtime: stdio child of Python ADK process (single Cloud Run service). HeroUI Pro MCP references mean OSS HeroUI dev workflow. See [DECISIONS_LOG.md](../docs/DECISIONS_LOG.md) §3.1, §2.3, §1.1.

**Author:** Manus AI  
**Date:** May 07, 2026  
**Default hackathon track:** MongoDB  
**Alternate track:** Elastic

## 1. Purpose

The Rapid Agent Hackathon requires integration with a participating partner’s MCP server. DistrictLens should satisfy this requirement by making the partner MCP server part of the agent’s runtime tool loop. The agent must visibly use MCP-backed tools to retrieve, update, or search civic evidence before it generates an answer.[1]

## 2. Primary MCP choice: MongoDB

MongoDB is the recommended primary track because DistrictLens needs persistent civic memory. The agent must maintain normalized race data, candidate identities, FEC finance snapshots, Congress.gov enrichment, source documents, extracted issue claims, confidence metadata, and cached user-facing briefs. MongoDB’s hackathon resource page positions MongoDB Atlas as a persistent memory layer for AI and agentic workloads and lists MongoDB MCP Server, Atlas Search, Vector Search, aggregations, and data modeling resources.[2]

## 3. Required MCP-backed tools

Claude Code should implement these capabilities either by configuring MongoDB MCP Server directly or by wrapping MongoDB operations behind an agent tool interface that delegates to MCP-compatible database operations.

| Tool name | Purpose | Input schema | Output schema |
|---|---|---|---|
| `mcp_find_race` | Resolve a race from cycle, office, state, district, or candidate name. | `{ cycle, office?, state?, district?, candidate_name? }` | `{ race_key, race, candidates[], freshness }` |
| `mcp_get_candidate_profile` | Retrieve normalized candidate identity, incumbency classification, committees, and links. | `{ candidate_id }` | `{ candidate, committees[], source_refs[] }` |
| `mcp_get_finance_snapshot` | Retrieve FEC-derived finance totals and latest report metadata. | `{ candidate_id, cycle }` | `{ candidate_id, totals, report_period, source_refs[] }` |
| `mcp_search_issue_evidence` | Search issue claims and source documents by race, candidate, and issue. | `{ race_key?, candidate_id?, issue, limit }` | `{ claims[], documents[], confidence_summary }` |
| `mcp_store_source_document` | Store a fetched candidate or civic source document with content hash. | `{ url, source_type, candidate_id?, content, fetched_at }` | `{ source_id, hash, status }` |
| `mcp_store_issue_claim` | Store an extracted candidate issue claim with citation and confidence. | `{ candidate_id, issue, stance, quote, source_id, confidence }` | `{ claim_id, validation_status }` |
| `mcp_get_brief_cache` | Retrieve cached neutral race brief if fresh. | `{ race_key, issue?, version? }` | `{ brief, citations[], generated_at, freshness }` |
| `mcp_store_brief_cache` | Store final generated brief with citation graph. | `{ race_key, issue?, brief, citations, limitations }` | `{ brief_id, stored_at }` |

## 4. Agent tool-use policy

The agent must follow a retrieval-first policy. It may call Gemini for reasoning and final synthesis, but it must not answer factual questions about candidates, issue positions, campaign finance, or congressional actions unless it has retrieved supporting records or explicitly states that evidence is missing.

| Question type | Required MCP/tool calls before answer |
|---|---|
| “Who is running in this race?” | `mcp_find_race` |
| “How much money has Candidate A raised?” | `mcp_get_candidate_profile`, `mcp_get_finance_snapshot` |
| “What does Candidate A support on housing?” | `mcp_search_issue_evidence`; if insufficient, optionally source discovery and extraction. |
| “Compare candidates on health care.” | `mcp_find_race`, `mcp_search_issue_evidence` for each candidate, evidence sufficiency check. |
| “Give me a full race brief.” | Race resolution, finance retrieval, issue evidence search, incumbent enrichment if applicable, answer composition. |

## 5. MCP trace requirements for the demo

The UI or backend logs should expose an activity trace so judges can see the agent working. This trace does not need to expose secrets or raw database credentials. It should show tool names, safe input summaries, result counts, timestamps, and whether the answer used retrieved records.

| Trace event | Example |
|---|---|
| Race resolution | `mcp_find_race returned 1 race and 4 candidates for NY-04, 2026.` |
| Finance retrieval | `mcp_get_finance_snapshot returned latest cached FEC totals for 4 candidates.` |
| Evidence retrieval | `mcp_search_issue_evidence returned 7 claims and 5 source documents for housing.` |
| Missing evidence | `No validated direct quote found for Candidate X on housing.` |
| Answer generation | `Generated neutral brief with 12 citations and 2 limitations.` |

## 6. Alternate Elastic MCP implementation

If the team decides to submit under the Elastic track, the partner integration should make Elastic the core evidence-retrieval system. In that architecture, MongoDB may remain a persistence layer, but the agent’s visible partner MCP calls must use Elastic.

| Elastic-track tool | Purpose |
|---|---|
| `elastic_hybrid_search_evidence` | Retrieve source documents and claims using hybrid lexical/vector search. |
| `elastic_rank_issue_claims` | Rank issue claims by candidate, issue, recency, and source authority. |
| `elastic_find_contradictions` | Surface conflicting evidence across sources for review. |
| `elastic_explain_retrieval` | Show why specific evidence was retrieved for an answer. |

## 7. Implementation notes for Claude Code

Claude Code should build a provider abstraction so the team can switch between MongoDB-primary and Elastic-primary configurations without rewriting the agent. The recommended interface is:

```typescript
export interface CivicMemoryProvider {
  findRace(input: RaceQuery): Promise<RaceResolution>;
  getCandidateProfile(candidateId: string): Promise<CandidateProfile>;
  getFinanceSnapshot(candidateId: string, cycle: number): Promise<FinanceSnapshot>;
  searchIssueEvidence(input: IssueEvidenceQuery): Promise<IssueEvidenceResult>;
  storeSourceDocument(input: SourceDocumentInput): Promise<SourceDocumentResult>;
  storeIssueClaim(input: IssueClaimInput): Promise<IssueClaimResult>;
  getBriefCache(input: BriefCacheQuery): Promise<BriefCacheResult | null>;
  storeBriefCache(input: BriefCacheInput): Promise<BriefCacheResult>;
}
```

For the MVP, it is acceptable to implement the provider using direct SDK calls while leaving an MCP-adapter boundary. However, the final hackathon demo should include at least one actual MCP-backed operation in the agent loop to match the partner requirement.[1]

## 8. References

[1]: https://rapid-agent.devpost.com/ "Google Cloud Rapid Agent Hackathon Overview"  
[2]: https://rapid-agent.devpost.com/details/mongodb-resources "MongoDB Resources for Google Cloud Rapid Agent Hackathon"  
[3]: https://www.mongodb.com/docs/mcp-server/get-started/ "MongoDB MCP Server Documentation"  
[4]: https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/mcp-server "Elastic Agent Builder MCP Server Documentation"

## Development-time UI MCP distinction

HeroUI Pro may be configured as a separate development-time MCP server for Claude Code. This helps the coding assistant inspect `@heroui-pro/react` documentation, theme variants, and CSS details while implementing the frontend. It must not be presented as the hackathon partner-track runtime MCP. The visible partner MCP for the DistrictLens demo remains MongoDB MCP for the primary track, or Elastic MCP for the alternate track.
