# Geocod.io Integration Decision for DistrictLens

**Author:** Manus AI  
**Date:** May 07, 2026  
**Decision:** Adopt Geocod.io as a supplemental address-to-district and civic-enrichment service, not as the sole source of election, finance, or legislative truth.

## Recommendation

DistrictLens should use **Geocod.io for user-location onboarding and district enrichment**. It is a strong fit for the question, “What congressional district am I in?” because it can geocode addresses or coordinates and append congressional district, state legislative district, Census geography, and legislator metadata through a single API flow.[1] [2]

Geocod.io should **supplement, not replace**, the existing official-data strategy. FEC remains the source of truth for candidate and campaign-finance records. Congress.gov remains the source of truth for congressional profiles, bills, sponsorships, cosponsorships, and votes. Census/TIGER or Redistricting Data Hub remains the verification/reference layer for official boundaries. Geocod.io’s best role is to make district lookup easy, fast, and demo-friendly while providing useful identifiers such as OCD-ID, Bioguide, OpenSecrets, GovTrack, VoteSmart, Ballotpedia, and Wikipedia IDs for downstream matching.[2]

> **Architecture rule:** Geocod.io may identify and enrich a district, but DistrictLens must still ground election claims in FEC, Congress.gov, official campaign sources, and validated source documents.

## Why Geocod.io fits the product

Geocod.io’s political and civic data documentation states that it can return congressional districts, congressional contact information, state legislative districts, Census geographies, and related enrichment for addresses or coordinates.[1] Its API documentation confirms the relevant field appends: `cd`, `cd119`, `cd120`, `stateleg`, `stateleg-next`, and `census`.[2] For a 2026 midterm product, the most important detail is that Geocod.io supports `cd120`, which is intended for upcoming 120th Congress district boundaries, while `cd`/`cd119` remain current-district/current-member oriented until the 120th Congress is seated.[3] [4]

| DistrictLens need | Geocod.io fit | Recommended use |
|---|---:|---|
| Convert address to congressional district | High | Use in `/api/district/lookup` and onboarding search. |
| Convert ZIP to likely district | Medium | Allow as a convenience fallback, but display ambiguity and proportions. |
| Identify 2026/120th Congress district | High | Use `cd120` for election-oriented district lookup. |
| Get incumbent contact and IDs | High | Use as a seed for Congress.gov and OpenSecrets/FEC crosswalks. |
| Build official boundary archive | Medium | Use as a service layer, but keep Census/TIGER/RDH as reference data. |
| Campaign finance | None | Continue using FEC. |
| Congressional votes and bills | Low | Use returned Bioguide IDs to call Congress.gov; do not rely on Geocod.io for legislative behavior. |
| Issue positions | None | Continue using campaign sites, questionnaires, Congress.gov records, and validated source documents. |

## Pricing and hackathon practicality

Geocod.io is practical for the hackathon because its Pay-As-You-Go tier includes **2,500 free lookups per day** and then charges **$1.00 per 1,000 additional lookups**.[5] The pricing page lists a **1,000 lookups/minute** rate limit for the Pay-As-You-Go single request endpoint.[5] The API documentation clarifies that each field append counts as an additional lookup per address, so the MVP should request only the needed fields.[2]

| Flow | Suggested fields | Lookup accounting implication |
|---|---|---|
| MVP address-to-2026 district | `cd120` | Address geocode + one field append. |
| Current incumbent context | `cd` or `cd119` | Address geocode + one field append. |
| Full civic enrichment | `cd120,cd,stateleg,census` | More useful but more expensive; reserve for admin or cached flows. |
| Coordinate-only enrichment | `skipGeocoding=true` with needed fields | Avoids paying for geocoding again when coordinates are already known.[2] |

## Comparison with official Census/TIGER approaches

The official Census Geocoder is free and official, and it can return geographies such as congressional districts, state legislative districts, tracts, blocks, counties, places, and related Census layers when `returntype=geographies` is used.[6] TIGER/Line shapefiles are also official boundary files and contain geographic entity codes that can be linked to Census data, though they do not include demographic data directly.[7]

The tradeoff is implementation effort. A direct Census/TIGER path requires managing benchmarks, vintages, GIS files, point-in-polygon operations, redistricting updates, and district/member crosswalks. Geocod.io packages most of this into a simple API response and adds civic metadata useful for the agent. For the hackathon, Geocod.io offers a better time-to-demo ratio, while official boundary sources should remain the audit/reference layer.

| Criterion | Geocod.io | Census Geocoder | TIGER/Line or RDH boundary files |
|---|---|---|---|
| Full address lookup | Strong | Strong | Requires separate geocoder. |
| Congressional district response | Strong, simple API | Available through geography lookup | Requires point-in-polygon. |
| 2026/120th Congress support | `cd120` preview/update workflow | Depends on published Census layers/vintages | Depends on collecting and updating files. |
| Legislator metadata | Built in for current Congress | Not built in | Not built in. |
| Reference IDs | Built in for many legislator systems | Not built in | Not built in. |
| Official government source | No | Yes | Yes or source-dependent. |
| Hackathon implementation speed | High | Medium | Low. |
| Long-term auditability | Medium | High | High. |

## Implementation decision

DistrictLens should add a **Geocoding and District Resolver** module. The module should call Geocod.io for live district lookup, normalize returned districts into MongoDB, and then use FEC and Congress.gov for authoritative election and legislative data. Results should be cached by normalized address hash, stable address key when available, cycle, field set, and API response timestamp.

The MVP should implement three user-facing behaviors. First, the search box should accept a full address and return the likely congressional district. Second, if the user enters only a ZIP code, the UI should display all possible districts with `proportion` values and ask for a full address for higher confidence. Third, the agent should disclose whether the lookup used `cd120` election boundaries or current `cd`/`cd119` boundaries.

## References

[1]: https://www.geocod.io/political-and-civic-data/ "Geocod.io Political and Civic Data"  
[2]: https://www.geocod.io/docs/ "Geocod.io API Reference"  
[3]: https://www.geocod.io/redistricting/ "Geocod.io Redistricting Tracker"  
[4]: https://www.geocod.io/updates/2025-11-21-access-congressional-district-boundaries-for-the-upcoming-120th-congress/ "Geocod.io 120th Congress Update"  
[5]: https://www.geocod.io/pricing/ "Geocod.io Plans and Pricing"  
[6]: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html "U.S. Census Geocoding Services API"  
[7]: https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html "U.S. Census TIGER/Line Shapefiles"
