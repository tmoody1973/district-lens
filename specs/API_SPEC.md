# DistrictLens Backend API Specification

This API can be implemented in FastAPI, Express, Next.js route handlers, or another backend framework. The important part is to keep responses typed and citation-aware.

## Authentication and authorization policy

DistrictLens should follow a **public-first Clerk authentication** policy. District lookup, race pages, candidate comparison, finance summaries, evidence viewing, and basic agent answers must remain available without sign-in. Clerk is optional for saved user features and required for protected user-owned workspace routes. Administrative import, live refresh, source discovery, extraction, indexing, and review operations must require a Clerk admin role and/or `ADMIN_API_SECRET`.

| Route class | Access policy | Implementation note |
|---|---|---|
| Public civic reads | Anonymous allowed | Apply rate limits if needed, but do not block the hackathon demo. |
| User workspace routes | Clerk user required | Use `clerk_user_id` as the MongoDB owner key. |
| Correction submission | Clerk preferred or required | Attribute submissions and keep them in review state. |
| Admin operations | Clerk admin role and/or `ADMIN_API_SECRET` required | Protect bulk import, refresh, source fetching, extraction, indexing, and review mutations. |

## Public app endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/races/search?q=` | Resolve a state, district, race key, or candidate name. |
| `POST` | `/api/district/lookup` | Resolve a full address, ZIP code, or coordinate pair into congressional district context using Geocod.io and cached district records. |
| `GET` | `/api/races/{race_key}` | Return MongoDB-backed race profile, candidates, finance snapshot, and source freshness. |
| `GET` | `/api/candidates/{candidate_id}` | Return MongoDB-backed candidate profile, committees, issue claims, sources, incumbent record, and official-data freshness. |
| `GET` | `/api/races/{race_key}/finance` | Return imported FEC-derived finance summaries for all candidates in a race, with `ingested_at`, `last_checked_at`, and `freshness_status`. |
| `GET` | `/api/races/{race_key}/issues?issue_area=` | Return issue claims and evidence for a race. |
| `POST` | `/api/agent/ask` | Answer a user question with citations. |
| `POST` | `/api/ballot/lookup` | **Post-MVP stub only.** Reserved for future federal/state/local ballot lookup; do not implement local-race production behavior for the hackathon. |
| `GET` | `/api/me` | Return the current Clerk-authenticated user profile and saved-feature availability. |
| `GET` | `/api/me/saved-districts` | Return signed-in user saved districts and races. |
| `POST` | `/api/me/saved-districts` | Save a district or race for the current Clerk user. |
| `GET` | `/api/me/saved-briefs` | Return signed-in user saved cited briefs. |
| `POST` | `/api/me/saved-briefs` | Save an agent answer snapshot and citation graph for the current Clerk user. |
| `GET` | `/api/me/agent-threads` | Return signed-in user persisted agent threads if enabled. |
| `POST` | `/api/corrections` | Submit a correction, missing-evidence report, or source suggestion, preferably under a Clerk user identity. |
| `GET` | `/api/elections` | List known election events by state, date, source, and coverage status. |
| `GET` | `/api/contests/{contest_key}` | Return contest details, candidates, ballot items, evidence status, and source freshness. |


## Official data freshness contract

All endpoints returning FEC, Congress.gov, GovInfo/GPO, or Geocod.io-derived records should include a `freshness` object. The object should be stable across public app endpoints, admin import endpoints, refresh endpoints, and agent traces.

| Field | Description |
|---|---|
| `source_system` | `fec`, `congress_gov`, `govinfo_gpo`, `geocodio`, or another configured official source. |
| `source_url` | Official URL or endpoint reference suitable for citation or evidence drawer display. |
| `source_record_id` | Official identifier such as candidate ID, committee ID, Bioguide ID, bill ID, package ID, or vote ID. |
| `import_batch_id` | Batch ID for the bulk/selective import that wrote the record. |
| `ingested_at` | Timestamp when the record was written into MongoDB. |
| `source_updated_at` | Official update timestamp when available. |
| `last_checked_at` | Timestamp of the latest official source check. |
| `stale_after` | Timestamp or duration after which refresh should be considered. |
| `freshness_status` | `fresh`, `stale`, `missing`, `refreshed_live`, or `unknown`. |
| `checksum` | Hash of the normalized payload used to detect changes. |

