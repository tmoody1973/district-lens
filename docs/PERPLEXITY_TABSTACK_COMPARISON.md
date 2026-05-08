# Perplexity Search API and TabStack Fit for DistrictLens Local Races

**Author:** Manus AI  
**Date:** May 07, 2026  
**Decision status:** **Post-MVP only.** Federal-MVP source discovery uses Gemini built-in Google Search grounding (see [DECISIONS_LOG.md](./DECISIONS_LOG.md) §3.4). This document remains valid as the design for a post-hackathon local-race discovery+extraction bridge.

## Executive recommendation

DistrictLens should use **Perplexity Search API and TabStack together** only when primary ballot providers are unavailable, stale, or incomplete. Perplexity is useful for finding fresh official election pages, while TabStack is useful for converting those known pages into structured JSON. Neither product should be treated as a source of truth for local races because neither guarantees address-specific ballot coverage, candidate identity resolution, ballot status, jurisdictional applicability, or legal authority.

The strongest pattern is a guarded fallback flow: **Perplexity discovers recent official pages, TabStack extracts fields from those pages, DistrictLens stores the raw source URL and extraction metadata, and CopilotKit asks for human review when confidence is low**. This can materially improve **post-MVP** local-race coverage without pretending that a search or extraction API is equivalent to BallotReady/CivicEngine, Ballotpedia Data API, Democracy Works, AP Elections, or an official state/county election office.

## Product-role comparison

| Capability | Perplexity Search API | TabStack | DistrictLens implication |
|---|---|---|---|
| Primary election dataset | No. It returns ranked web results and extracted snippets/content. | No. It extracts structured data from a supplied URL. | Neither should be primary for current ballot lookup. |
| Fresh discovery | Strong. It supports real-time search, domain filtering, and recency/date filters. | Weak by itself because it needs known URLs. | Use Perplexity to find official election pages and candidate filing pages. |
| Structured extraction | Moderate. It returns titles, URLs, snippets, dates, and page content, but not a guaranteed election schema. | Strong. It accepts a JSON schema and returns structured data matching that schema. | Use TabStack to normalize official pages into contest/candidate JSON. |
| Official-source targeting | Strong with `search_domain_filter` against state, county, or municipal domains. | Strong if the official URL is already known. | Restrict local-race discovery to official domains where possible. |
| Address-to-ballot mapping | No. | No. | Keep Geocod.io plus ballot providers or curated seed files responsible for jurisdiction matching. |
| Auditability | Good if result URLs, search query, dates, and retrieved snippets are stored. | Good if raw URL, schema, response, timestamp, and extraction version are stored. | Store full provenance and do not overwrite licensed/official data. |
| Hackathon value | High for filling gaps and showing agentic research behavior. | High for turning messy official pages into a usable demo cache. | Use as visible “verify with official sources” capability. |
| Production risk | Medium. Search results can miss pages or rank stale pages. | Medium. AI extraction can misread tables or dynamic pages. | Require review queues and confidence labels. |

## Recommended architecture role

Perplexity and TabStack should become a **Local Race Discovery and Extraction Bridge** inside the state/local layer. This bridge should run only after the first-choice sources fail or need verification.

```text
User address
  → Geocod.io geography and state/local jurisdiction context
  → BallotReady/CivicEngine or Ballotpedia current ballot lookup
  → If unavailable or incomplete:
      → Perplexity official-domain search for state/county/municipal election pages
      → TabStack JSON extraction from selected official URLs
      → DistrictLens normalization into election_events, contests, contest_candidates, ballot_items
      → Source confidence = discovered_official_unreviewed or curated_official_reviewed
      → CopilotKit review prompt if ambiguous
  → MongoDB cache with evidence, source URL, retrieval timestamp, and freshness labels
```

This design keeps the **source-of-truth hierarchy intact**. A search-discovered result can supplement or verify data, but it should not silently outrank a licensed ballot provider or a directly curated official file.

## Guardrails

DistrictLens should enforce strict provenance rules if this pipeline is adopted. Every Perplexity and TabStack-derived record should include the source URL, source domain, search query, retrieval timestamp, extraction schema version, extraction method, cache policy, source confidence, and review status. The UI should show a warning if a result is extracted but not reviewed.

The pipeline should prioritize official domains first. Perplexity queries should restrict results to state election offices, county boards of elections, city clerks, and official sample ballot systems when possible. News, blogs, campaign sites, and advocacy groups can be used only for evidence enrichment, not for creating contests.

TabStack extraction schemas should be narrow and office-specific. A sample-ballot schema should not be reused as a candidate-filing-list schema. The extraction output should be validated before it enters MongoDB, including checks for election date, jurisdiction, office level, candidate name, party/status, source URL, and whether the race applies to the resolved address.

## MVP recommendation

For the hackathon, DistrictLens should **not** add Perplexity + TabStack local-race extraction. The federal MVP is stronger without this scope. Post-MVP, this bridge can become an optional fallback path for selected jurisdictions when commercial ballot data is unavailable, provided that every extraction is reviewed and labeled.

The MVP should not attempt nationwide automated local election scraping. That would create high maintenance risk, inconsistent coverage, and trust problems. The correct hackathon scope is to keep local-race extraction disabled and revisit official-domain search templates and TabStack schemas later.

## Final decision

Use **Perplexity Search API** for **official-source discovery and freshness checks**. Use **TabStack** for **structured extraction from official election pages once URLs are known**. Do not use either as the primary ballot provider. The primary source hierarchy remains BallotReady/CivicEngine or Ballotpedia Data API first, official state/county/municipal sources second, Democracy Works for calendars, AP Elections for results, and Google Civic as fallback-only.

## References

[1]: https://docs.perplexity.ai/guides/search-guide "Perplexity Search API Guide"  
[2]: https://docs.perplexity.ai/api-reference/search-post "Perplexity Search the Web API Reference"  
[3]: https://docs.tabstack.ai/?utm_source=website&utm_content=header "TabStack Documentation Overview"  
[4]: https://docs.tabstack.ai/getting-started/quick-start/index.md "TabStack Quickstart"  
[5]: https://docs.tabstack.ai/guides/how-to-extract-json/index.md "TabStack How to Extract JSON Data"  
[6]: https://docs.tabstack.ai/examples/price-monitor/index.md "TabStack Competitor Pricing Monitor Example"

