# DistrictLens State and Local Election Strategy: Post-MVP Scope

**Author:** Manus AI  
**Date:** May 07, 2026  
**Decision:** **Exclude local and non-federal race coverage from the hackathon MVP.** Preserve the architecture as a post-MVP extension.

## Executive recommendation

DistrictLens should **leave local races out of the hackathon MVP**. This includes county, municipal, school-board, judicial, ballot-measure, governor, state senate, and state house contest coverage. The product should stay focused on the clearest and most defensible demo promise: **enter an address, identify the congressional district, compare federal candidates or incumbents, and show evidence-backed issue and campaign-finance context**.

This is the right hackathon decision because fresh local-race data is fragmented, often licensed, jurisdiction-specific, and hard to validate nationally. Adding it now would shift engineering time away from the core Gemini/ADK, MongoDB MCP, Geocod.io, FEC, Congress.gov, CopilotKit, and HeroUI Pro demo. It also creates trust risk: a missing or stale school-board or city-council race is more damaging than a well-labeled federal MVP that is complete within its stated scope.

## MVP scope

| Area | Hackathon MVP status | Rationale |
|---|---|---|
| Address geocoding and district lookup | **In scope** | Geocod.io can resolve the user’s address to congressional district and civic geography. |
| U.S. House race/candidate comparison | **In scope** | FEC and curated candidate sources provide a defensible federal-race path. |
| Federal campaign finance | **In scope** | FEC remains the authoritative source for federal candidate and committee finance. |
| Incumbent legislative context | **In scope when applicable** | Congress.gov provides official member and legislative-record context. |
| Candidate issue evidence | **In scope** | Search/fetch/extract pipeline can cite campaign pages, questionnaires, debates, and trusted sources. |
| Statewide/state legislative contests | **Post-MVP** | Requires a separate contest model and fresher ballot providers. |
| County, municipal, judicial, school-board, and ballot-measure contests | **Post-MVP** | Highest coverage and validation risk; not needed for the core hackathon story. |
| Perplexity + TabStack local-race extraction | **Deferred** | Useful later as a reviewed official-source bridge, but too much risk and scope for the MVP. |
| Google Civic voterInfo race lookup | **Fallback research only** | Do not rely on it for latest races. |

## Product positioning for the demo

The hackathon demo should say: **“DistrictLens is an AI-powered congressional district intelligence tool.”** It should not promise “everything on your ballot” during the hackathon. A tighter product narrative will be easier for judges to understand and easier for the team to complete with high polish.

The UI may still show a disabled or informational **Post-MVP Ballot Layer** card. That card should explain that local and state race coverage is designed but intentionally deferred until DistrictLens has access to a reliable ballot provider such as BallotReady/CivicEngine, Ballotpedia Data API, Democracy Works, AP Elections, or curated official state/county feeds.

## Post-MVP architecture to preserve

DistrictLens should keep the design space open for a future contest-oriented ballot layer. The future model should use stable internal IDs such as `contest_key`, `candidate_id`, and source-specific aliases. Non-federal race records should never be forced into the FEC-centered federal model.

| Future capability | Preferred source path | Implementation note |
|---|---|---|
| Address-specific current ballot | BallotReady/CivicEngine or Ballotpedia Data API | Use only when licensed access and freshness metadata are available. |
| Official race verification | State SOS, county election boards, municipal clerks | Use curated files or direct official feeds for target jurisdictions. |
| Election calendar and voter guidance | Democracy Works | Use for dates, deadlines, and voter guidance, not as the sole candidate source. |
| Results | AP Elections or official state/county results | Keep results separate from candidate issue and finance evidence. |
| State legislative enrichment | OpenStates, Vote Smart, Cicero, official legislature pages | Use after the contest identity is already established. |
| Discovery/extraction bridge | Perplexity + TabStack | Use only with official URLs, schema validation, provenance, confidence labels, and human review. |
| Google Civic | Fallback/reference only | Do not position as current-race source of truth. |

## Implementation guidance for Claude Code

For the hackathon build, do **not** implement `/api/ballot/lookup` as a production local-ballot endpoint. Instead, keep the federal district lookup and race comparison flow as the primary path. If useful for future extensibility, create only a stub or documented interface named `BallotLayerProvider` behind a feature flag such as `STATE_LOCAL_BALLOT_LAYER_ENABLED=false`.

Any previously planned local-race endpoints, ingestion jobs, Perplexity/TabStack extraction jobs, Google Civic fallback ingestion, or official local CSV imports should be marked **post-MVP**. They should not block the main demo.

## Final decision

DistrictLens should ship a **focused federal MVP** for the hackathon. Local and state races are strategically valuable, but they should be deferred until after the hackathon when provider access, jurisdiction targets, validation workflows, and review capacity are clearer.
