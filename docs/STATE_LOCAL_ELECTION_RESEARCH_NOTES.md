# DistrictLens State and Local Election Data Notes

## Core problem

DistrictLens currently has a strong federal-race path through Geocod.io for district resolution, FEC for federal candidates and finance, Congress.gov for federal legislative context, MongoDB for civic memory, and CopilotKit for the agent UI. Governor, state senate, state house, county, municipal, judicial, and school board races require a different data strategy because FEC and Congress.gov do not cover those offices.

## Verified source options

### Democracy Works Elections API

Democracy Works positions its Elections API as comprehensive election data for federal, state, county, municipal, sub-municipal, and school board elections for jurisdictions over 5,000 people. The product page states it includes dates, deadlines, voter guidance, ballot information, contests, candidates, ballot measures, official government URLs, local election office lookup, and voting locations. It says the data is gathered from official government sources, supplemented by third-party tools including Google Civic Information API, LegiScan, and Ballotpedia, and QA-reviewed.

This is the strongest all-in-one source for DistrictLens state and local ballot coverage, but it is likely commercial/partner-access rather than plug-and-play free API access.

Source: https://www.democracy.works/elections-api

### Google Civic Information API

Google Civic Information API supports address-based civic information. The overview says that for any US residential address it can return Open Civic Data identifiers at each elected level of government, and during supported elections it can return polling places, early vote locations, candidate data, and election official information. The `voterInfoQuery` endpoint returns contests, candidates, referenda, election administration bodies, polling locations, early vote sites, and drop-off locations for a registered address and optional election ID. It is free up to 25,000 queries/day after project registration.

This remains a practical **post-MVP** source for address-to-ballot lookup because it can return local contests and candidates for supported elections, but coverage is election-dependent and may not be reliable outside supported election windows.

Sources: https://developers.google.com/civic-information, https://developers.google.com/civic-information/docs/v2/elections/voterInfoQuery

### Ballotpedia developer data

Ballotpedia provides developer documentation for a candidates data set and geographic APIs. Its candidates documentation uses a robust election schema with Race ID, Stage ID, Candidate ID, candidate rows by election stage, ranked-choice voting support, cross-filing support, parties, statuses, and results semantics.

This is a strong source for candidate/race normalization across offices, but it appears to require customer or sales access. It should be treated as a premium or partner source unless public access is confirmed.

Sources: https://developer.ballotpedia.org/, https://developer.ballotpedia.org/dictionaries-and-terms/about-the-candidates-data-set

### OpenStates / Plural Policy

OpenStates is useful for state legislative context, not necessarily election contests. It can support current state legislators, bills, votes, committees, and legislative records. DistrictLens can use it as the state-level counterpart to Congress.gov once the app identifies an incumbent state legislator.

Source: https://open.pluralpolicy.com/, https://docs.openstates.org/

### AP Elections API

AP Elections API provides election race and results structures, including race metadata, office IDs such as Governor, candidates, reporting units, live/certified/test results, incumbents, and ballot measures. It is strong for election-night results and race metadata but is typically a commercial data feed.

Source: https://developer.ap.org/ap-elections-api/docs/Elections_Response_Data_Elements.htm

### Official state and local election offices

State Secretaries of State, state election boards, county clerks, and municipal election boards are authoritative for candidate lists, ballot measures, and results. However, APIs and formats vary widely. This path is reliable but expensive to normalize nationally. It works well for a hackathon if DistrictLens chooses 1–3 demo states or counties and builds specific scrapers/importers.

## Initial recommendation

For the hackathon MVP, do **not** add a live non-federal election abstraction. Preserve these notes as post-MVP research. If the scope is reopened later, use Geocod.io for district IDs, prefer BallotReady/CivicEngine or Ballotpedia for current ballot contests, use Democracy Works for calendar/voter guidance, keep Google Civic fallback-only, and use official state/county sources for curated verified coverage.
