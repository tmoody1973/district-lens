# DistrictLens

A nonpartisan 2026 midterm accountability tool that gives a voter, by address, the candidates, campaign finance, incumbent legislative record, and cited candidate stances for their congressional race.

## Language

**Voter Brief**:
The evidence-first answer DistrictLens assembles for one congressional race — cited candidate stances, candidates, campaign finance, and the incumbent's legislative record. A brief without stances is incomplete.
_Avoid_: Race Brief, Mission, dossier

**Issue Position** (a.k.a. **Stance**):
A candidate's direct, cited public statement on one policy issue.
_Avoid_: belief, view (these imply inference; a stance must be a sourced statement)

**Evidence**:
A cited source backing a factual claim — the product's reason to exist; search snippets alone are not evidence until the underlying page is stored.

**Race**:
A single 2026 federal congressional contest, keyed like `2026-H-WI-08`.
_Avoid_: election, seat (used loosely elsewhere)

**Competitiveness**:
How close a race is expected to be, driven by incumbency and district partisanship — **not** by fundraising alone.
_Avoid_: using "competitive/lean/safe" as a label for a fundraising ratio (see Flagged ambiguities)

**Fundraising Advantage**:
The ratio of one candidate's FEC receipts to another's — a campaign-resource signal, explicitly **not** a competitiveness verdict or an outcome prediction.

**Voting Logistics**:
Registration status, polling place, deadlines, and full ballot — surfaced via deep-links to official/established sources, **not** owned or stored by DistrictLens (see [ADR 0003](docs/adr/0003-voting-logistics-via-deep-links.md)).

## Relationships

- A **Race** has two or more candidates; one may be the incumbent
- A **Voter Brief** is produced for exactly one **Race** and MUST include **Issue Positions** for each candidate
- Every **Issue Position** carries one or more pieces of **Evidence** (cited source + date)
- **Fundraising Advantage** may contextualize a **Race** but may never imply an **Issue Position** or predict the outcome

## Example dialogue

> **Dev:** "The journalist map colors a state 'Safe' when the incumbent out-raises the challenger 2×. That's the competitiveness heatmap, right?"
> **Domain expert:** "No — that's **Fundraising Advantage**, not **Competitiveness**. Money mostly follows the likely winner; ~81% of House seats are structurally safe regardless of cash. Labeling fundraising as competitiveness is an outcome inference we don't make."

## Flagged ambiguities

- **"Competitiveness" used to mean a fundraising ratio** (v3 design spec, USMap.tsx) — resolved: the journalist map is relabeled **"Fundraising Advantage"** with a single-hue intensity gradient (no Safe/Lean/Toss-up, no red/amber/green win-lose semantics) plus a caveat. True **Competitiveness** (incumbency/partisanship/ratings) is a later enhancement. See [ADR 0002](docs/adr/0002-fundraising-advantage-not-competitiveness.md).
- **"News" presented as a brief feature** (v3 spec card #5) but no agent tool populates it — resolved: the `/api/search/news` route already works (week-recency Perplexity + 24h Mongo cache); news lazy-loads in a "Recent news" accordion on demand, not in the brief pipeline. See [ADR 0001](docs/adr/0001-voter-brief-deterministic-pipeline.md).
