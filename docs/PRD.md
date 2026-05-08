# Product Requirements Document: DistrictLens Agent

**Author:** Manus AI  
**Date:** May 07, 2026  
**Status:** Claude Code-ready MVP specification

## 1. Product summary

DistrictLens is a nonpartisan civic intelligence agent for U.S. congressional races. It helps users understand the upcoming midterm election by connecting race structure, campaign-finance data, incumbent legislative activity, candidate issue-position evidence, and district context into clear, cited answers.

The core product insight is that election information is public but fragmented. FEC filings show campaign money, Congress.gov shows legislative activity, campaign websites and questionnaires show candidate claims, and local reporting captures fresh statements. DistrictLens turns these separate sources into an auditable brief without pretending that AI can decide political truth.

> **One-sentence pitch:** DistrictLens is an evidence-backed election agent that explains who is running, who funds the race, what candidates say, what incumbents have done, and where the evidence comes from.

## 2. Problem statement

Voters and civic researchers often struggle to answer basic race questions: who is running in my district, which candidates are incumbents or challengers, who is financing the race, and what evidence exists about candidate positions. These answers are scattered across FEC data, Congress.gov records, campaign sites, questionnaires, local news, and voter guides. Search engines can find pages, but they do not reliably reconcile entities, preserve citations, or distinguish direct evidence from indirect signals.

DistrictLens solves this by making election information **structured**, **searchable**, and **cited**. It does not replace election officials, journalists, or voter guides; it provides a transparent evidence layer that can point users to the underlying sources.

## 3. Goals and non-goals

| Type | Item | Description |
|---|---|---|
| Goal | Race construction | Build race records from FEC candidate data for House and Senate races. |
| Goal | Non-incumbent visibility | Identify challengers and open-seat candidates, not just incumbents. |
| Goal | Finance transparency | Summarize receipts, disbursements, cash on hand, debts, and outside-spending context where available. |
| Goal | Legislative record | Enrich incumbents with Congress.gov sponsorships, cosponsorships, bill subjects, summaries, and votes. |
| Goal | Issue evidence | Extract candidate issue claims from official and semi-authoritative sources with quotes and citations. |
| Goal | Agent Q&A | Let users ask race and issue questions and receive cited, nonpartisan answers. |
| Goal | Optional authenticated workspace | Let signed-in users save districts, briefs, preferences, and research threads without gating the public civic experience. |
| Non-goal | Vote recommendation | DistrictLens must not tell users whom to vote for. |
| Non-goal | Ideology scoring | DistrictLens should not assign a left-right ideology score in the MVP. |
| Non-goal | Mandatory public-user login | DistrictLens should not require sign-in for district lookup, race pages, candidate comparison, citations, or basic agent answers. |
| Non-goal | National full-depth issue extraction | The MVP should deeply cover selected demo races rather than shallowly crawl every race. |
| Non-goal | Real-time legal compliance | The product is informational and not a campaign-finance legal tool. |

## 4. Target users and personas

| Persona | Need | Example question |
|---|---|---|
| Civic voter | Wants a neutral brief before researching candidates. | “Who is running in my district and what do they say about health care?” |
| Local journalist | Needs fast context and evidence links for a competitive race. | “Which outside groups are spending in this race and what has the incumbent sponsored?” |
| Civic educator | Teaches students how to evaluate evidence. | “Show me the difference between a campaign claim, a vote, and a donor signal.” |
| Campaign-finance researcher | Wants to connect money flows to race context without overclaiming. | “Which committees support the candidates and how much have they raised?” |
| Accessibility-focused voter | Needs plain-language explanations with citations. | “Explain this race in simple terms and show your sources.” |

## 5. MVP scope

The hackathon MVP uses a **bulk-everything-cheap, selective-on-deep** ingestion strategy (per [DECISIONS_LOG.md](./DECISIONS_LOG.md) §3.2):

- **Bulk imported (national, free):** all 2026 House+Senate FEC candidates, committees, and finance summaries from FEC bulk files (no API key, no rate limit). All 535 current Congress members from `unitedstates/congress-legislators` JSON. All 535 members' Congress.gov sponsorship/cosponsorship/votes (overnight ~6–7hr at 5k req/hr).
- **Selective (demo races only):** detailed FEC filings, candidate issue evidence, source extraction.

