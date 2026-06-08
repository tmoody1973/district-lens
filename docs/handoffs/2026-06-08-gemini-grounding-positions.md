# Handoff — Rebuild the positions "broad" tier on Gemini 3.5 Flash + Google Search grounding

**Repo:** `/Users/tarikmoody/Documents/Projects/districtlens` · branch `main` · GCP `civicsync-440613` / `us-central1`
**Date:** 2026-06-08 · **Author:** prior session (very long; this doc is the clean-context restart)

---

## THE NEXT TASK (why this handoff exists)

Rebuild the candidate-positions **broad** research tier to use **`gemini-3.5-flash` + Google Search
grounding** (one call: retrieve + structure + cite), **replacing** today's Perplexity-retrieve →
Gemini-structure path. This fixes low-profile challengers (Donahue, Nath) that the Perplexity API
literally cannot find, is ~43× cheaper, faster, gives citable sources, and is pure Google stack
(on-brand for the hackathon).

This is a **decision already made and empirically verified** — the work is the build, not more research.

---

## WHY (verified evidence, not assumption)

The voter brief showed empty positions for WI-04 challengers Amy Donahue (DEM) and Purnima Nath (REP),
while perplexity.com showed rich data. Root cause investigation + a head-to-head bake-off (all numbers
measured live this session, same prompt, same two candidates):

| Engine | Finds Donahue/Nath | Sources | Latency | ~Cost/candidate | One-call retrieve+structure+cite | Stack |
|---|---|---|---|---|---|---|
| Perplexity `sonar-pro` ×3 retries | ❌ unreliable | 2–7 | ~25s | ~$0.10 | no | Perplexity |
| Perplexity `sonar-deep-research` | ✅ | 32–56 | **195–237s** | **~$0.60** | no | Perplexity |
| **`gemini-3.5-flash` + grounding** | ✅ **both** | 6–17 | **~17–32s** | **~$0.014 (free <5k/mo)** | ✅ (few-shot JSON) | **Google** |

Key facts (all verified live on our Vertex stack):
- `gemini-3.5-flash` exists on Vertex (`location="global"`), grounding works, found BOTH candidates.
- Grounding sources are **real named domains** (ballotpedia.org, amydonahueforcongress.com,
  urbanmilwaukee.com, wispolitics.com, reddit.com) — NOT just Perplexity's prose.
- **Citability solved:** the grounding redirect URL `vertexaisearch.cloud.google.com/grounding-api-redirect/...`
  **resolves** via `httpx.get(uri, follow_redirects=True)` to the real page (verified HTTP 200 on a
  reddit.com source). So: grounding chunk → resolve redirect → fetch+store via evidence store → cite.
- **Grounding cost (verified):** Gemini 3 models = **$14 / 1,000 grounding queries, 5,000/month FREE**
  (Gemini 2.x is $35/1k). Token cost is negligible (~2,200 tokens/call incl. medium-thinking).
- Why Perplexity API fails: the perplexity.com *website* runs an agentic multi-step stack (Pro Search /
  Deep Research over hundreds of sources); the chat/completions **API** with `sonar-pro` does a single
  pass + has documented run-to-run variance. The API CAN match it via `sonar-deep-research`, but at
  ~$0.60/call. Gemini grounding beats all of it.

---

## THE VERIFIED RECIPE (works on our Vertex stack — copy this)

```python
import os, httpx
import google.genai as genai
from google.genai import types

client = genai.Client(vertexai=True, project=os.environ["GOOGLE_CLOUD_PROJECT"], location="global")

cfg = types.GenerateContentConfig(
    tools=[types.Tool(google_search=types.GoogleSearch())],       # the retrieval engine (proven)
    thinking_config=types.ThinkingConfig(thinking_level="MEDIUM"),# Tarik's "medium thinking"
    # NOTE: response_schema + tools can conflict. Structure via FEW-SHOT instead:
    # include a prior model turn showing one example JSON, and responseMimeType text/plain.
)
resp = client.models.generate_content(model="gemini-3.5-flash", contents=prompt, config=cfg)

answer = resp.text
gm = resp.candidates[0].grounding_metadata
chunks = [(c.web.title, c.web.uri) for c in (gm.grounding_chunks or []) if getattr(c, "web", None)]
# title is the real domain (e.g. "ballotpedia.org"); uri is the redirect.
# Resolve to the real source URL for the citation/archive pipeline:
real_url = str(httpx.get(chunks[0][1], follow_redirects=True, timeout=15).url)
```

