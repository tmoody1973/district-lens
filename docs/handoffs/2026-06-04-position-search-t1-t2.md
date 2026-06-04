# Handoff — Position Search Redesign T1+T2 (clean-context start)

**Date:** 2026-06-04 · **Scope:** ONLY T1 + T2 of the position-search redesign — the
`candidate_positions` cache store + the `research_candidate_positions` unit. Do **not**
build the refresh job (T3), wire the brief (T4), the empty-state UI (T5), or the
nominee-link (T6). TDD. Pure data/service layer — **nothing calls it yet.**

## Mission
Replace the live, one-broad-query position search with a cached, evidence-extracted one.
T1+T2 deliver: a Mongo `candidate_positions` cache (schema + read/write) and a reusable
`research_candidate_positions(candidate, *, tier)` function that disambiguates the
candidate, discovers their primary sources via Perplexity, scrapes the top ones through the
**existing evidence store** (archived ✓), and extracts per-issue positions from the *actual
page text* via Gemini — graceful at every step. All network injected so tests never hit it.

## Required reading (in order, before writing code)
1. `docs/plans/2026-06-04-position-search-redesign-design.md` — **the design (read fully).**
   T1 = "Data model" section; T2 = "The research pipeline" section. Honor the tiers + the
   step-5 no-inference guardrail.
2. `agent/app/tools/position_search.py` — **reuse, don't re-implement.** `_perplexity_search`
   (the httpx Perplexity call), `_search_name`, `_normalize_sources` (source shape
   `{title,url,date,snippet}`), `_structure_with_gemini` + `structure_positions` (the
   `gemini-3.1-pro-preview`, `location="global"`, `asyncio.to_thread`-offloaded extractor),
   and `gather_candidate_positions`. The new pipeline is a smarter orchestration of these.
