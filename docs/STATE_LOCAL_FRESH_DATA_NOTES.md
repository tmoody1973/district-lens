# DistrictLens alternatives to Google Civic for fresh state/local election data

Working premise: Google Civic Information API can be stale or incomplete for latest races, so DistrictLens should not treat it as the primary source for candidate/contest freshness.

## Stronger alternatives verified

### BallotReady / CivicEngine
Source URLs:
- https://organizations.ballotready.org/ballotready-api
- https://developers.civicengine.com/
- https://developer.ballotpedia.org/geographic-apis/elections_by_point

Findings:
- BallotReady API/data exports claim ballot data that matches voters to every candidate on their personal ballot.
- Provides candidate profiles, biographies, issue stances, endorsements, and thousands of ballot measures.
- Provides turnout data, upcoming elections, polling place data, and is built on district/subdistrict polygons.
- Provides officeholder data with records of over 200,000 officeholders.
- States database is refreshed every day and supported by researchers.
- CivicEngine developer docs say API covers current and historical data from every level of government.
- Ballotpedia `elections_by_point` endpoint returns candidates, ballot measures, races, district, office, and person information for a lat/long and election date. For future elections it returns upcoming ballot candidates and measures; for past elections it can return results if included in package.

Assessment:
- Best fit for fresh ballot/race/candidate coverage, especially if API access is available through pro/enterprise plan.
- Likely commercial access; should be primary non-federal ballot source if budget/access works.

### Democracy Works Elections API
Source URLs:
- https://developers.democracy.works/
- https://www.democracy.works/elections-api

Findings:
- API covers U.S. elections, authorities, dates/deadlines, registration/voting instructions, state/local authorities, and upcoming elections.
- Upcoming elections include statewide and local elections.
- Uses OCD IDs for state, county, municipality, school district, and other divisions.
- Has QA status flag: complete, incomplete, all.

Assessment:
- Strong for election calendar, voting guidance, authority info, and deadlines.
- Not a complete candidate/race data source for DistrictLens contest cards unless paired with another provider.

### AP Elections API
Source URLs:
- https://developer.ap.org/ap-elections-api/
- https://developer.ap.org/ap-elections-api/docs/Elections_Response_Data_Elements.htm

Findings from search/docs page metadata:
- Provides real-time election results for national, state, and local elections from poll close.
- Response data includes races, reporting units, and candidates.

Assessment:
- Excellent for results after polls close and live election night views.
- Less useful as primary pre-election candidate/ballot source. Likely paid/licensed.

### Vote Smart API
Source URL:
- https://www.votesmart.org/votesmart-api

Findings:
- Provides candidate biographies, voting records, ballot measures, zip-to-district match, interest group ratings, endorsements add-on, and public statements add-on.
- Claims data is constantly updated.
- API documentation at https://api.paas.votesmart.io/api

Assessment:
- Strong enrichment layer for candidate profiles, biographies, voting records, ratings, endorsements, and statements.
- Not necessarily best standalone source for complete current local ballot contests.

### Cicero / Melissa
Source URL:
- https://www.cicerodata.com/

Findings:
- Address-to-district matching and legislator lookups at all levels of government.
- Federal, state, and local elected official/contact/social/district data.
- Data refreshed daily.

Assessment:
- Strong for officeholders, districts, representatives, and contact info.
- Not a primary candidate/race/ballot-source replacement.

## Recommended source hierarchy update

1. Primary fresh ballot/race/candidate provider: BallotReady/CivicEngine or Ballotpedia Data API, depending on access and terms.
2. Election calendar/voter guidance provider: Democracy Works.
3. Official fallbacks: state SOS, county BOE, municipal clerks, official candidate lists and sample ballots for target jurisdictions.
4. Results provider: AP Elections API if live results are in scope; otherwise official state/county results pages.
5. Enrichment providers: Vote Smart for candidate background/voting records/ratings, OpenStates for state legislators, Cicero for officeholder/district/contact data.
6. Google Civic: optional fallback only, not primary source for latest races.
