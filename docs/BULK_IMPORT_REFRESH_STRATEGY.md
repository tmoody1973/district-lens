# DistrictLens Bulk Import and Live Refresh Strategy

**Author:** Manus AI  
**Date:** May 07, 2026  
**Status:** Hackathon MVP architecture decision

## 1. Decision

DistrictLens should use **MongoDB as a bulk-imported civic intelligence cache** for FEC and Congress.gov/GPO-derived data. The application and agent should read from MongoDB first for race pages, candidate profiles, finance summaries, incumbent context, evidence retrieval, and cached briefs. Official APIs should remain available as **refresh tools**, not as the default read path.

This architecture gives the hackathon demo a fast, reliable baseline while preserving the ability to say, “checking the official source for newer data” when a record is missing, stale, or specifically requested by the user. FEC provides public bulk data access and API access for campaign-finance data, while Congress.gov and GovInfo/GPO provide machine-readable legislative data through API and bulk-oriented publication paths.[1] [2] [3]

> **Architecture rule:** DistrictLens reads from MongoDB first, then calls FEC, Congress.gov, or GovInfo/GPO only when the local record is missing, stale, incomplete, or when the user asks for the latest available official information.

## 2. Source-of-truth pattern

The source of truth for civic facts remains the official source system. MongoDB is the **operational source of truth for the application**, meaning it stores normalized copies, provenance, ingestion time, freshness checks, and source URLs. The agent should never treat a cached record as unqualified truth without exposing its source and freshness.

| Data area | MVP baseline | Live refresh role | User-facing label |
|---|---|---|---|
| FEC candidates and committees | Import selected cycle, offices, states, districts, and demo candidates into MongoDB. | Refresh candidate, committee, and totals records when stale or missing. | “FEC-derived record, imported at `{ingested_at}`, checked at `{last_checked_at}`.” |
| FEC finance summaries and filings | Import selected summaries, committee links, and relevant filings for demo races. | Check official API for newer filings, updated totals, or selected filing details. | “Latest cached FEC snapshot; refresh available.” |
| **unitedstates/congress-legislators member enrichment** | Selective bulk import into MongoDB from the published JSON/YAML files. | Use for Bioguide-centered identity, official webpages, social accounts, district offices, committee memberships, FEC crosswalks, and photo resolver metadata. Do not treat it as the official source for bills, votes, laws, or finance. | Refresh through an admin import job when the repository changes or before demos. |
| Congress.gov members and bills | Import current Congress member records, selected sponsored/cosponsored bills, summaries, subjects, and related bill metadata. | Refresh member or bill details when the agent needs current legislative status. | “Congress.gov-derived record with official source link.” |
| GovInfo/GPO bill status, summaries, and text links | Seed bill text/status/summaries where useful for incumbent records and issue evidence. | Use official APIs or downloads to fill missing bill text/status details. | “GovInfo/GPO legislative source.” |
| Agent answers | Retrieve MongoDB records and source documents first. | Trigger official refresh before answering “latest” questions. | “Answered from cached official data plus refreshed source checks where noted.” |

## 3. Freshness metadata contract

Every imported or refreshed official-data document should carry a shared provenance envelope. This makes the data layer auditable and lets the UI display whether a fact is fresh enough for the user’s question.

| Field | Meaning |
|---|---|
| `source_system` | Canonical system name such as `fec`, `congress_gov`, `govinfo_gpo`, or `geocodio`. |
| `source_url` | Human-readable official URL or API endpoint reference. |
| `source_record_id` | Official identifier, such as FEC candidate ID, committee ID, Bioguide ID, bill ID, or package ID. |
| `import_batch_id` | Batch identifier for the bulk import job that created or updated the record. |
| `ingested_at` | Timestamp when DistrictLens wrote the record into MongoDB. |
| `source_updated_at` | Official update timestamp if provided by the source. |
| `last_checked_at` | Timestamp when DistrictLens last checked the official source for updates. |
| `stale_after` | Timestamp or duration used by the agent to decide whether a refresh is required. |
| `freshness_status` | One of `fresh`, `stale`, `missing`, `refreshed_live`, or `unknown`. |
| `checksum` | Hash of the normalized payload or source document to detect changes. |

