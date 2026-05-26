Here's a detailed architecture for serving this. I'm going to walk it top-to-bottom — data sources, warehouse, retrieval, agent layout, CopilotKit integration, trust layer — because the pieces only make sense in relation to each other.

## The core architectural decision first

The single most important call: **the LLM composes, it doesn't claim facts.** Voting records, donor totals, attendance percentages — none of that comes from a model. It comes from a typed data warehouse, gets passed *into* the model as structured input, and the model's job is layout, framing, and natural-language glue. Get this wrong and you ship hallucinated voting records, which is a one-shot credibility event in civic tech.

This pushes the architecture toward: **structured warehouse → typed tool calls → agent composes → CopilotKit renders.** RAG over text is the wrong primitive for the factual core. RAG has a place, but only for the unstructured layer (news, statements, debate transcripts) where you're surfacing passages, not asserting numbers.

## Data sources, by brief section

This is the source-of-truth map. Each row is a section in the brief and the API/source that backs it.

**Candidate identity & bio**

- Congress.gov API (official LOC) — current members, terms, party, district
- Ballotpedia use with perplexity or scrape? We don't access to their api
- FEC Form 2 (Statement of Candidacy) — who's actually filed to run
- Wikipedia/Wikidata for fallback bio (with explicit "unverified" flag)

**Voting record & legislative behavior (House/Senate)**

- Congress.gov API — roll call votes, bills, cosponsorships, committee assignments
- GovTrack and OpenStates as secondary/historical sources
- Attendance % is derived from roll-call votes, not a separate field — you compute it

**Money (the Donor DNA-adjacent layer)**

- FEC OpenFEC API — itemized contributions, expenditures, top contributors, summary financials, independent expenditures
- OpenSecrets bulk data? waiting approval
- Your own Donor DNA pipeline for coalition fingerprinting and cross-candidate similarity
- Ad spend: Google Ads Transparency Center API, Meta Ad Library API, Wesleyan Media Project (academic, lagged but rigorous), AdImpact if budget allows

**Governor and state races**

- This is where it gets messy. State SOS APIs are wildly inconsistent. Some have real APIs (CA, TX), most you'll scrape. I create JSON file with links to all the states
- Ballotpedia normalizes a lot of this and is the realistic baseline
- State campaign finance is its own world per state (WI Ethics Commission for your state; CA Cal-Access; NY BOE; etc.)
- For executive record: scrape press releases, executive orders, appointment announcements, veto messages — these are public but scattered

**District and race context**

- Daily Kos Elections open dataset — district-level presidential results, partisan lean
- Cook Political Report, Sabato's Crystal Ball, Inside Elections — competitiveness ratings (Cook's API is paid; the others publish HTML you can parse)
- Census ACS — district demographics
- Redistricting Data Hub — current district boundaries

**Endorsements**

- No clean API exists. Scrape candidate sites, organization sites, news mentions. This is one of the hardest sections to do well — accept it'll be partial.

**News and recent events**

- GDELT for broad coverage (free, noisy)
- NewsAPI or a curated set of feeds per district (better signal-to-noise)
- Local news is the gap — for a Wisconsin race, you want JS Online, WisPolitics, Urban Milwaukee, etc., not just AP wire

**Polls**

