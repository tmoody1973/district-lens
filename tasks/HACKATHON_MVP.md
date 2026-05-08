# DistrictLens Hackathon MVP Scope

## Recommended demo narrative

The demo should open with a user asking: “What should I know about this congressional race?” DistrictLens resolves the race, shows candidates, identifies incumbents and challengers, summarizes finance context, and answers an issue question with direct quotes.

## Must-have scope

| Feature | Why it matters |
|---|---|
| 3–5 curated demo races | Shows depth without overextending data collection. |
| FEC candidate and finance ingestion | Demonstrates authoritative structured public data. |
| Congress.gov incumbent enrichment | Demonstrates accountability through actual records. |
| Optional Clerk sign-in | Only for saving districts, briefs, preferences, or research threads; never required for the public demo path. |
| Issue evidence extraction | Shows unique AI value beyond dashboards. |
| Source-discovery fallback | Shows agentic behavior while preserving trust. |
| Citations and confidence | Differentiates DistrictLens from a generic chatbot. |

## Should-cut if time is short

Do not build ideology scores, nationwide source crawling, complex district maps, or donor-to-issue inference. These are risky and not needed for a strong demo.

## Demo script

1. Select a demo race.
2. Show candidate list and statuses.
3. Show FEC finance snapshot.
4. Ask: “Where do these candidates stand on housing?”
5. Show direct quotes and source links.
6. Ask: “Do donor records prove a candidate supports a policy?”
7. Show guardrail answer explaining finance context versus issue evidence.


## Authentication scope

DistrictLens should remain **public-first** during the hackathon. Clerk is optional and should be used only if it does not delay the core race-brief demo. If implemented, Clerk should unlock saved districts, saved briefs, preferences, and persisted research threads. Admin import, refresh, extraction, and indexing operations must be protected even if the user-facing saved-feature layer is deferred.
