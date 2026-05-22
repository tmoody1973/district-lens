# DistrictLens v3 — Design Spec
**Date:** 2026-05-22
**Hackathon:** Google Cloud Rapid Agent Hackathon — MongoDB track
**Supersedes:** 2026-05-15-districtlens-v2-design.md

---

## Problem with v2

The existing UI is three empty columns on first load. "Mission" is jargon. Evidence cards — the product's core differentiator — appear last after candidates and finance. The agent is reactive: it only runs when you ask it something. Nothing about the experience communicates that this is a powerful autonomous agent.

---

## The Shift

Same three-column layout, but everything about how it behaves changes:

1. **Empty state has a job** — canvas is the hero on first load, not a blank panel
2. **Language a real person understands** — "Start" not "Mission", "Voter Brief" not "Race Brief"
3. **Evidence comes first** — direct candidate quotes surface before candidates and finance
4. **The receipt shows the agent working** — users watch 15–20 steps execute in real time
5. **Chat extends the brief** — doesn't replace it

---

## Layout — Three Columns (B1)

```
┌────────────┬──────────────────┬────────────────────────────┐
│            │                  │                            │
│  Start     │   US Map         │   Canvas                   │
│  Panel     │   (always        │   (receipt → brief)        │
│  26%       │   visible)       │   flex-1                   │
│            │   34%            │                            │
└────────────┴──────────────────┴────────────────────────────┘
│  Chat bar — full width, always visible                      │
└─────────────────────────────────────────────────────────────┘
```

All three columns and the chat bar are always on screen. No drawer, no tabs, no modal.

---

## Screen 1 — Empty State (First Load)

The canvas becomes the hero. The left panel and map are visible but quiet. The canvas shows a centered prompt that communicates what the product does and invites the first action.

**Canvas empty state content:**
- Headline: "What congressional race do you need to understand?"
- Subtext: "Evidence-first. Nonpartisan. Cited sources."
- Address input field: "Enter your street address or ZIP…"
- CTA button: "Find My Race →"
- Footer hint: "or type any candidate name in the chat below"

**Left panel empty state:**
- Centered icon + "Enter your address to get started"
- No mission options visible yet (they appear after race is found)

**Map:**
- Always visible, neutral grey
- Label: "Or click a state"

---

## Screen 2 — Brief Building (Receipt Mode)

Once a race is found, the canvas switches to receipt mode. The left panel activates with mission options. The map highlights the relevant state.

### Left Panel (active)
- Label: "Start"
- Options: **Voter Brief** (selected, blue) / Research / Journalist
- Race chip at bottom showing active race (e.g., "WI-04 Moore · Running…")

### Canvas — Receipt

**Header row:**
```
WI-04 Voter Brief ●          ~20 sec left
```

**Progress checklist (top of canvas):**
```
✓  District resolved → WI-04           (struck through when done)
✓  2 candidates loaded
✓  FEC finance pulled
⟳  Searching positions…               (amber, animating)
○  Legislation record                  (grey, pending)
○  Build summary
```

**Cards appear below checklist as each step completes.**

### Card Order (evidence first)

Cards appear in this order as the agent completes steps:

1. **Evidence cards** — direct candidate quotes with citations (purple left border)
2. **Candidate cards** — name, party, status, finance total (blue/red left border)
3. **Finance gap bar** — horizontal bars, individual vs PAC breakdown
4. **Legislation feed** — bill IDs, titles, sponsor/cosponsor status
5. **News cards** — last 7 days, headline + source (if requested)

Evidence comes first because it is the product's reason to exist.

---

## Card Designs

### Evidence Card
```
┌─ purple left border ────────────────────────────────┐
│ [HOUSING]  direct quote                             │
│ "We need to pass the Housing Affordability Act…"   │
│ ballotpedia.org/Gwen_Moore   · 2026-03-14          │
└─────────────────────────────────────────────────────┘
```
- Issue tag (purple pill)
- Confidence label: "direct quote" / "paraphrase" / "no statement found"
- Quote in italics
- Clickable source URL
- Source date

### Candidate Card
```
┌─ blue left border ──────────────────────────────────┐
│ [GM]  Gwen Moore                    $844K raised   │
│       Democrat · Incumbent          61% PAC        │
└─────────────────────────────────────────────────────┘
```
- Party color left border (blue DEM / red REP)
- Initials avatar (fallback) or bioguide photo
- Name, party, status
- Raised total + PAC percentage (right-aligned)

