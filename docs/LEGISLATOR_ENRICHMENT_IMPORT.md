# Legislator Enrichment Bulk Import Strategy

DistrictLens should include [`unitedstates/congress-legislators`](https://github.com/unitedstates/congress-legislators) as a **selective MongoDB bulk-import enrichment source** for congressional member identity, current terms, official office webpages, social media handles, district offices, committee assignments, FEC crosswalk IDs, and photo-resolution metadata. This dataset improves the person layer and candidate/member cards, while **Congress.gov and GovInfo/GPO remain the official sources for legislative records, bills, votes, summaries, and statutory text**.

> The repository describes itself as providing “Members of the United States Congress (1789-Present), congressional committees (1973-Present), committee membership (current only), and presidents and vice presidents of the United States in YAML, JSON, and CSV format.” It also publishes files for current legislators, social media, current committees, current committee membership, and district offices. [1]

## MVP Decision

The hackathon MVP should import only the current-member files needed for congressional district intelligence. This keeps the app fast and visually rich without turning the demo into a full historical congressional database.

| File | MVP use | MongoDB target | Notes |
|---|---|---|---|
| `legislators-current.yaml/json` | Current member identity, terms, official webpages, office phones, crosswalk IDs, FEC IDs, and `pictorial` photo identifiers. | `legislator_profiles` and selected `candidates` enrichment fields. | Use `bioguide` as the canonical person key and keep FEC IDs as crosswalks into FEC imports. |
| `legislators-social-media.yaml/json` | Official social accounts for current members. | `legislator_social_accounts` or embedded `social` block on `legislator_profiles`. | The repository documents these as official accounts, not campaign or personal accounts. [1] |
| `legislators-district-offices.yaml/json` | District office addresses, phones, geocodes, and office IDs. | `legislator_district_offices`. | Useful for the district dashboard and “contact your representative” panel. |
| `committees-current.yaml/json` | Current committee metadata. | `congress_committees`. | Show committee context on incumbent cards. |
| `committee-membership-current.yaml/json` | Current committee and subcommittee assignments. | `legislator_committee_memberships`. | Join by Bioguide where possible. |
| `legislators-historical.yaml/json` | Historical members. | Deferred. | Post-MVP unless a demo district needs a former incumbent comparison. |

## Photo Strategy

The dataset itself is best treated as a **photo metadata and resolver source**, not as a binary image warehouse. Current legislator records may include a `pictorial` identifier associated with the GPO Pictorial Directory. DistrictLens should store `photo_source`, `pictorial_id`, `photo_url`, `photo_attribution`, and `photo_checked_at` fields when a resolver is implemented, but the MVP can begin with deterministic placeholders when no licensed or official headshot URL is available.

This prevents image scraping from becoming a hackathon risk. Candidate/member cards should still reserve a portrait slot and display a “photo pending official source” fallback if no resolved image is available.

## Import and Refresh Policy

The import should run as a controlled admin job, not on every page load. MongoDB remains the application read model, and every imported record should carry provenance metadata.

| Policy area | Requirement |
|---|---|
| Canonical key | Use `bioguide_id` as the primary legislator enrichment key. |
| Crosswalks | Preserve `fec`, `govtrack`, `opensecrets`, `votesmart`, `cspan`, `wikipedia`, `ballotpedia`, `wikidata`, `google_entity_id`, and `pictorial` IDs when present. |
| Official record priority | Use this dataset for identity and enrichment. Use FEC for campaign finance and Congress.gov/GovInfo/GPO for official legislative facts. |
| Freshness | Store `import_batch_id`, `source_system = unitedstates_congress_legislators`, `source_url`, `source_commit_sha`, `ingested_at`, `source_updated_at`, `last_checked_at`, `checksum`, and `freshness_status`. |
| Agent behavior | The agent may cite this source for identity, social account, webpage, office, and committee-enrichment claims, but should cite Congress.gov/GPO for bills and votes and FEC for finance. |
| Admin protection | Import endpoints remain protected by the same admin-secret or Clerk-admin policy used for FEC and Congress.gov/GPO imports. |

## Implementation Target

Claude Code should implement a selective importer that pulls the published JSON files where available from `https://unitedstates.github.io/congress-legislators/`, transforms them into MongoDB records, and upserts by Bioguide ID. The importer should then enrich candidate records when an FEC candidate ID or Bioguide crosswalk matches an active congressional candidate.

The recommended tool contract is `import_legislator_identity_enrichment(scope = current_members | committees | district_offices | all_current)`. The tool should return record counts, changed records, skipped records, unresolved photo IDs, and a checksum manifest.

## References

[1]: https://github.com/unitedstates/congress-legislators "unitedstates/congress-legislators GitHub repository"
[2]: https://pictorial.gpo.gov/member-search/ "GPO Pictorial Directory member search"
