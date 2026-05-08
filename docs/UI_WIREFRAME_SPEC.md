# DistrictLens UI Wireframe Specification

## Screen 1: Landing and District Lookup

The landing page should communicate the product in one sentence: **DistrictLens is a nonpartisan agent that turns campaign-finance, legislative, and candidate-position evidence into a cited voter brief.** The page should include a prominent search box for ZIP code, state, district, or candidate name, along with three preset demo race buttons so the hackathon demo never depends on a live lookup succeeding.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ DistrictLens                                                         │
│ Nonpartisan election intelligence, grounded in public evidence.       │
├──────────────────────────────────────────────────────────────────────┤
│ [ Enter ZIP, state, district, or candidate name                  ]    │
│                                                                      │
│ Try a demo race: [House District A] [Senate Race B] [Open Seat C]     │
│                                                                      │
│ Data sources: FEC • Congress.gov • Campaign sources • MongoDB MCP     │
└──────────────────────────────────────────────────────────────────────┘
```

## Screen 2: Race Workspace

The race workspace is the main application view. It should use a three-column layout on desktop. The left sidebar controls the race and issue filters. The center panel presents structured evidence. The right panel hosts the agent.

```text
┌───────────────┬───────────────────────────────────────┬──────────────────────┐
│ Race Selector │ Race Overview                         │ Ask DistrictLens     │
│               │                                       │                      │
│ District      │ CA-XX House Race • 2026               │ Suggested questions  │
│ Candidates    │ Incumbent: Jane Doe                   │ - Who is running?    │
│ Issues        │ Race status: Challenger race           │ - Compare issues     │
│ Finance       │                                       │ - Follow the money   │
│ Sources       │ Candidate Compare                     │                      │
│               │ ┌─────────────┐ ┌─────────────┐       │ Chat answer with     │
│               │ │ Candidate A │ │ Candidate B │       │ citations and trace  │
│               │ │ Money bar   │ │ Money bar   │       │                      │
│               │ │ Issue tags  │ │ Issue tags  │       │ Tool trace           │
│               │ └─────────────┘ └─────────────┘       │ FEC ✓ Congress ✓     │
│               │                                       │ MongoDB ✓ Search ✓   │
└───────────────┴───────────────────────────────────────┴──────────────────────┘
```

## Screen 3: Candidate Compare

Candidate compare should be the hero screen because it makes DistrictLens immediately legible. Each candidate card must show structured data first and agent-generated interpretation second.

```text
┌──────────────────────────── Candidate Compare ────────────────────────────┐
│ Candidate A                         │ Candidate B                         │
│ Party • Challenger • FEC ID          │ Party • Incumbent • Congress ID      │
│ Receipts: $X                         │ Receipts: $Y                         │
│ Disbursements: $X                    │ Disbursements: $Y                    │
│ Cash on hand: $X                     │ Cash on hand: $Y                     │
│                                      │                                      │
│ Top issue signals                    │ Top issue signals                    │
│ [Housing] [Public Safety] [Taxes]    │ [Healthcare] [Climate] [Education]   │
│                                      │                                      │
│ Confidence: Medium                   │ Confidence: High                     │
│ Sources: campaign site, FEC          │ Sources: Congress.gov, FEC, website  │
└───────────────────────────────────────────────────────────────────────────┘
```

## Screen 4: Issue Evidence Drawer

Every issue claim should be clickable. When clicked, the drawer should show the exact source quote, source URL, source type, extraction date, and confidence label. This is the most important trust feature in the UI.

```text
┌──────────────────── Evidence for Claim ────────────────────┐
│ Claim: Candidate A supports expanding affordable housing.   │
│ Issue taxonomy: Housing                                     │
│ Confidence: Medium                                          │
│ Source type: Candidate-stated                               │
│ Source URL: https://candidate.example/issues                 │
│ Retrieved: 2026-05-07                                       │
│                                                            │
│ Quote: “I will fight to expand affordable housing...”       │
│                                                            │
│ Agent note: This is a candidate-stated position. It has not │
│ been independently verified against a voting record.        │
└────────────────────────────────────────────────────────────┘
```

## Screen 5: Money Flow

The money-flow view should avoid overwhelming users with raw FEC complexity. It should display simple bars, totals, and links to the underlying FEC records.

| Component | Description |
|---|---|
| Funding summary cards | Receipts, disbursements, cash on hand, debts. |
| Candidate comparison bars | Horizontal bars comparing candidates in the same race. |
| Committee list | Principal campaign committee and related committees. |
| Independent expenditure panel | Optional stretch component for outside spending. |
| Source links | Direct FEC links and endpoint metadata. |

## Screen 6: Agent Answer Format

Agent answers should follow a consistent structure. The UI should prevent free-floating political assertions by making citations and confidence part of the answer template.

```text
Question: Which non-incumbent candidates are gaining financial momentum?

Answer:
Candidate A appears to be the strongest non-incumbent fundraiser in this race based on
reported FEC receipts. Candidate C is also active but has lower reported cash on hand.

Evidence:
1. Candidate A reported $X in receipts and $Y cash on hand. [FEC]
2. Candidate C reported $X in receipts and $Y cash on hand. [FEC]

Caveat:
Campaign-finance reports can lag. This answer reflects the latest cached FEC data.

Tool trace:
FEC candidate search → FEC totals lookup → MongoDB cache → citation formatter
```

## Component Inventory for Claude Code

| Component | Responsibility |
|---|---|
| `DistrictSearch` | Search by ZIP, district, state, or candidate; include demo shortcuts. |
| `RaceOverviewCard` | Show race metadata, office, cycle, district, and status. |
| `CandidateCard` | Show candidate identity, status, finance totals, and issue tags. |
| `CandidateCompareTable` | Compare two or more candidates across money, issues, and evidence confidence. |
| `MoneyFlowChart` | Visualize receipts, disbursements, and cash on hand. |
| `IssueClaimCard` | Show issue claim summary, label, confidence, and citation count. |
| `EvidenceDrawer` | Show exact quotes and source metadata. |
| `AgentPanel` | Handle chat, suggested prompts, cited answers, and tool trace. |
| `ToolTraceTimeline` | Show which tools ran and which data sources were consulted. |
| `NeutralityBanner` | Explain nonpartisan limits and source-grounding policy. |

## MVP Priority

The MVP should build the Race Workspace first, not a map. A map is visually attractive, but the agent’s core value is evidence synthesis. The best use of limited hackathon time is a polished candidate comparison page with a right-side cited agent panel.

## UI Acceptance Criteria

| Requirement | Acceptance Criteria |
|---|---|
| Fast demo start | User can open a preset race in one click. |
| Evidence visibility | Every issue claim has a visible citation or a “needs verification” label. |
| Agent traceability | Every answer shows the tools/sources used. |
| Nonpartisanship | UI avoids persuasive recommendations and uses neutral language. |
| Partner value | MongoDB/Elastic retrieval and storage activity is visible in source or tool trace. |
| Data resilience | App can fall back to cached sample data if live APIs are unavailable. |