## Admin or ingestion endpoints

All `/api/admin/*` endpoints must verify a Clerk admin role and/or `ADMIN_API_SECRET` before execution. These endpoints mutate the MongoDB official-data cache and must never be publicly callable.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/admin/import/fec-candidates` | Bulk/selectively import and store the FEC candidate universe for a cycle, office, state, or district. |
| `POST` | `/api/admin/import/fec-finance` | Bulk/selectively import FEC candidate, committee, finance summary, filing, and independent-expenditure records for demo races. |
| `POST` | `/api/admin/import/congress` | Bulk/selectively import Congress.gov/GPO member, bill, summary, subject, related-bill, law, bill-text-link, and House-vote records. |
| `POST` | `/api/admin/refresh/fec` | Refresh one candidate, committee, race, or finance snapshot from FEC when missing, stale, or user-requested; upsert MongoDB. |
| `POST` | `/api/admin/refresh/congress` | Refresh one member, bill, law, or House vote from Congress.gov/GPO when missing, stale, or user-requested; upsert MongoDB. |
| `POST` | `/api/admin/ingest/demo-race` | Ingest one race and seeded sources. |
| `POST` | `/api/admin/sources/discover` | Run search provider for candidate sources. |
| `POST` | `/api/admin/sources/fetch` | Fetch and store source documents. |
| `POST` | `/api/admin/extract/claims` | Extract issue claims from stored documents. |
| `POST` | `/api/admin/index/elastic` | Reindex documents and claims into Elastic. |
| `POST` | `/api/admin/ingest/ballotready` | Ingest and cache BallotReady/CivicEngine current ballot data for a supported address, district, or election date. |
| `POST` | `/api/admin/ingest/ballotpedia-point` | Ingest and cache Ballotpedia point/election-date race, candidate, and ballot-measure data. |
| `POST` | `/api/admin/ingest/google-civic-fallback` | **Post-MVP only.** Keep Google Civic fallback ingestion disabled for the hackathon. |
| `POST` | `/api/admin/ingest/local-official-csv` | **Post-MVP only.** Reserved for curated official local/state ballot files after the hackathon. |
| `POST` | `/api/admin/enrich/openstates-incumbent` | Enrich a state-legislative incumbent with OpenStates people, bills, votes, and committees. |

## `POST /api/agent/ask` request

```json
{
  "question": "Where do candidates in NY-04 stand on housing?",
  "race_key": "2026-H-NY-04",
  "candidate_id": null,
  "persona": "civic_voter"
}
```

## `POST /api/agent/ask` response

```json
{
  "answer": "I found direct housing-related evidence for two candidates...",
  "race_key": "2026-H-NY-04",
  "citations": [
    {
      "source_id": "src_123",
      "title": "Candidate Issues: Housing",
      "url": "https://example.com/issues/housing",
      "source_type": "campaign_site",
      "retrieved_at": "2026-05-07T12:00:00Z"
    }
  ],
  "claim_ids": ["claim_abc"],
  "limitations": ["No direct housing statement was found for Candidate C in indexed sources."]
}
```

## `POST /api/district/lookup` request

Use this endpoint when the user enters a full address, ZIP code, or coordinate pair. For 2026 election workflows, default to `fields=["cd120"]`. Use `cd` or `cd119` only when the product explicitly needs current incumbent context.

```json
{
  "address": "1109 N Highland St, Arlington, VA",
  "coordinates": null,
  "fields": ["cd120"],
  "cycle": 2026,
  "allow_zip_only": true
}
```

## `POST /api/district/lookup` response

```json
{
  "normalized_query": "1109 N Highland St, Arlington, VA",
  "lookup_source": "geocodio",
  "cycle": 2026,
  "boundary_context": "120th Congress / 2027-2029 district preview when available",
  "districts": [
    {
      "office": "house",
      "state": "VA",
      "district_number": 8,
      "district_label": "VA-08",
      "ocd_id": "ocd-division/country:us/state:va/cd:8",
      "congress_number": "120th",
      "proportion": 1.0,
      "is_ambiguous": false
    }
  ],
  "legislators": [],
  "race_key_candidates": ["2026-H-VA-08"],
  "warnings": []
}
```

If the request uses only a ZIP code and Geocod.io returns multiple districts, the API must preserve each district and its `proportion` instead of silently choosing one. The UI should ask the user for a full address when ambiguity is material.

## `POST /api/ballot/lookup` request

Use this endpoint when the user wants to know what is on their ballot, not only which congressional district they live in. Prefer full address input. ZIP-only lookups should return coverage warnings because local, school-board, and precinct-level contests cannot be safely inferred from ZIP alone.

```json
{
  "address": "1109 N Highland St, Arlington, VA",
  "election_id": null,
  "cycle": 2026,
  "include_polling_locations": true,
  "providers": ["geocodio", "ballotready_civicengine", "democracy_works_calendar", "openstates"],
  "allow_curated_fallback": true
}
```

## `POST /api/ballot/lookup` response

```json
{
  "normalized_address": "1109 N Highland St, Arlington, VA 22201",
  "lookup_sources": ["geocodio", "ballotready_civicengine", "democracy_works_calendar"],
  "district_context": {
    "congressional": ["VA-08"],
    "state_senate": ["VA-SD-31"],
    "state_house": ["VA-HD-049"],
    "county": "Arlington County",
    "municipality": "Arlington"
  },
  "election_events": [
    {
      "election_event_id": "ballotready_2026_va_general",
      "name": "Virginia General Election",
      "date": "2026-11-03",
      "source": "ballotready_civicengine",
      "coverage_status": "supported"
    }
  ],
  "contests": [
    {
      "contest_key": "2026-state-governor-VA-00-general",
      "office_name": "Governor",
      "office_level": "state",
      "office_role": "governor",
      "district": null,
      "candidate_ids": ["cand_va_gov_001", "cand_va_gov_002"],
      "is_ballot_measure": false,
      "source_ids": ["ballotready_2026_va_general_contest_1"]
    }
  ],
  "ballot_items": [],
  "polling_locations": [],
  "warnings": ["Coverage depends on supported election data and may be incomplete outside active election windows."]
}
```


## Optional Local Race Discovery Bridge

DistrictLens should **not implement Perplexity + TabStack local-race endpoints for the hackathon MVP**. The following admin endpoints are reserved for post-MVP experimentation and must remain disabled unless explicitly revived later.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/admin/discover/local-races/perplexity` | Search official election-office domains for fresh candidate lists, sample ballots, ballot measures, or filing pages in a resolved jurisdiction. |
| `POST` | `/api/admin/extract/local-races/tabstack` | Extract structured contest, candidate, and ballot-item JSON from a selected official URL using a narrow schema. |
| `POST` | `/api/admin/review/local-race-extraction` | Mark extracted official-source records as reviewed, rejected, or requiring manual correction. |

Perplexity and TabStack records should use source-confidence values such as `official_discovered_unextracted`, `official_extracted_unreviewed`, and `official_curated_verified`. They must never silently overwrite `primary_provider_verified` records.


## Legislator Enrichment Import Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/admin/import/congress-legislators` | `POST` | Clerk admin or `ADMIN_API_SECRET` | Pull current published `unitedstates/congress-legislators` JSON/YAML files, transform them, and upsert member identity enrichment into MongoDB. |
| `/api/admin/import/congress-legislators/status/:import_batch_id` | `GET` | Clerk admin or `ADMIN_API_SECRET` | Return import counts, changed records, skipped records, checksum manifest, unresolved photo IDs, and errors. |
| `/api/legislators/:bioguide_id` | `GET` | Public | Return the MongoDB-cached legislator profile, official webpage, social links, district offices, committee assignments, photo metadata, and source freshness. |

These endpoints must treat `unitedstates/congress-legislators` as an enrichment source. They must not replace Congress.gov/GovInfo/GPO endpoints for official legislative facts or FEC endpoints for finance facts.