- Silver Bulletin (Nate Silver's post-538 venture), RealClearPolitics, Decision Desk HQ, Polymarket (prediction market signal)
- Surface judiciously since you don't want horse-race-first UX

## The warehouse layer

Don't have the agent hit these APIs live. Cache them in a structured warehouse with these properties: MongoDB

**Schema** — every record carries `source_url`, `source_type`, `fetched_at`, `as_of_date`, `confidence`, and `raw_blob`. The `as_of_date` matters separately from `fetched_at` — FEC Q3 data was filed Oct 15 but reflects activity through Sept 30. The brief should be able to say "donor data as of Q3 2025" not "fetched yesterday."

**Refresh cadence** by data type:

- Voting records, FEC filings, committee assignments: nightly
- News, ad spend, polls: hourly
- Bio, district demographics: weekly
- Endorsements: nightly (since they spike near elections)

**Storage** — given your stack, MongoDB is the natural fit for the reactive personalization layer for this hackathon. The reason: FEC data alone is millions of rows and you'll want SQL aggregations the agent calls into. Convex is great for live state; less great for "sum all contributions by industry for candidate X over Q3."

A

## The retrieval layer — typed tools, not freeform RAG

The agent doesn't query the warehouse with SQL or natural language. It calls typed functions. Roughly:

```
get_candidate(candidate_id) → CandidateRecord
get_voting_record(candidate_id, congress, filters) → VoteRecord[]
get_top_donors(candidate_id, cycle, rollup_by) → DonorRollup
get_committee_assignments(candidate_id) → Committee[]
get_district_context(district_id) → DistrictContext
get_recent_news(candidate_id, days, source_filter) → Article[]
get_endorsements(candidate_id) → Endorsement[]
get_ad_spend(candidate_id, cycle, platform) → AdSpendSummary
compare_candidates(candidate_ids[], dimension) → ComparisonResult
get_race_stakes(office_type, jurisdiction) → StakesAnalysis
```

Each tool returns structured data with citation metadata attached. The agent never sees a freeform text blob and is never asked to remember a vote count.

The unstructured layer (news articles, candidate statements, debate transcripts) lives in a vector index, accessed via:

```
search_statements(candidate_id, query, k) → Passage[]
search_news(query, date_range, k) → Passage[]
```

These return passages with source URLs. The agent can quote or paraphrase from them, but only with the passage as visible context — never from memory.

## Agent orchestration

You have a real choice here, and it's where your instincts from Public Radio Agents matter. Two viable patterns:

**Pattern A — single orchestrator with a broad toolset.** One agent, ~20 tools, makes all the decisions about what to fetch. Simpler to reason about, easier to debug, but every brief is sequential and the prompt gets crowded.

**Pattern B — specialist sub-agents behind a router.** Something like:

- `RecordAgent` — voting history, attendance, bills, committees
- `MoneyAgent` — FEC, donor coalition, ad spend (this is where Donor DNA plugs in directly as a tool)
- `ContextAgent` — bio, district, endorsements, news
- `ComparisonAgent` — given N candidates, surface real fault lines
- `StakesAgent` — given an office, explain what flips
- `ComposerAgent` — takes all specialist outputs and assembles the brief sections

The composer is the only one that talks to CopilotKit's UI layer. Specialists run in parallel for a single race (RecordAgent + MoneyAgent + ContextAgent fan out simultaneously). Latency drops, prompts stay focused, and you can use cheaper models for the rollup specialists (Haiku for money aggregation) and a stronger model only for composition.

Given your hackathon-velocity bias, Pattern A ships in a week and Pattern B ships in three. But Pattern B is what scales when you add state races, ballot measures, and personalization variants — each becomes a new specialist, not a bigger orchestrator prompt.

## The CopilotKit integration

CopilotKit's leverage here is generative UI — the agent doesn't return markdown for you to render, it returns a structured payload that maps to React components. The composer agent's output is a tree like:

```
BriefRoot
├── BallotSummary { races: [...] }
├── RaceCard (per race)
│   ├── OfficeStakes
│   ├── CandidateBlock (per candidate)
│   │   ├── BioSummary
│   │   ├── RecordHighlights
│   │   ├── DonorCoalition  ← Donor DNA viz
│   │   ├── PositionGrid
│   │   └── CriticismFromOpponents
│   ├── ComparisonStrip
│   └── ChangedSinceLastVisit
└── Mechanics { polling_place, deadlines, id_rules }
```

Each component receives its data plus the citation metadata. CopilotKit's specific primitives that map well:

- **`useCopilotAction`** for the typed tools above — these become agent-callable from the frontend, which is useful when the user asks a follow-up like "show me the comparison on housing only"
- **`useCopilotReadable`** for voter context — address, party registration, races they've already explored — so the agent personalizes without you manually passing it on every call
- **Generative UI streaming** — surface the bio + record while the donor coalition is still computing, rather than blocking on the slowest specialist
- **The chat surface** stays available alongside the brief for "drill into this donor cluster" or "compare these two on immigration" — these become agent invocations that mutate or expand the existing UI tree rather than dumping new text

The pattern that's tempting but wrong: letting CopilotKit's chat agent generate facts in its responses. Force the chat agent to call your typed tools for any factual claim. If it can't get an answer through a tool, it should say "I don't have that" — not improvise.

## The trust layer

Every node in that UI tree carries citation metadata. The renderer treats citations as first-class:

- Hover/tap any number, name, or claim → source card appears with the underlying URL, fetched timestamp, and confidence flag
- LLM-paraphrased text gets a different visual treatment than raw fact (a subtle indicator, not a wall-of-disclaimer)
- "Last verified" appears per section, not per page — because the bio refresh cadence differs from the donor refresh cadence
- Gaps render explicitly: "No public position statement on housing as of Nov 1, 2025" beats silence

This is also where you build the receipts that defend you when someone — and they will — claims you got something wrong. Every brief render should be reproducible from the warehouse state at that timestamp.

## Personalization, gaps, and freshness

Voter context flows through `useCopilotReadable`: address → district resolution → ballot definition → party-restricted primary ballot if applicable. That happens once when the brief opens; downstream tool calls all receive it.

For freshness: a small `DiffAgent` compares the current warehouse state to what was shown to this voter last time and surfaces "what changed" as a top-of-brief callout. This is high-leverage UX that very few civic tech tools do, and it's nearly free once the warehouse has timestamps.

For gaps: every specialist agent returns either data or a structured `not_available` with a reason — "no FEC Q4 yet (filed Jan 31)" or "no position statement found in last 90 days of news, statements, or campaign site." The composer renders these explicitly. Silence is the enemy.

## What I'd build first

If I were sequencing this — build the **warehouse + typed tools + composer for one state, one race type, one election** before any of the multi-agent fanciness. House primary, single district, every claim cited. Prove the trust layer holds up under scrutiny. Then add specialists, then add states, then add governors.

The credibility cost of shipping a flashy multi-state generative-UI brief with one hallucinated voting record is much higher than the credibility cost of shipping a narrower brief that's airtight.

------

One genuine design choice where your call matters more than mine: **how aggressive do you want to be on personalization?** A universal brief (everyone in the district sees the same thing) is simpler, safer, easier to audit, and doesn't carry voter-profiling baggage. A personalized brief (knows the voter's prior interests, party registration, maybe past races they explored) is more useful but raises trust questions that civic tech doesn't always survive — especially right now with the political backdrop on voter data tools. Where do you want to land on that axis? It changes the architecture in a few places, particularly around what `useCopilotReadable` exposes and how much voter state you persist.