### Finance Gap Bar
- Horizontal bars, proportional to raised amounts
- Party color fill
- Labels: dollar amount + "×" multiplier for gap (e.g., "Moore outraises challenger 844×")

### Legislation Feed
- Bill ID in monospace (amber)
- Bill title
- Badge: Sponsor (amber) / Cosponsor (grey outline)

---

## Screen 3 — Brief Complete

When all steps finish:

**Receipt header changes to:**
```
✓  WI-04 Voter Brief complete · 6 sources    [Share brief]
```

- All checklist steps struck through
- Green success bar replaces the running indicator
- "Share brief" button (not "Export markdown") — copies a shareable link or plain-text summary

---

## Chat Bar Behavior

The chat bar is always visible at the bottom. It has four distinct behaviors:

### 1. Deeper question, same race
User: *"What does Moore say about climate change?"*
- New step added to receipt checklist: "⟳ Searching climate positions…"
- New evidence card appends below existing cards
- Brief grows. Nothing resets. Active race unchanged.

### 2. New race
User: *"Now show me WI-03"*
- Canvas clears and new receipt starts for WI-03
- Chat history remains visible in the chat bar (both races in history)
- Left panel updates to show WI-03

### 3. Journalist cross-race query (Journalist mode only)
User: *"Which swing-state incumbents are being outraised?"*
- Race table updates in place with filtered/sorted results
- Map heatmap re-colors to highlight matched states
- No new receipt — table responds directly

### 4. Guardrail — voting recommendation request
User: *"Who should I vote for?"*
- Canvas does not change
- Chat bar shows refusal response:
  > "DistrictLens doesn't make voting recommendations. My job is to show you what the evidence says, not tell you how to vote. I can compare Moore and Nath side by side on any issue you care about."
- Two quick-action chips: "Compare on housing →" / "Compare on economy →"

---

## Journalist Mode

Toggle: header pill switches from "Voter" → "Journalist" (amber color)

### Map changes
- Neutral grey → finance-gap heatmap
- States colored by competitiveness:
  - Green = safe (incumbent leading by >2× fundraising)
  - Amber = lean (within 2×)
  - Red = competitive (challenger outraising or within 10%)

### Canvas changes
- Switches from single-race receipt to race table
- Table columns: Race / State / Finance Gap / PAC % / Swing?
- Sortable by any column
- Click any row → canvas switches to single-race brief for that race (same Voter canvas)

### Chat in Journalist mode
- Cross-race queries update the table in place
- Single-race questions trigger a brief for that race
- Same guardrail applies

---

## Language Decisions

| Old | New | Why |
|-----|-----|-----|
| Mission | Start | Voter-accessible |
| Race Brief | Voter Brief | Personal, clear |
| Begin | Find My Race / Run | Action-oriented |
| Export markdown | Share brief | Non-developer language |
| Mission Panel | Start | Simpler |

---

## What Stays from v2

- Three-column layout (confirmed)
- ADK Python agent on Cloud Run (backend unchanged)
- CopilotKit + AG-UI wire protocol (unchanged)
- `useCoAgent` state sync (unchanged)
- All 14 tools (unchanged)
- Perplexity sonar-pro for position search (unchanged)
- MongoDB MCP partner integration (unchanged)
- Cloud Run deployment for both agent + web (unchanged)

---

## What Changes from v2

| Area | v2 | v3 |
|------|----|----|
| Empty state | Three blank columns | Canvas hero with centered CTA |
| Left panel label | Mission | Start |
| Mission names | Race Brief / Candidate / Journalist | Voter Brief / Research / Journalist |
| Card order in receipt | Candidates → Finance → Evidence | Evidence → Candidates → Finance |
| Receipt header | No timer | "~X sec left" |
| Complete state | No signal | Green bar + "Share brief" button |
| Guardrail UX | Text response only | Text + two quick-action chips |
| Export label | Export markdown | Share brief |

---

## Build Scope for Hackathon

### Must ship (demo-critical)
- Revised empty state with centered CTA
- Receipt mode with timer and evidence-first ordering
- Voter Brief: evidence → candidates → finance → legislation
- Guardrail with quick-action chips
- "Share brief" button (copy to clipboard is fine)

### Should ship (Journalist demo)
- Mode toggle (Voter / Journalist)
- Finance-gap heatmap on map
- Sortable race table
- Click row → drill into brief

### Cut if time is short
- Compare candidates side-by-side layout
- Saved briefs / user accounts
- Census district boundaries overlay
- PDF export
