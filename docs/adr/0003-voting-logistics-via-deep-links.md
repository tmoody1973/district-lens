# Voting logistics via deep-links, not in-app integration

**Status:** accepted (2026-05-23)

Research on voter-information tools shows the #1 thing voters need near election day is logistics — am I registered, where/when do I vote, what's on my whole ballot — ahead of issue positions. Rather than ingest voter-roll/polling data or build a sample-ballot view (a large build with new data dependencies), DistrictLens adds a "Can you vote?" strip that deep-links to official/established sources: the state registration check, polling-place lookup, key deadlines, and a "see your full ballot" link to BallotReady/Ballotpedia.

## Consequences

- **Explicit boundary: DistrictLens does NOT own registration, polling, or ballot-measure data.** Do not build an in-app registration form or sample-ballot view — by design we hand off to official sources. This keeps us nonpartisan (linking to official authorities) and avoids a data-freshness/compliance burden we can't carry.
- Full in-app logistics / sample ballot remains a deferred roadmap option if deep-links prove insufficient.
