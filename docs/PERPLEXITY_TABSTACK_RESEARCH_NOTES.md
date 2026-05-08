# DistrictLens Research Notes: Perplexity Search API and TabStack for Local Race Discovery

## Purpose

These notes evaluate whether **Perplexity Search API** or **TabStack** should be used to discover or ingest fresh state and local election races for DistrictLens, especially after demoting Google Civic to fallback-only because of stale or incomplete race coverage.

## Perplexity Search API Findings

Source pages reviewed:

1. https://docs.perplexity.ai/guides/search-guide
2. https://docs.perplexity.ai/api-reference/search-post

Perplexity Search API is a **web search and content retrieval API**. Its documentation describes real-time access to ranked web results from a continuously refreshed index, with support for domain filtering, language/region filtering, recency/date filters, multiple query support, and extracted page snippets/content. The API returns structured search results with title, URL, snippet, publication date, and last-updated date where available.

Important details for DistrictLens:

- It can help discover **official county/state/municipal election pages**, candidate filing lists, sample ballots, and local news explainers.
- It supports `search_domain_filter`, which can restrict searches to official domains such as state election sites, county election offices, or municipal clerks.
- It supports recency controls such as `search_recency_filter`, `search_after_date_filter`, and `last_updated_after_filter`, which are useful when trying to avoid stale pages.
- It is not itself an election dataset. It does not guarantee normalized contests, candidate IDs, filing deadlines, ballot-measure fields, or address-to-contest mapping.
- Best fit: **discovery and verification layer**, not primary source of truth.

## TabStack Findings

Source pages reviewed:

1. https://tabstack.ai/features
2. https://docs.tabstack.ai/?utm_source=website&utm_content=header
3. https://docs.tabstack.ai/getting-started/quick-start/index.md
4. https://docs.tabstack.ai/guides/how-to-extract-json/index.md
5. https://docs.tabstack.ai/examples/price-monitor/index.md

The main features page could not be extracted, but the documentation landing page and deeper docs were available. TabStack describes itself as a **web content extraction and transformation toolkit for AI agent builders**, with REST and SDK access. The JSON extraction guide is particularly relevant: it accepts a URL and a JSON schema, fetches the page, analyzes the content, and returns structured JSON matching the provided schema.

Important details for DistrictLens:

- It can turn unstructured official election pages, filing lists, sample ballot pages, and candidate pages into normalized JSON using a schema.
- It supports `nocache: true`, which is important for current election pages.
- It supports effort levels (`min`, `standard`, `max`), with `max` intended for JavaScript-heavy or complex pages.
- It is not a search engine or authoritative election dataset. It requires known URLs or URLs discovered by another mechanism.
- Best fit: **extraction/normalization layer for official pages discovered by Perplexity or curated seed lists**, not primary source of truth.

## Initial Direction

Perplexity and TabStack are complementary. Perplexity can find likely official and recently updated election pages; TabStack can extract structured contest and candidate data from those pages. Neither should replace BallotReady/CivicEngine, Ballotpedia Data API, Democracy Works, AP Elections, or official election-office sources as source-of-truth providers. Their highest-value role is a **freshness and coverage bridge** for local races where commercial APIs are unavailable, delayed, or too expensive for the hackathon MVP.

Recommended working pattern:

`Geocod.io address/district resolution → provider lookup in BallotReady/CivicEngine or Ballotpedia → if no coverage, Perplexity official-domain discovery → TabStack schema extraction from official URLs → human review / source confidence labeling → MongoDB contest cache`

## Risk Notes

The extraction/search approach must have strict guardrails. DistrictLens should never silently present search-discovered or AI-extracted election data as authoritative. Every extracted contest should store the source URL, retrieval timestamp, extraction method, confidence tier, and whether it was reviewed. If a race is ambiguous or unverified, CopilotKit should show a human-in-the-loop review prompt instead of producing a definitive answer.

## Preliminary Recommendation

For the hackathon MVP, do **not** use **Perplexity Search API + TabStack** for local-race discovery or extraction. Preserve the combination as a post-MVP fallback discovery-and-extraction pipeline for selected jurisdictions and long-tail local races. Do **not** use either as the primary election data provider.

Perplexity role: find relevant official, fresh pages.
TabStack role: extract structured JSON from those known pages.
DistrictLens role: validate, label, cache, and display with evidence.