## 4. Import and refresh jobs

The MVP should implement selective importers rather than a full national warehouse. The importer should seed enough official data to make three to five demo congressional races feel complete, then rely on live refresh tools to update the exact records the user or agent touches.

| Job | Scope | Acceptance criterion |
|---|---|---|
| `import_fec_candidates` | Selected cycle, federal office, optional state/district filters. | Populates `races`, `candidates`, and `committees` with source metadata. |
| `import_fec_finance_snapshots` | Demo race candidates and linked committees. | Populates `finance_summaries` or `finance_snapshots` with timestamps and FEC references. |
| `import_congress_members` | Current Congress, selected states/districts, and incumbent Bioguide IDs. | Populates `member_records` and candidate-to-Bioguide mappings. |
| `import_congress_legislative_records` | Sponsored/cosponsored legislation, bill subjects, summaries, related bills, laws, and House vote details where available. | Populates `legislative_actions` with official source URLs and freshness metadata. |
| `refresh_candidate_finance` | One candidate or race. | Upserts refreshed FEC totals and marks records `refreshed_live`. |
| `refresh_bill_status` | One bill or member legislative record. | Upserts changed bill status/actions and updates `last_checked_at`. |

## 5. Agent behavior

The agent should be **local-first and freshness-aware**. It should query MongoDB through the civic memory layer, inspect freshness metadata, and only call official APIs when needed. Refresh tools should always upsert into MongoDB before the final answer is generated so that live checks improve future app performance.

| User intent | Agent behavior |
|---|---|
| “Who is running in my district?” | Resolve district, query MongoDB race/candidate records, and show cached freshness. |
| “Who funds this race?” | Query MongoDB finance snapshots; refresh FEC if stale or if the user asks for latest filings. |
| “What has the incumbent done on housing?” | Query MongoDB legislative actions and issue claims; refresh Congress.gov/GPO records if stale or missing. |
| “Has anything changed today?” | Call live official refresh tools, upsert MongoDB, then answer with refreshed timestamps. |
| API rate limit or missing key | Fall back to cached MongoDB records and disclose that no live refresh was completed. |

## 6. Hackathon implementation priority

For the hackathon, Claude Code should not build a comprehensive ETL platform. It should build a **selective importer plus refreshable cache**. The demo should show that DistrictLens has fast MongoDB-backed pages and an agent that can run a visible official-data refresh when the judge asks for the latest status.

| Priority | Build item | Reason |
|---|---|---|
| P0 | MongoDB schemas with provenance and freshness fields. | Required for trust and agent grounding. |
| P0 | FEC candidate/committee/finance selective importer. | Core federal race and finance experience. |
| P0 | Congress.gov/GPO incumbent legislative importer. | Core accountability experience for incumbents. |
| P1 | Refresh endpoints and agent tools for selected records. | Creates the “live official check” moment in the demo. |
| P1 | Import logs and batch IDs. | Makes debugging and freshness explanations easier. |
| P2 | Larger historical or national imports. | Useful later, but not needed for the hackathon. |

## References

[1]: https://api.open.fec.gov/developers/ "FEC OpenFEC API Documentation"  
[2]: https://www.congress.gov/help/using-data-offsite "Using Congress.gov Data Offsite"  
[3]: https://www.govinfo.gov/developers "GovInfo Developer Hub"


### Legislator Enrichment Import Addendum

DistrictLens should import `unitedstates/congress-legislators` as a current-member enrichment layer. The import belongs beside, not instead of, the FEC and Congress.gov/GPO imports. It should enrich MongoDB with **Bioguide-centered identity, official webpages, social media handles, district offices, committee assignments, FEC crosswalk IDs, and photo-resolution metadata**. The agent may use this source for member identity and contact-context answers, but it must continue to use **Congress.gov/GovInfo/GPO for official legislative facts** and **FEC for finance facts**.
