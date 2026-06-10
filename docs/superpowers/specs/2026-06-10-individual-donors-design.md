# Individual Donors Tool + Generative Card — design

**Date:** 2026-06-10 · **Status:** Approved (Tarik, interactive brainstorm)
**Mission:** demo moment for the 2026-06-11 hackathon submission — a chat question
("Who are Gwen Moore's largest individual donors?") produces a live FEC tool call
with a visible trace and a polished generative card.

## Decisions (locked in brainstorm)

- **D1 — Scope:** minimal demo moment, ship tonight. One tool, one card. No
  employer/state aggregates, no bulk import.
- **D2 — Data shape:** transaction-level **largest itemized contributions**,
  one FEC API call sorted by amount desc, with a same-page dedupe that merges
  repeat contributions from the same donor name. NOT full per-person totals
  (would require paging the entire itemized set the night before deadline).
- **D3 — Approach:** agent-side ADK tool + `useRenderToolCall` card
  (Approach 1). Web-route and bulk-import approaches rejected: the first is
  invisible to judges (no agentic trace), the second is an overnight
  ingestion project.

## Tool contract (agent, Python)

`get_individual_donors(candidate_name: str, race_key: str) -> dict`

Pipeline (each step degrades to honest-empty, never raises):
1. Resolve our candidate doc from Mongo (`candidates` by `race_key` + name).
2. Resolve the FEC candidate id — from the candidate doc if the field exists
   (verify exact field name during planning), else FEC candidate search
   (`/candidates/search/` with name + state + office) as fallback.
3. Principal committee: `/candidate/{fec_id}/committees/?designation=P`.
4. Receipts: `/schedules/schedule_a/` with `committee_id`,
   `two_year_transaction_period=2026`, `is_individual=true`,
   `sort=-contribution_receipt_amount`, `per_page=~50`.
5. Dedupe by normalized contributor name within the fetched page: sum amounts,
   count transactions, keep latest date + employer/occupation/city-state.
   Return top ~10.
6. Cache the structured result in Mongo collection `fec_donor_cache`
   (agent-side; dedicated collection rather than overloading the web app's
   `evidence_cache`) with `retrieved_at`, TTL 24h. Cache key:
   `donors:{race_key}:{candidate_id}`.

Return shape:
```json
{
  "candidate": "Moore, Gwen S", "committee": "...", "cycle": 2026,
  "retrieved_at": "ISO", "cached": false,
  "donors": [{"name": "...", "employer": "...", "occupation": "...",
               "city_state": "Milwaukee, WI", "total": 6600,
               "transactions": 2, "latest_date": "YYYY-MM-DD"}],
  "coverage_note": "Largest itemized individual contributions, 2026 cycle.
                    Itemized = over $200; small-dollar donors are not itemized."
}
```
Empty/sparse candidates (e.g. low-fundraising challengers) → `donors: []` +
`coverage_note` explaining itemization thresholds — the honest-empty state.

Env: `FEC_API_KEY` (already provisioned for refresh jobs / Secret Manager).

## Generative card (web)

`DonorContributionsCard` in `web/src/components/canvas/`, registered in
`AgentToolTrace.tsx` via `useRenderToolCall({name: "get_individual_donors"})`
— identical mechanics to `FinanceToolCard` (status skeleton while executing,
card on complete).

- Header: "Largest individual contributions · FEC" + candidate name.
- Rows: donor name, amount (with proportional bar), employer · occupation,
  city/state, "{n} contributions" when deduped, latest date.
- Footer line 1: `Source: FEC API · retrieved {date}` (citation rule).
- Footer line 2 (guardrail, always visible): *"Public FEC record.
  Contributions provide context — they do not establish a candidate's policy
  positions."*
- Empty state: coverage_note rendered honestly, no padding.
- Styling: existing dark tokens (surface*/edge*/ink*), evidence-card language;
  follows FinanceToolCard, not a new visual system.

## Guardrails

- Tool docstring/description instructs the LLM: donor data is context; never
  infer or imply policy stances from contributions (mirrors
  `.claude/rules/civic_safety.md`, already enforced in SYSTEM_PROMPT).
- Display-only use satisfies FEC's prohibition on solicitation/commercial use
  of contributor lists.
- No donor data enters position evidence or the brief's positions sections.

## Testing

Agent unit tests: committee-resolution fallback (doc id missing → FEC search),
dedupe math (same name merges, ordering by total), empty result honest-empty,
cache hit skips API. Web: card render test (rows, guardrail footer, empty
state). All offline via injected fakes (existing test patterns).

## Out of scope

Employer/occupation/state aggregates (FEC by_* endpoints), full per-person
cycle totals, bulk Schedule A import, donor data in briefs/positions, PAC
committee receipts.
