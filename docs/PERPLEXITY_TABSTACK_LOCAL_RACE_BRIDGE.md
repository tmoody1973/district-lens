# DistrictLens Adoption Scope: Perplexity Search API and TabStack

**Author:** Manus AI  
**Date:** May 07, 2026  
**Decision:** **Defer until post-MVP** as an optional fallback discovery-and-extraction bridge for local races, not as a source-of-truth provider.

## Recommended role

DistrictLens should use **Perplexity Search API** and **TabStack** as a controlled bridge for long-tail local race coverage. Their job is to help DistrictLens discover and normalize official election-office content when a primary ballot provider is unavailable, stale, or incomplete. They should never silently override licensed ballot-provider records, curated official seed files, or direct official feeds.

Perplexity should perform **official-domain discovery**. Its queries should focus on election-office domains, county and city clerk pages, secretary-of-state candidate filing pages, and sample-ballot systems. TabStack should perform **schema-constrained extraction** from the selected URLs. DistrictLens should then validate, provenance-label, and cache extracted records in MongoDB.

## Runtime placement

The pipeline should sit behind the state/local election layer and should be triggered only when needed.

```text
/api/ballot/lookup
  → normalize address and districts with Geocod.io
  → query BallotReady/CivicEngine or Ballotpedia Data API when available
  → if provider data is missing, stale, or incomplete:
      → run Perplexity official-domain discovery
      → submit selected official URLs to TabStack JSON extraction
      → validate extraction against DistrictLens contest schemas
      → store results with source confidence and review status
      → return results only with coverage warnings unless reviewed
```

## Source-confidence policy

DistrictLens should add explicit confidence states for this pipeline:

| Confidence state | Meaning | UI treatment |
|---|---|---|
| `primary_provider_verified` | Data came from BallotReady/CivicEngine or Ballotpedia and freshness is acceptable. | Display normally with source timestamp. |
| `official_curated_verified` | Data came from a curated official file or manually reviewed official URL. | Display normally with official-source label. |
| `official_extracted_unreviewed` | TabStack extracted data from an official URL, but no human reviewed it. | Display with warning and evidence drawer. |
| `official_discovered_unextracted` | Perplexity found a likely official source, but extraction has not run or passed validation. | Do not show as a contest; offer review action. |
| `fallback_civic` | Google Civic returned representative or voter information. | Label fallback-only; do not imply latest-race coverage. |

## Required implementation guardrails

Every Perplexity-derived search run should store `query`, `search_domain_filter`, `recency_filter`, `result_url`, `title`, `snippet`, `published_date`, `last_updated_date`, `retrieved_at`, and `selected_for_extraction`. Every TabStack extraction should store `source_url`, `schema_name`, `schema_version`, `nocache`, `effort`, `raw_extraction`, `validated_fields`, `validation_errors`, `review_status`, and `reviewed_by` when applicable.

The extraction validator should reject records that lack election date, jurisdiction, office name, candidate or ballot-item title, and source URL. It should also reject pages whose jurisdiction does not match the Geocod.io-resolved state/county/municipality. Candidate identity should remain provisional until matched to a provider ID, state filing ID, curated local ID, or a reviewed official source.

## MVP scope

For the hackathon, **do not build this pipeline**. Preserve the design for post-MVP work only. After the federal MVP is complete, the team can predefine Perplexity query templates and TabStack schemas for selected jurisdictions and show the workflow in CopilotKit as an auditable agent action.

This gives DistrictLens a strong demonstration of freshness and source transparency while avoiding the risk of uncontrolled nationwide scraping.

## Non-goals

This adoption does not make DistrictLens a national local-election crawler. It does not remove the need for BallotReady/CivicEngine, Ballotpedia Data API, or official election sources. It does not allow search results or AI-extracted tables to be presented as final without provenance and confidence labels.

## Environment variables

The package should include placeholders for:

```bash
PERPLEXITY_API_KEY=
PERPLEXITY_SEARCH_MODEL=sonar
PERPLEXITY_LOCAL_RACE_DISCOVERY_ENABLED=false
PERPLEXITY_OFFICIAL_DOMAIN_ONLY=true

TABSTACK_API_KEY=
TABSTACK_LOCAL_EXTRACTION_ENABLED=false
TABSTACK_EXTRACTION_EFFORT=standard
TABSTACK_USE_NOCACHE=true
```

## Final adoption decision

Defer **Perplexity + TabStack** as a post-MVP local-race discovery bridge. The safest future use is a fallback path for official-source discovery and schema-based extraction, with human review and visible confidence labels in the CopilotKit UI.

