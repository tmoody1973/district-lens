# DistrictLens Data Strategy

> **Note:** Some sections superseded by 2026-05-08 grilling decisions. Elastic is dropped from MVP — Atlas Search + Atlas Vector Search handle retrieval. Federal-MVP source discovery uses Gemini Google Search grounding, not Perplexity (Perplexity is post-MVP only). Models are Gemini 3.1 Pro (reasoning) and Gemini 3.1 Flash-Lite (extraction). See [DECISIONS_LOG.md](./DECISIONS_LOG.md) §3.1, §3.3, §3.4.


## Overview

DistrictLens combines a **MongoDB bulk-imported civic intelligence cache** with evidence-based web retrieval and official live refresh tools. The product should never treat all sources as equal. FEC data is authoritative for federal campaign-finance filings, Congress.gov and GovInfo/GPO are authoritative for congressional legislative information, and candidate issue positions require evidence from official campaign materials, questionnaires, public statements, and legislative records. MongoDB is the primary app-read layer, not the original source of truth.

## Data source map

| Data type | Primary source | Secondary source | Notes |
|---|---|---|---|
| Candidate universe | FEC bulk/selective import into MongoDB | FEC OpenFEC API refresh | Use FEC for federal candidates and committees; read from MongoDB first. |
| Race construction | MongoDB records derived from FEC candidate fields | Manual correction for demo races | Group by cycle, office, state, district. |
| Campaign finance | FEC bulk/selective import into MongoDB | FEC OpenFEC API live refresh | Cache aggressively and refresh only when missing, stale, or explicitly requested. |
| Incumbent identity | Congress.gov/GPO-derived import into MongoDB | Congress.gov API refresh, Bioguide, official House/Senate pages | Map to FEC candidate by name/state/district and manual override if necessary. |
| Legislative behavior | Congress.gov/GovInfo import into MongoDB | Congress.gov API and GovInfo/GPO refresh | Use sponsorships, cosponsorships, subjects, summaries, related bills, laws, bill text links, and House votes. |
| Candidate issue statements | Campaign websites, questionnaires | Ballotpedia, VOTE411, debates, news quotes | Store as evidence-backed claims. |
| Source discovery | Perplexity/search provider | Manual seeded URLs | Search is discovery only. |

## Candidate issue-position source hierarchy

| Tier | Source type | Confidence use |
|---:|---|---|
| 1 | Official campaign website, press release, verified questionnaire | High for attribution. |
| 1 | Congressional vote, sponsorship, cosponsorship | High for incumbent legislative behavior. |
| 2 | Debate transcript, town hall, official social post | Medium-high if quoted and dated. |
| 3 | News article directly quoting candidate | Medium. |
| 4 | Interest-group rating or endorsement | Context only unless clearly labeled as third-party evaluation. |
| 5 | Donor or outside-spending signal | Finance context only, not an issue position. |

## Issue taxonomy

Use a fixed taxonomy for the MVP. This keeps extraction, retrieval, and UI comparison consistent.

| Issue area | Example subtopics |
|---|---|
| economy_jobs | Inflation, wages, manufacturing, trade, small business. |
| taxes_budget | Taxes, deficit, Social Security, Medicare funding. |
| healthcare | ACA, drug prices, Medicaid, Medicare, reproductive health. |
| immigration_border | Asylum, border security, deportation, work permits. |
| climate_energy | Clean energy, oil and gas, permitting, climate resilience. |
| housing_affordability | Rent, mortgages, supply, homelessness. |
| education | Student debt, public schools, school choice, workforce training. |
| public_safety_justice | Policing, guns, courts, sentencing, crime prevention. |
| democracy_elections | Voting rights, gerrymandering, ethics, campaign finance. |
| foreign_policy_defense | Ukraine, China, Israel/Gaza, veterans, defense spending. |
| technology_ai | AI policy, privacy, cybersecurity, broadband. |
| agriculture_rural | Farm bill, rural hospitals, water, crop insurance. |


## Bulk import plus live refresh model

DistrictLens should use MongoDB as the **operational read model** for FEC and Congress.gov/GPO-derived official data. Bulk or selective importers should seed the demo database before judging, and API clients should be retained as controlled refresh tools. This avoids making normal page loads dependent on external API latency or rate limits while still allowing the agent to check official sources when a user asks for the latest available information.

| Layer | Responsibility | MVP behavior |
|---|---|---|
| Bulk/selective importer | Load selected official records into MongoDB with provenance and freshness metadata. | Seed current Congress, selected congressional races, candidate committees, finance summaries, and relevant legislative records. |
| MongoDB read model | Serve application pages, agent retrieval, MCP-visible civic memory, and cached briefs. | Default source for all UI and agent reads. |
| Official API refresh tools | Check FEC, Congress.gov, and GovInfo/GPO when records are missing, stale, or user-requested. | Upsert refreshed results into MongoDB before answering. |
| Freshness policy | Decide when cached records are acceptable. | Use `freshness_status`, `last_checked_at`, `source_updated_at`, and `stale_after`. |

