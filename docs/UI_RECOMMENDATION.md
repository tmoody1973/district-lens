# DistrictLens UI Recommendation

> **Note:** Some sections superseded by 2026-05-08 grilling decisions. HeroUI Pro references should be read as **OSS HeroUI** (MIT). The "stretch feature" voter brief export is now in scope for MVP. See [DECISIONS_LOG.md](./DECISIONS_LOG.md) §1.1 and §1.3.


DistrictLens should use a **research desk plus agent copilot** interface rather than a generic chatbot. The product is about trust, citations, and comparison, so the UI should make the agent’s evidence visible at every step.

## Recommended Product Shape

The best hackathon UI is a **district intelligence dashboard** with a conversational agent embedded on the right side. The user begins by entering a ZIP code, state, or congressional district. The app then opens a race page showing candidates, money flows, issue evidence, incumbent context, and a source-grounded answer panel.

This design works better than a full-screen chat because judges need to quickly see that DistrictLens uses structured election data, not just an LLM response. The chat should guide exploration, but the main screen should show durable civic artifacts: race cards, candidate profiles, issue matrices, donation summaries, source citations, and confidence labels.

## Primary Screens

| Screen | Purpose | Core Components | Demo Value |
|---|---|---|---|
| Landing / District Lookup | Let the user select a race quickly. | ZIP/district search, sample demo district buttons, nonpartisan disclaimer. | Gets judges into the demo immediately. |
| Race Overview | Summarize the district and race. | District card, office, election cycle, candidates, incumbent/open-seat label, agent summary. | Shows the data model and race construction logic. |
| Candidate Compare | Compare candidates side by side. | Candidate cards, party, incumbent/challenger/open-seat status, receipts, disbursements, top committees, issue claims. | Makes the project understandable in one screen. |
| Money Flow | Explain campaign finance. | FEC totals, PAC/committee links, top contributors or committees where available, independent expenditures if included. | Demonstrates FEC API value. |
| Issue Evidence | Show what candidates support with citations. | Issue tags, claim cards, source quote, source URL, confidence level, last checked date. | Shows responsible AI and source grounding. |
| Ask DistrictLens | Let the user ask natural-language questions. | Chat panel, suggested prompts, cited answers, “show sources” drawer. | Demonstrates the agent workflow. |
| Source Trace / Evidence Drawer | Prove the answer is grounded. | Retrieved documents, FEC endpoint metadata, Congress.gov links, campaign-page excerpts. | Helps satisfy judging criteria around real agents and tool use. |

## Ideal Layout

Use a three-column desktop layout for the demo. The left column is navigation and district/race selection. The center column is the evidence workspace. The right column is the DistrictLens agent panel.

| Region | Contents |
|---|---|
| Left sidebar | District lookup, saved demo races, filters for House/Senate, issue categories, and data freshness status. |
| Center workspace | Race overview, candidate comparison, issue matrix, and finance visualizations. |
| Right copilot panel | Agent chat, suggested questions, tool activity, citations, and confidence warnings. |

On mobile, collapse this into a stacked flow: district lookup, race cards, candidate compare, then chat.

## Core Interaction Flow

The first demo flow should be tightly scripted. The user selects a district, asks “Who is running and what are the major differences?”, then asks “Which non-incumbent candidates have significant funding and what issues do they emphasize?” The agent responds with candidate summaries, cited issue claims, and FEC-backed campaign-finance context.

The second demo flow should show trust. The user clicks a claim such as “supports reproductive rights” or “prioritizes border security.” The UI opens an evidence drawer with the exact source quote, source type, URL, extraction date, and confidence level. If the claim comes only from a campaign website or a search result, the UI labels it as candidate-stated rather than independently verified.

## Visual Style

The UI should feel like a civic research product, not a political campaign site. Use a neutral palette: navy, slate, white, and muted cyan. Avoid red-versus-blue dominance because it can make the app appear partisan. Use party color only as small metadata pills when necessary.

| Design Element | Recommendation |
|---|---|
| Color | Neutral civic palette with restrained accent colors. |
| Typography | Clean sans-serif, high readability, strong table layout. |
| Cards | Use cards for candidates, issues, and evidence claims. |
| Charts | Use simple horizontal bars for funding totals and stacked bars for source confidence. |
| Trust indicators | Use labels such as “FEC official data,” “Congress.gov official data,” “candidate-stated,” “news/source-discovered,” and “needs verification.” |

## Candidate Comparison Module

The candidate comparison should be the hero component. It should show each candidate as a card with a consistent structure: name, office, party, district/state, incumbent status, FEC candidate ID, principal campaign committee, total receipts, total disbursements, cash on hand, top issue tags, and source-confidence indicators.

| Candidate Attribute | Source | UI Treatment |
|---|---|---|
| Name, party, office, district | FEC candidate endpoint | Display as structured metadata. |
| Incumbent/challenger/open-seat status | FEC `incumbent_challenge` plus Congress.gov incumbent context | Display as a pill. |
| Campaign finance totals | FEC totals endpoints | Display as bars and exact values. |
| Legislative record | Congress.gov for incumbents | Show only for incumbents or former members. |
| Issue positions | Campaign sites, questionnaires, Congress record, source discovery | Show as claim cards with citations and confidence. |

