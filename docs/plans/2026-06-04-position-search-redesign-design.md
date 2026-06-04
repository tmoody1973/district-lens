# Position Search Redesign — Cached, Evidence-Extracted Positions

**Date:** 2026-06-04 · **Status:** DESIGN (validated, not started) · **Author:** brainstorming session
**Related:** `docs/plans/PHASE1_FIRECRAWL_EVIDENCE.md` (evidence store T1–T4, shipped), `docs/MCP_INTEGRATION_RESEARCH.md`, `.claude/rules/citations.md` + `civic_safety.md` + `data_integrity.md`

## Problem

The voter brief's "Key Positions" cards frequently return empty walls of model
search-narration ("Searches for X, Y, Z do not return…") even for real candidates.
Root causes, grounded in `agent/app/tools/position_search.py`:

1. **One broad shotgun query per candidate** — all 11 issues in a single Perplexity
   call capped at `max_tokens: 1500`. Too much for one shot; truncates/hedges.
2. **Weak disambiguation** — the prompt injects only name + state, never office /
   district / party / cycle (all available via `race_key` + candidate fields). The
   model can't identify obscure candidates → "no records." (Identity failure, not a
   positions failure.)
3. **One shot, no iteration** — no source discovery, no per-issue follow-up.
4. **Never reads the candidate's actual page** — relies on snippet-level synthesis;
   never fetches the campaign site / questionnaire (the one thing the evidence store
   was built to do).
5. **Surfaces the model's search monologue** as the card body — reads as broken.

Manual research on perplexity.com works better because it disambiguates, finds the
primary sources, and queries per-issue. This redesign makes the app do the same.

## Validated decisions (brainstorming)

| Decision | Choice |
|---|---|
| Win condition | **Robust across the field** — graceful everywhere, tiered by candidate, breadth + correctness |
| Execution model | **Cached + job-refreshed** — positions precomputed into a Mongo `candidate_positions` cache; the brief reads the cache |
| Retrieval strategy | **Hybrid discover → Firecrawl-extract** — find primary sources, scrape the real pages (archived), extract per-issue from page text |
| Coverage / cost | **Tiered + lazy on-demand** — scheduled deep-refresh for a priority set; long tail filled on first view + written through; Firecrawl budget via dedup + caps + downgrade-near-cap |

## Architecture & data flow

```
refresh_positions JOB (scheduled, priority set)  ─┐
on-demand fallback (brief cache-miss, long tail) ─┼─→ research_candidate_positions(candidate, tier)
                                                   │      1. disambiguate (name+office+district+party+cycle)
                                                   │      2. DISCOVER sources (Perplexity) → URLs
                                                   │      3. rank → pick primary sources
                                                   │      4. Firecrawl scrape top N → source_documents (archived ✓)
                                                   │      5. Gemini extract per-issue FROM scraped text
                                                   │      6. graceful degrade (shallow fan-out → honest empty)
                                                   └─→ write candidate_positions cache (per candidate)

VoterBriefPipeline.positions step:
   read candidate_positions (fast)  ──hit──→ render EvidenceCards (archived citations)
                                     ──miss─→ shallow on-demand research, write-through, fill next view
```

Research moves **out of the live brief into a per-candidate cache**, exactly like the
FEC/Congress data pattern. The brief's positions step becomes a fast cache read instead
of a ~25s live Perplexity sweep. `research_candidate_positions` is the single reusable
unit shared by the job and the lazy path.

## Data model — `candidate_positions` (new collection)

```python
candidate_positions {
  candidate_id, race_key, candidate_name,
  researched_at,            # freshness (drives scheduled refresh + lazy TTL)
  research_tier,            # "deep" | "shallow" | "discovery_only"
  disambiguation,           # resolved entity string used in queries (audit)
  status,                   # "found" | "no_positions_found"
  positions: [ {
      issue,
      answer,               # extracted stance
      evidenceType,         # direct_quote | questionnaire | voting_record | reported
      sources: [ { title, url, date, snippet,
                   archived, archivedAt, sourceDocumentId } ]   # T4 shape — badge works
  } ],
  content_hash,             # research-output hash → change detection
  retrieval_history: [...]  # append-only audit, like source_documents
}
```
**Indexes:** `{candidate_id: 1}`, `{race_key: 1}`, `{researched_at: -1}`.

- **Reuses the T4 `EvidenceCard` source shape verbatim** → zero frontend change; each
  position cites an archived `source_documents` page and "archived ✓" lights up for free.
- **`evidenceType` is driven by source provenance**, not a guess: candidate's own
  site/press release → `direct_quote`; VOTE411 / Ballotpedia Candidate Connection / LWV →
  `questionnaire`; incumbent record → `voting_record`; news/interview → `reported`.