Every official-data document should include `source_system`, `source_url`, `source_record_id`, `import_batch_id`, `ingested_at`, `source_updated_at`, `last_checked_at`, `stale_after`, `freshness_status`, and `checksum` where available. The UI should display the import/check timestamps for finance and legislative records because civic trust depends on knowing whether a number or bill status is current enough for the user’s question.

## Race construction logic

1. Run `import_fec_candidates` for `cycle=2026` and `office in H,S`, writing normalized records into MongoDB before the app reads them.
2. Normalize district to two digits for House and `00` for Senate.
3. Construct `race_key` as `{cycle}-{office}-{state}-{district}`.
4. Group candidates by `race_key`.
5. Label candidates by FEC `incumbent_challenge` where available.
6. Cross-check incumbents through imported Congress.gov/GPO-derived member records, then use Congress.gov API refresh if mappings are stale or missing.
7. Treat challengers and open-seat candidates as non-incumbents for product language.

## Issue evidence workflow

Issue evidence must be stored before it is used in an answer.

```text
candidate_id/race_key
  → source discovery or seeded URLs
  → source fetch and clean text
  → source document stored in MongoDB
  → source indexed in Elastic
  → claim extraction with JSON schema validation
  → claim confidence and conflict checks
  → answer generation with citations
```

## Search provider policy

Perplexity or another search API may be used to find source URLs, but the agent must not cite search snippets or synthesized search answers. The system must fetch the underlying source page and extract evidence from that source.


## Geocod.io district lookup and civic enrichment

DistrictLens should use Geocod.io as the live address-to-district resolver for the MVP. For 2026 election workflows, use the `cd120` field append by default so that district lookup aligns with upcoming 120th Congress boundaries when available. For current incumbent context, use `cd` or `cd119` and then call Congress.gov with returned identifiers such as Bioguide IDs.

Geocod.io must remain a lookup and enrichment layer. FEC is still authoritative for candidates and finance, Congress.gov/GovInfo are authoritative for legislative records, MongoDB is the primary cached read model, and source documents are authoritative for issue claims. ZIP-only lookups must preserve all returned districts and proportions because ZIP codes can cross district boundaries. Full address or coordinate lookup should be preferred in the UI.

## State and local election data strategy

For the hackathon MVP, DistrictLens should **defer non-federal races** rather than treating them as active product scope. Governor, state senate, state house, county, municipal, judicial, school-board, and ballot-measure data can later enter through a contest-oriented ballot layer. FEC remains authoritative only for federal campaign finance and federal candidate filings.

| Data type | Primary source | Secondary source | Notes |
|---|---|---|---|
| Address-specific ballot contests | **Post-MVP only** | BallotReady/CivicEngine or Ballotpedia Data API later | Do not implement for the hackathon unless federal MVP is complete. |
| Election calendar and voter guidance | Democracy Works Elections API | Official election authority calendars | Use for election dates, deadlines, authorities, and voting instructions; do not assume complete candidate freshness. |
| State legislative district lookup | Geocod.io `stateleg` append | Official state district maps | Geography only; not a candidate source of truth. |
| State legislative incumbent records | OpenStates | Official legislature pages | Use as the state-level counterpart to Congress.gov. |
| Official local candidate lists and ballot items | **Post-MVP only** | State election offices, county clerks, municipal election boards | Avoid local ingestion in the hackathon MVP. |
| Election-night results | AP Elections or official state/county results | Curated demo snapshots | Keep results separate from issue evidence and finance records. |
| State/local campaign finance | State disclosure portals where available | Curated demo state integrations | Do not mix with FEC totals; label jurisdiction and filing authority. |

The product should clearly label scope boundaries. For the hackathon, the agent should say that DistrictLens currently focuses on federal congressional district intelligence and that local/state ballot coverage is planned post-MVP.


## unitedstates/congress-legislators Enrichment Source

The MVP should bulk import [`unitedstates/congress-legislators`](https://github.com/unitedstates/congress-legislators) into MongoDB as the **member identity and enrichment layer**. This source provides current legislator identity records, official webpages in term records, official social-media handles, district offices, current committees, committee membership, and useful crosswalk IDs including Bioguide, FEC, GovTrack, OpenSecrets, VoteSmart, C-SPAN, Wikipedia, Ballotpedia, Wikidata, Google entity IDs, and GPO Pictorial IDs.

| Source role | DistrictLens treatment | Boundary |
|---|---|---|
| Member identity and profile enrichment | Import into `legislator_profiles`, `legislator_social_accounts`, `legislator_district_offices`, and committee collections. | Use Bioguide as the primary key and preserve source commit/import metadata. |
| Photos and portraits | Store photo resolver metadata such as `pictorial_id`, `photo_source`, `photo_url`, and attribution when resolved. | Do not rely on unlicensed scraping; use placeholders when no official photo URL is resolved. |
| Legislative records | Use Congress.gov/GovInfo/GPO. | Do not use this enrichment dataset as the official bill, vote, law, or summary source. |
| Campaign finance | Use FEC bulk imports and API refreshes. | Use FEC IDs from the enrichment import only as crosswalks. |