- Installed `google-genai` supports `thinking_level` (LOW/MEDIUM/HIGH), `Tool(google_search=...)`,
  and `Tool(url_context=...)`. Confirmed via `types.ThinkingConfig.model_fields`.
- **Structured output:** use the **few-shot** pattern from Tarik's AI Studio export (a prior `model`
  turn containing one example JSON + `responseMimeType: text/plain`). Do NOT use `response_schema`
  together with `tools` (conflicts in some SDK versions). Alternatively: grounded `gemini-3.5-flash`
  call to get prose+sources, then a SECOND `gemini-3.1-pro-preview` call with `response_schema` to
  structure (no tools on the second call → schema is allowed). Pick one; few-shot is one fewer call.
- `url_context` tool (what Tarik's playground export used) is an alternative/complement — it reads
  specific URLs. `google_search` (what I verified) searches broadly. Best combo if needed: `google_search`
  to find + `url_context` seeded with the candidate's stored `ballotpedia_profile_url` to force-read the
  authoritative page. Start with `google_search` alone — it already pulled ballotpedia + the campaign site.

---

## BUILD PLAN (TDD — this repo is strict TDD)

1. **New retrieval fn** in `agent/app/services/positions/` (e.g. `gemini_ground.py`): `ground_candidate_positions(candidate)`
   → calls the recipe above, returns `(answer_or_cards, grounding_chunks)`. Inject the genai client/call so
   unit tests run network-free (mirror how `research.py` injects `search_fn`/`structure_fn`).
2. **Citation wiring:** resolve each grounding redirect → real URL → `fetch_and_store_source` (existing
   evidence store, `agent/app/services/evidence/store.py`) → attach `sourceDocumentId` to each position's
   sources (the T4 source shape). This satisfies `citations.md` (fetch+store before citing).
3. **Wire into the broad tier:** in `research.py`, make `tier="broad"` use the Gemini-grounding path
   instead of (or before) the Perplexity `_broad_search`. Keep `_is_total_non_answer` / no-info gating
   and the `_fallback_card`-drop. Reuse the existing `upsert_positions` guard (never clobber found→empty).
4. **Structuring:** few-shot JSON (one call) OR grounded-retrieve then `gemini-3.1-pro-preview` structure
   (two calls, schema allowed). Map to the positions shape `{issue, answer, evidenceType, sources}`.
5. **Keep the warm job** (`app/jobs/refresh_positions.py`) — it already calls `research_candidate_positions(tier="broad")`,
   so once the broad tier swaps engines, the deployed warm job uses Gemini automatically. Re-warm WI-04 + IL-07.
6. **Tests:** unit-test the new fn (injected fake genai), the redirect→cite mapping, the no-info gating.
   Run `cd agent && uv run pytest tests/unit/ -q` (currently 323 green) + `uvx ruff check`.

---

## CURRENT SHIPPED STATE (don't re-discover)

- **Broad tier exists** — `agent/app/services/positions/research.py::research_candidate_positions(tier="broad")`:
  today it does Perplexity `_broad_search` (district + Ballotpedia-anchored prompt) → `structure_positions`
  (Gemini) → per-issue cards, with regex no-info gating + "key positions" fallback-drop + curly-apostrophe
  fix. Shipped `dfbe3e0`. **This is the thing to re-point at Gemini grounding.** Memory: [[districtlens_positions_broad_tier]].
- **Warm job deployed** — `app/jobs/refresh_positions.py` warm mode (`select_race_candidates` + `force_tier="broad"`
  + skip-fresh + `ballotpedia_url`). Cloud Run job `districtlens-agent-refresh-positions` image
  `refresh-positions:113fa65`, env `POSITIONS_REFRESH_TIER=broad` + `POSITIONS_REFRESH_RACES` (TF var
  `positions_warm_races` = "2026-H-WI-04,2026-H-IL-07"), weekly Mon 11:00 UTC. Commits `113fa65` + `9e0c71a`.
  A run warmed both races (11 researched, 17 skipped, 0 errors). `terraform plan` clean.
- **Live now (Perplexity-warmed):** WI-04 Moore 5 issues / Dixon 3 / Nath+Donahue empty; IL-07 17 candidates
  with positions. These will improve once the broad tier swaps to Gemini grounding and re-warms.
- **Ballotpedia MCP** vendored discovery-only (parallel session, commit `b525091`) — has Nath's full platform;
  complementary source. Memory: [[districtlens_ballotpedia_mcp]].
- **UNCOMMITTED:** the model-mandate update in `CLAUDE.md` (this session). Commit it with the rebuild.

---

## OPEN ITEMS / DECISIONS

- **Model mandate: DONE** — `CLAUDE.md` now approves `gemini-3.5-flash` for grounded retrieval only,
  `gemini-3.1-pro-preview` everywhere else. (Commit the change.)
- **Few-shot vs two-call structuring** — pick during build (few-shot = 1 call, cheaper; two-call = cleaner
  schema). Lean few-shot per Tarik's working playground recipe.
- **Scope** — start with the demo set (WI-04 + IL-07, FREE under 5k grounding/mo), then expand the
  `positions_warm_races` TF var. Nationwide is now affordable too ($14/1k after the free tier).
- **Nath specifically** — even Gemini grounding should get her (Ballotpedia has her 2,000-char platform);
  verify after the swap. Ballotpedia MCP is the backstop.

---

## GOTCHAS

- **Local Perplexity key in `agent/app/.env` is STALE (401).** For any Perplexity test use Secret Manager:
  `export PERPLEXITY_API_KEY="$(gcloud secrets versions access latest --secret=districtlens-perplexity-key --project civicsync-440613)"`.
  (The new Gemini path needs no Perplexity key.)
- **Vertex creds for local runs:** `export GOOGLE_CLOUD_PROJECT=civicsync-440613 GOOGLE_CLOUD_LOCATION=global`;
  ADC via `gcloud auth` (already set — used for warming this session).
- **Live Mongo poke:** throwaway script loads `agent/app/.env` then `MongoClient(os.environ["MONGODB_URI"])["districtlens"]`.
- **Deploy mechanics:** job image = `gcloud builds submit agent --tag us-central1-docker.pkg.dev/civicsync-440613/districtlens-agent/refresh-positions:$(git rev-parse --short HEAD)`
  then `gcloud run jobs update districtlens-agent-refresh-positions --image <that> --region us-central1`.
  Job env/schedule via `terraform apply -var-file=vars/local.tfvars` in `agent/deployment/terraform/single-project`.
  Image is `ignore_changes` in TF — keep `terraform plan` clean. Memory: [[districtlens_terraform_deploy_gotcha]], [[districtlens_deploy_mechanism]].
- **Trigger a warm run:** `gcloud run jobs execute districtlens-agent-refresh-positions --region us-central1 --project civicsync-440613`.
- Strict TDD; `gemini-3.1-pro-preview` mandate (now + `gemini-3.5-flash` for grounding); explain
  ADK/Gemini concepts in plain English before implementing ([[feedback_plain_english]]).

## KEY FILES

- `agent/app/services/positions/research.py` — broad tier (re-point at Gemini grounding)
- `agent/app/services/positions/store.py` — cache + found-over-empty guard
- `agent/app/services/evidence/store.py` — `fetch_and_store_source` (citation archiving)
- `agent/app/tools/position_search.py` — Perplexity client + `structure_positions` (Gemini structurer, reusable)
- `agent/app/jobs/refresh_positions.py` — warm job (already calls tier="broad")
- `agent/app/tools/brief_pipeline.py` — reads cache, lazy-fills (shallow), archives cited sources
- `agent/deployment/terraform/single-project/positions_job.tf` + `variables.tf` (`positions_warm_races`)
- Throwaway test scripts from this session: `/tmp/gemini_medium.py`, `/tmp/bakeoff.py`, `/tmp/gemini_ground.py`
