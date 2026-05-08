# DistrictLens MVP Scope Decision: Defer Local Races

**Author:** Manus AI  
**Date:** May 07, 2026  
**Decision:** Build the hackathon MVP around **federal congressional district intelligence** and defer local/state ballot coverage.

## Recommendation

Yes. DistrictLens should leave local races out for this hackathon. The project will be stronger if it delivers one polished, trustworthy path rather than a broader ballot product with incomplete or stale local coverage.

The MVP should focus on address-to-congressional-district lookup, federal candidate or incumbent comparison, FEC campaign-finance summaries, Congress.gov legislative context, source-backed issue evidence, MongoDB-backed civic memory, CopilotKit agent interaction, and HeroUI Pro Civic Brutal presentation.

## Why this is the better hackathon scope

| Decision factor | Keep local races in MVP | Defer local races |
|---|---|---|
| Data freshness | High risk unless paid/partner data is ready. | Avoids stale-race criticism. |
| Engineering complexity | Requires contest models, provider normalization, review states, and official-source fallbacks. | Lets the team polish the federal flow. |
| Trust and citations | Hard to guarantee across counties and municipalities. | Federal sources are easier to cite and validate. |
| Demo clarity | “Everything on your ballot” is broad and easy to challenge. | “Congressional district intelligence” is crisp and defensible. |
| Judge impact | Breadth may look impressive but fragile. | Depth, polish, and evidence quality are more likely to land. |

## What remains in scope

DistrictLens should still use Geocod.io for address normalization and district resolution. The UI can show county and state-legislative district context if returned by Geocod.io, but it should not claim to show current state or local contests in the hackathon MVP.

## Post-MVP path

After the hackathon, DistrictLens can add a contest-oriented ballot layer using BallotReady/CivicEngine or Ballotpedia Data API as the primary current-race provider, Democracy Works for calendar/voter guidance, AP Elections for results, official state/county/municipal sources for verification, OpenStates/Vote Smart/Cicero for enrichment, and Perplexity + TabStack only as a reviewed discovery/extraction bridge.