## Agent Panel

The right-side agent should not look like a normal chatbot that invents answers. It should look like an analyst that uses tools. Each answer should include a short summary, evidence bullets, citations, and a confidence statement. The panel should also show a small “tool trace” section: FEC lookup, Congress.gov lookup, MongoDB retrieval, source search, and citation check.

Suggested starter questions should include: “Who are the non-incumbent candidates in this race?”, “Where is the campaign money coming from?”, “What issues does each candidate emphasize?”, “Which claims are backed by official records?”, and “Create a neutral voter brief for this district.”

## Guardrail UI

DistrictLens should visibly distinguish between facts, candidate-stated positions, inferred issue categories, and unknowns. This is essential for a civic AI product.

| Label | Meaning |
|---|---|
| Official data | Comes directly from FEC or Congress.gov. |
| Candidate-stated | Comes from the candidate’s campaign site or questionnaire. |
| Source-discovered | Found through search and then fetched from the underlying source. |
| Inferred category | The agent mapped a source quote to an issue taxonomy. |
| Needs verification | Only one weak source or conflicting evidence exists. |

## Hackathon MVP UI Scope

For the hackathon, do not build a full national election portal. Build a polished demo around three to five races, with the backend capable of ingesting more. The UI should include real API data where available, cached sample records for stability, and visible source grounding.

The MVP should include district lookup, race overview, candidate compare, issue evidence, finance summary, and the agent panel. Gerrymandering visuals can be a stretch goal unless district boundary data is already easy to load.

## Stretch Features

If time permits, add a map view, district partisan context, alerts when a candidate’s FEC totals change, side-by-side “money versus message” analysis, and a generated neutral voter brief export. The voter brief export could be a strong final demo artifact because it shows the agent producing something useful while preserving citations and caveats.

## Recommended Demo Script

The best demo script is: “A voter enters their district, DistrictLens identifies the race, separates incumbents from non-incumbents, summarizes campaign-finance flows from FEC, retrieves incumbent legislative context from Congress.gov, discovers candidate-stated issue positions, and produces a cited neutral voter brief.”

This UI makes DistrictLens feel like a serious civic transparency agent: data-rich, source-grounded, nonpartisan, and demo-friendly.


## CopilotKit implementation layer

Use CopilotKit for the right-side agent panel and typed generative UI, not as a replacement for the structured dashboard. The agent should be able to render approved React components for candidate comparison, finance charts, evidence cards, district ambiguity prompts, and source-trace timelines. This keeps the experience engaging while preserving civic safety: the model can choose among registered components and fill typed props, but it cannot invent arbitrary UI patterns or unsupported political claims.

OpenUI should remain a post-MVP experiment. It is promising for fully dynamic streamed dashboards, but the hackathon build has higher-priority integration work around ADK/Gemini, MongoDB MCP, Geocod.io, FEC, Congress.gov, and citation guardrails.

## HeroUI Pro design-system layer

Use **HeroUI Pro** as the deterministic dashboard design system and start from the **Brutalism** theme, adapted into a restrained **Civic Brutal** variant. HeroUI Pro should own the app shell, sidebar, command/search surfaces, cards, Data Grid, KPI blocks, charts, sheets/drawers, evidence timelines, and ballot grouping views. The design should feel sharp and memorable for the hackathon, but still nonpartisan, readable, and evidence-first.

CopilotKit should remain the agent-interaction layer. In practice, the CopilotKit panel should render approved HeroUI-based components through typed props rather than inventing arbitrary political UI. This gives DistrictLens an engaging agent experience while preserving predictable visual structure and civic guardrails.

| Surface | HeroUI Pro role | CopilotKit role |
|---|---|---|
| App shell | Sidebar, top command/search, responsive layout, Civic Brutal theme tokens. | None except surfacing suggested actions. |
| Race and ballot workspace | Cards, Data Grid, KPI sections, charts, grouped contest views. | Agent summaries and typed component rendering. |
| Evidence review | Sheet/drawer, source cards, confidence tags, source-trace timeline. | Opens evidence, explains citations, and requests clarification. |
| Agent panel | HeroUI shell and visual styling around the panel. | Core chat, frontend tools, generative UI, and human-in-the-loop actions. |

Do not let Brutalism become campaign-like. Use strong borders, clear hierarchy, high contrast, and compact data density, while keeping party colors as small metadata pills only.


## Optional Clerk sign-in UX

The user interface should be **public-first**. The landing page, sample district buttons, race dashboard, candidate cards, finance summaries, evidence drawer, and basic agent panel should load without sign-in. Clerk sign-in should be introduced only at the moment a user wants to save or personalize something.

| UI moment | Auth treatment |
|---|---|
| Open demo and select a district | Public. |
| Ask the agent for a cited race brief | Public, with rate limits if needed. |
| Save this district | Prompt Clerk sign-in. |
| Save this brief | Prompt Clerk sign-in. |
| Continue this research thread later | Prompt Clerk sign-in. |
| Submit a correction | Prefer Clerk sign-in for attribution and spam control. |
| Admin import or refresh controls | Hide from public users; require admin authorization. |