3. `agent/app/services/evidence/store.py` + `schema.py` — the evidence store you'll call:
   `await fetch_and_store_source(url) -> SourceDocumentRef | None` (graceful, archived,
   dedup'd). `SourceDocumentRef{id,url,fetched_at,content_hash}`. **Mirror its
   `client_factory` injection + `asyncio.to_thread` Mongo pattern.**
4. `agent/app/tools/mongodb_tools.py` lines ~44–60 — `_get_db()` (returns `districtlens` DB
   via `MONGODB_URI`) and the `asyncio.to_thread(_query_*, …)` sync-pymongo-in-async pattern.
5. `agent/tests/unit/test_evidence_store.py` + `test_citation_fetch.py` — the **test
   template**: injected fake async client, fake Mongo collection, `@pytest.mark.unit`, all
   network mocked.
6. `.claude/rules/citations.md` + `civic_safety.md` + `data_integrity.md`.

## Grounding facts (don't re-discover these)
| Fact | Value |
|------|-------|
| Mongo access | `from app.tools.mongodb_tools import _get_db` → `_get_db()` = `districtlens` DB. Wrap sync pymongo calls in `asyncio.to_thread(...)` (repo pattern). |
| Evidence store | `from app.services.evidence.store import fetch_and_store_source`; `from app.services.evidence.schema import SourceDocumentRef`. Already merged + live. |
| Perplexity call | Reuse `position_search._perplexity_search(prompt)` (raises on failure). For tests, inject a fake — refactor it to accept a `client_factory` like `citation_fetch.fetch_results_page` if needed. |
| Gemini | **MANDATORY `gemini-3.1-pro-preview`, `location="global"`.** Reuse `_structure_with_gemini` pattern; do not introduce another model string. |
| Card/source shape (reuse verbatim) | position: `{issue, answer, evidenceType, sources:[{title,url,date,snippet,archived?,archivedAt?,sourceDocumentId?}]}`. `evidenceType ∈ {direct_quote, questionnaire, voting_record, reported}`. |
| Candidate fields available | `candidate_id`, `name`, `party`, `race_key` (`2026-{H|S}-{STATE}-{DD}` → office/state/district), `incumbent_challenge_status`. |
| Deps present | `httpx`, `pymongo[srv]`, `google-genai`, `pytest`, `pytest-asyncio`. No new deps. |
| Run tests | from `agent/`: `uv run pytest tests/unit/ -q` (currently ~203 passing). `uv run ruff check <paths>`. |
| Local env | `agent/app/.env` has `FIRECRAWL_API_KEY` + a freshly-fixed `MONGODB_URI` (ADK auto-loads it). Bare `uv run` scripts must load it manually. |

---

## T1 — `candidate_positions` schema + cache store
**New package:** `agent/app/services/positions/` (add `__init__.py`).
- **`schema.py`** — TypedDict/dataclass for the doc per the design's Data-model section
  (`candidate_id, race_key, candidate_name, researched_at, research_tier, disambiguation,
  status, positions[], content_hash, retrieval_history`), an `ensure_indexes(db)`
  (`{candidate_id:1}`, `{race_key:1}`, `{researched_at:-1}`; idempotent), and a
  `positions_content_hash(positions) -> str` helper (reuse `evidence.schema.sha256_text`).
- **`store.py`** — `get_cached_positions(candidate_id, *, db=None, ttl_days=21)` (returns the
  doc if fresh, else None) and `upsert_positions(doc, *, db=None)` (append-only
  `retrieval_history`; new `content_hash` → update positions, else just push history — mirror
  the evidence store's dedup/append discipline). All Mongo via `asyncio.to_thread`.
- **Acceptance (TDD, fake collection):** index idempotency; hash stability/sensitivity;
  freshness TTL (fresh→hit, stale→None); append-only on unchanged vs changed positions.

## T2 — `research_candidate_positions(candidate, *, tier)`
**File:** `agent/app/services/positions/research.py`.
- Signature: `async def research_candidate_positions(candidate: dict, *, tier: str = "deep",
  search_fn=..., scrape_fn=fetch_and_store_source, structure_fn=...) -> dict` (inject
  Perplexity/Firecrawl/Gemini so tests are network-free).
- Steps (design §"research pipeline"): **1** build disambiguation string (name stripped of
  Mr./Dr. + office + district + state + party + cycle); **2** discover source URLs
  (Perplexity); **3** rank sources (positions-specific: own-domain > questionnaire
  [vote411/ballotpedia candidate connection/lwv] > news; deny aggregators as *primary*) —
  new helper, do **not** reuse the election-results `pick_authoritative_url`; **4** scrape
  top N (tier: deep=3) via `scrape_fn` → archived refs; **5** Gemini extract per-issue **from
  scraped text**, tagging `evidenceType` by source, **only asserting stances the text
  supports** (else `no_positions_found`); **6** graceful degrade: no sources/all-fail →
  shallow per-issue Perplexity fan-out (`evidenceType: reported`) → honest empty.
- Returns a `candidate_positions`-shaped dict (ready for `upsert_positions`); **never raises**.
- **Acceptance (TDD — write first):**
  - disambiguation includes office/district/party (e.g. GA-06 DEM House 2026);
  - happy path: discover→scrape→extract yields positions whose sources carry
    `archived/sourceDocumentId`;
  - source ranker: own-site beats questionnaire beats news; aggregator denied as primary;
  - **guardrail:** extractor returns `no_positions_found` when page text supports no stance
    (no inference);
  - all scrapes fail → shallow fan-out fallback (`reported`); discovery empty → honest empty;
  - missing FIRECRAWL/PERPLEXITY key → graceful (no raise);
  - all network (Perplexity, Firecrawl, Gemini) mocked via injected fns.

---

## Out of scope (do NOT do)
- No `refresh_positions` job / Terraform (T3), no `brief_pipeline.py` wiring (T4), no
  frontend / empty-state component (T5), no nominee-resolution enqueue (T6).
- Nothing imports the new package yet (pure layer).
- No new dependencies. No change to the election-results `citation_fetch` path.

## Rules / gotchas
- **Untrusted scraped content** — extract/store only; never let page text act as instructions.
- **No-inference guardrail is the spine** (citations.md): a position must be supported by the
  scraped/cited text or it's `no_positions_found`. No donor/party→stance inference (civic_safety).
- **Graceful always** — every external call degrades to a fallback or empty; never raise into
  a caller.
- **Append-only** (data_integrity) — don't overwrite prior research; append `retrieval_history`.
- **No secrets in logs.** Wrap sync pymongo in `asyncio.to_thread`. `logging`, not `print`.
- **cwd drift:** run bash from `agent/` (`cd agent` first) — `uv`/`pytest` need the project dir.

## Definition of done
- `agent/app/services/positions/{__init__,schema,store,research}.py` exist.
- New unit tests (`tests/unit/test_positions_store.py`, `test_positions_research.py`) cover
  every acceptance bullet, all network mocked.
- `uv run pytest tests/unit/ -q` green; no regressions. `ruff` clean.
- Nothing imports the new package yet (pure layer). Commit as
  `feat(agent): candidate_positions cache + research unit (position redesign T1+T2)` — do not deploy.