- **Append-only `retrieval_history` + `content_hash`** mirror the evidence store:
  unchanged positions don't churn; a changed platform appends history (date-aware).

## The research pipeline (`research_candidate_positions`)

Six graceful steps:

1. **Disambiguate** — entity string from existing data: name (strip Mr./Dr.) + office
   (H/S from `race_key`) + district + state + party + cycle. Used in every query. The
   single biggest fix for "can't identify the candidate."
2. **Discover** (Perplexity) — query to *find sources*, not summarize: campaign site,
   Ballotpedia Candidate Connection, VOTE411/LWV, recent news → URLs. Deep tier may use
   `perplexity_research` for low-footprint names.
3. **Rank sources** — positions-specific scorer (distinct from the election-results one):
   candidate's own domain > questionnaire > news/interview; aggregators denied as
   *primary*. Pick top N (tier-dependent).
4. **Scrape** top N via `fetch_and_store_source` → archived `source_documents`. Failures
   drop that source.
5. **Extract** (Gemini) from the **scraped page text** (not snippets): per-issue stances,
   each tagged `evidenceType` by source, citing the archived doc. **Hard guardrail: only
   extract a stance the page text actually supports; else `no_positions_found`. Never
   infer.** (citations.md spine.)
6. **Degrade gracefully** — no primary sources / all scrapes fail → shallow per-issue
   Perplexity fan-out (`evidenceType: reported`); still nothing → clean honest-empty.

**Tiers:** `deep` (discover+scrape+extract — incumbents, nominees, funded, on-demand
views) · `shallow` (per-issue fan-out, no scrape) · `discovery_only` (honest empty + any
links found).

## Refresh, triggers & cost control

- **`refresh_positions` Cloud Run Job + Scheduler** (mirrors `refresh_fec`/`resolve_nominees`)
  refreshes the **priority set** (incumbents + confirmed nominees + top-funded/competitive)
  ~weekly.
- **Lazy on-demand fill** for the long tail: brief cache-miss → shallow research +
  write-through; `researched_at` TTL (~14–30d) before re-research.
- **Cross-thread link:** when `resolve_nominees` confirms a nominee post-primary, enqueue
  a **deep re-research** of that nominee (now relevant for the general).
- **Firecrawl budget (1,000/mo):** evidence-store dedup (popular questionnaire/Ballotpedia
  pages fetched once, reused across candidates) + per-candidate source cap (deep = 3) +
  **monthly-usage guard that downgrades deep→shallow near the cap** (never fails). Priority
  set sized so scheduled spend ≪ budget; lazy fill bounded by real views.

## Brief integration & empty-state UX

- Positions step = cache read → flatten to `EvidenceCard`s (unchanged shape) → render with
  archived badges. Cache-miss → fire shallow on-demand + write-through, awaited with a short
  timeout; if slow, return what's there and fill on next view. **Never blocks or fails the
  brief.**
- **Empty-state cleanup:** extraction returns clean structured stances or a structured
  empty — never the model's search monologue. A no-footprint candidate renders one crisp
  line: *"No public positions found in indexed sources yet"* + discovered links + *"filed
  {date}"*. Significant perceived-quality win on its own.

## Testing & guardrails

- **Unit (all network mocked**, like `test_citation_fetch` / `test_evidence_store`):
  disambiguation builder (office/district/party present); positions source-ranker (own-site
  > questionnaire > news; aggregators denied); **extraction guardrail** (no supporting text
  → `no_positions_found`); tier selection; cache TTL/freshness; each graceful fallback.
- **Civic-safety** (`.claude/rules`): no donor/party→position inference; `evidenceType`
  honesty; missing evidence explicit; every rendered position cites a stored (archived)
  source.
- **Cost:** budget-guard test (near cap → deep downgrades to shallow).

## Out of scope (YAGNI)

- No new frontend components — reuses `EvidenceCard` + T4 source shape.
- No change to the election-results `citation_fetch` / `pick_authoritative_url` path.
- Top-two/jungle-primary nominee handling lives in the separate primary-lifecycle thread.

## Rollout sequence (for the implementation plan)

1. `candidate_positions` schema + cache store (TDD, mocked).
2. `research_candidate_positions` unit: disambiguate → discover → rank → scrape → extract,
   with tier + graceful fallbacks (TDD, Perplexity + Firecrawl injected).
3. `refresh_positions` job + Scheduler (Terraform) + budget guard.
4. Brief positions step → cache read + lazy write-through.
5. Empty-state extraction cleanup.
6. Nominee-confirmed → deep re-research enqueue (link to primary thread).
```