The 4 locked demo race slots: 1 Senate + 1 swing-incumbent House + 1 open-seat House + 1 Wisconsin House (WI-3, maintainer's local district per [MAINTAINER_DISCLOSURE.md](./MAINTAINER_DISCLOSURE.md)). Specific candidate names finalized post-FEC bulk import.

This balances ambition with reliability: any address resolves to a real race; demo races have deep evidence.

| Feature | MVP requirement | Acceptance criterion |
|---|---|---|
| Race search | User can search by state/district or candidate name. | App resolves to a `race_key` and candidate list. |
| Candidate cards | Show name, party, office, state, district, incumbent/challenger/open-seat status. | Data is loaded from FEC-derived records. |
| Finance snapshot | Show basic totals and top committees where available. | Values include source and retrieval timestamp. |
| Incumbent record | Show sponsored/cosponsored legislation and issue tags for incumbents. | At least one incumbent demo race has Congress.gov enrichment. |
| Issue Q&A | User asks about an issue and receives candidate-by-candidate cited evidence. | Every claim includes a quote or a “no direct evidence found” state. |
| Search fallback | Agent can discover missing issue sources through search. | Search output is used only to fetch and store source pages, not as final evidence. |
| Guardrails | Agent refuses vote recommendations and unsupported claims. | Test prompts confirm safe behavior. |

## 6. User stories

| ID | Story | Priority |
|---|---|---|
| US-01 | As a voter, I want to enter my district so I can see all candidates in the race. | Must |
| US-02 | As a voter, I want to know which candidates are incumbents, challengers, or open-seat candidates. | Must |
| US-03 | As a researcher, I want to view campaign-finance summaries so I can understand money flows in a race. | Must |
| US-04 | As a voter, I want to ask what candidates say about an issue and see direct quotes. | Must |
| US-05 | As a journalist, I want incumbent legislative records linked to issue areas. | Should |
| US-06 | As a civic educator, I want the agent to explain source types and confidence. | Should |
| US-07 | As a user, I want to know when no direct evidence was found. | Must |
| US-08 | As a developer, I want repeatable ingestion scripts for demo races. | Must |
| US-09 | As a returning user, I want to save districts, briefs, and research threads after signing in. | Should |
| US-10 | As an administrator, I want import and refresh operations protected from public access. | Must |

## 7. Functional requirements

DistrictLens must implement a retrieval-first answer pipeline. The agent should resolve the user’s race or candidate, retrieve stored records, optionally discover and fetch new sources, extract or retrieve claims, and answer with citations. It should not rely on unstored web snippets for final answers.

| Area | Requirement |
|---|---|
| Entity resolution | Normalize candidates by FEC candidate ID and map incumbents to Congress.gov Bioguide IDs when possible. |
| Race key | Use deterministic keys such as `2026-H-NY-04` and `2026-S-TX-00`. |
| Candidate classification | Use FEC `incumbent_challenge` plus incumbent/member cross-checks to label `incumbent`, `challenger`, and `open_seat_candidate`. |
| Issue claims | Store claims as JSON objects with issue area, stance, quote, source, date, and confidence. |
| Citations | Every factual assertion in an answer must cite stored source metadata. |
| Search | Search API is allowed only through a source-discovery abstraction. |
| Caching | Store API responses and extracted documents to avoid rate-limit problems and improve auditability. |

## 8. Nonfunctional requirements

| Category | Requirement |
|---|---|
| Reliability | The app should degrade gracefully when external APIs are down or rate-limited. |
| Transparency | Every answer must expose source links and dates. |
| Security | API keys must be stored in environment variables. |
| Performance | Demo race pages should load within a few seconds using cached MongoDB and Elastic records. |
| Maintainability | API clients, extractors, and agent tools must be modular and testable. |
| Civic safety | The agent must avoid targeted persuasion and unsupported candidate claims. |

## 9. Success metrics

For the hackathon, success should be measured by demo clarity and trustworthiness rather than national coverage.

| Metric | Target |
|---|---:|
| Demo races with candidate and finance data | 3–5 |
| Demo races with issue evidence | 3–5 |
| Agent answers with citations | 100% for factual claims |
| Unsupported issue-position claims | 0 in test prompts |
| Manual demo setup time | Less than 10 minutes after environment variables are configured |

## 10. References

[1]: https://api.open.fec.gov/developers/ "FEC OpenFEC API"  
[2]: https://api.congress.gov/ "Congress.gov API"  
[3]: https://ballotpedia.org/Ballotpedia%27s_Candidate_Connection "Ballotpedia Candidate Connection"  
[4]: https://www.vote411.org/about "VOTE411 About"  
[5]: https://github.com/GoogleCloudPlatform/agent-starter-pack "Google Cloud Agent Starter Pack"
