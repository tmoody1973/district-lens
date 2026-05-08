# DistrictLens Google Civic Replacement Comparison

**Author:** Manus AI  
**Date:** May 7, 2026

## Executive recommendation

DistrictLens should **exclude state and local ballot data from the hackathon MVP** and keep Google Civic Information API as optional post-MVP fallback research only. If DistrictLens later promises “show me the current races and candidates for my address,” Google Civic’s freshness risk is too high for governor, state senate, state house, county, municipal, and ballot-measure coverage.

The best replacement path is a **two-tier strategy**. For a fast, credible MVP, use a commercial ballot provider such as **BallotReady/CivicEngine or Ballotpedia Data API** as the primary race and candidate source, with **official state/county/municipal sources** as curated fallbacks for the launch jurisdictions. For a scalable production product, pair that primary ballot provider with **Democracy Works** for election calendars and voter guidance, **AP Elections API or official results pages** for results, **Vote Smart** for candidate enrichment, and **Cicero/OpenStates** for officeholder and district enrichment.

## Source comparison

| Option | Best role | Freshness signal | Coverage strength | Access/risk | Recommendation |
|---|---|---:|---:|---:|---|
| **BallotReady / CivicEngine** | Primary ballot/race/candidate provider. | High; public materials state daily refresh and research-backed QA. | Strong; candidates, races, ballot measures, profiles, officeholders, districts, polling/voter info. | Commercial access and pricing; must obtain key. | **Best primary replacement** if access is available. |
| **Ballotpedia Data API** | Primary or near-primary ballot/race/candidate provider. | High for tracked races; endpoint supports future election date lookups. | Strong; `elections_by_point` returns candidates, measures, races, districts, offices, and people for lat/long/date. | Commercial/API package; verify pricing and terms. | **Best technical fit** for address-to-ballot lookup if licensed. |
| **Democracy Works Elections API** | Election calendar, deadlines, voting methods, authorities, and local election discovery. | Good; supports QA status and upcoming elections. | Strong for election metadata and voter guidance; not enough for complete candidate cards. | API key/access; may have partnership terms. | **Use as calendar/voter-guidance layer**, not candidate source. |
| **Official state/county/municipal sources** | Authoritative fallback and source-of-truth verification. | Highest authority but inconsistent publication formats. | Strong for specific jurisdictions; weak nationally unless manually maintained. | Scraping/CSV/PDF/manual ETL burden. | **Use for MVP target states/counties** and as audit fallback. |
| **AP Elections API** | Live and post-election results. | Very high from poll close onward. | Strong for results, races, reporting units, candidates. | Licensed/paid; less useful pre-election. | **Use only if live results are in scope.** |
| **Vote Smart API** | Candidate enrichment: bios, votes, ratings, endorsements, statements. | Claims constantly updated. | Strong political background data. | API access/demo; not complete ballot lookup. | **Use as enrichment**, not ballot source. |
| **Cicero / Melissa** | Address-to-district, elected official/contact lookup. | Daily refresh claim. | Strong officeholder and district matching; not a candidate/race source. | Commercial access. | **Use for officeholder enrichment** if Geocod.io is insufficient. |
| **Google Civic** | Fallback representative/voter info only. | User-identified stale/latest-race problem. | Useful but unreliable for current races. | Easy access, but data confidence issue. | **Demote to fallback.** |

## Revised practical architecture

DistrictLens should separate the non-federal election layer into four services rather than relying on one generalized civic endpoint. The **Ballot Resolver** should receive an address-derived lat/long and election date, query BallotReady/CivicEngine or Ballotpedia Data API, and normalize the response into `contests`, `candidates`, `ballot_measures`, `offices`, and `districts`. The **Election Calendar Service** should use Democracy Works and official calendars to determine which election dates apply to the address. The **Official Source Verifier** should attach source URLs from state, county, or municipal pages for high-priority contests. The **Enrichment Service** should add Vote Smart, OpenStates, FEC, Congress.gov, and Cicero-style officeholder context only after the contest identity is established.

This design prevents the core application from becoming dependent on any one provider. It also lets the UI clearly state, “Current ballot data from BallotReady/Ballotpedia; election date and voting guidance from Democracy Works; official source cross-check from secretary-of-state or county source.”

## MVP recommendation

For the **post-MVP** ballot layer, the highest-confidence path is to pick **one paid/current ballot provider** and support **one to three showcase jurisdictions** with official-source fallback. If BallotReady/CivicEngine access is attainable, choose it because it packages local candidate, officeholder, ballot measure, turnout, and district/subdistrict polygon coverage into one product. If Ballotpedia Data API access is easier, choose its `elections_by_point` style workflow because it maps directly to DistrictLens: Geocod.io resolves the address to a point, then Ballotpedia returns the races, candidates, ballot measures, offices, districts, and people for that point and election date.

Google Civic can remain in the package only as a **low-confidence fallback** and should never be used to overwrite fresher commercial or official data. In the UI, data provenance should appear next to every contest, with stale or fallback data labeled visibly.

## References

[1]: https://organizations.ballotready.org/ballotready-api "BallotReady API & Data Exports"  
[2]: https://developers.civicengine.com/ "CivicEngine Developer Documentation"  
[3]: https://developer.ballotpedia.org/geographic-apis/elections_by_point "Ballotpedia elections_by_point API"  
[4]: https://developers.democracy.works/ "Democracy Works API Documentation"  
[5]: https://developer.ap.org/ap-elections-api/ "AP Elections API"  
[6]: https://www.votesmart.org/votesmart-api "Vote Smart API"  
[7]: https://www.cicerodata.com/ "Cicero Democracy’s Database"
