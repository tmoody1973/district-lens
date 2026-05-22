---
task: add gemini search grounding test to compare perplexity
slug: 20260522-153000_gemini-grounding-test
effort: standard
phase: complete
progress: 9/9
mode: interactive
started: 2026-05-22T15:30:00Z
updated: 2026-05-22T15:35:00Z
---

## Context

Adding a Gemini 3.1 Pro with Google Search Grounding test to `agent/scripts/test_position_search.py`.
The existing script tested sonar-pro (14% hit rate) vs sonar-deep-research (100% hit rate).
Now testing Gemini as a potential fallback/comparison. GCP project: civicsync-440613, location: global.
SDK confirmed: google.genai available via uv env, async client works.

### Risks
- Grounding metadata structure may differ from documented — defensive getattr needed
- Gemini grounding chunks don't include source dates — fresh_sources will always be 0
- Google Search grounding may be rate-limited on Vertex AI free tier
- DynamicRetrieval may be needed to ensure search always fires

## Criteria

- [x] ISC-1: `query_gemini_grounding` async function added using `client.aio.models.generate_content`
- [x] ISC-2: Function uses `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` env vars (not hardcoded)
- [x] ISC-3: Function raises `RuntimeError` if `GOOGLE_CLOUD_PROJECT` not set
- [x] ISC-4: `types.Tool(google_search=types.GoogleSearch())` passed in `GenerateContentConfig`
- [x] ISC-5: Grounding chunks extracted from `candidate.grounding_metadata.grounding_chunks`
- [x] ISC-6: Sources normalized to `{"url": ..., "title": ..., "date": ""}` so `score_result` reuses without change
- [x] ISC-7: `run_single_test` branches on `model == "gemini-search-grounding"` to call correct function
- [x] ISC-8: `main()` accepts `--models` CLI arg so user can run only Gemini without re-running Perplexity
- [x] ISC-9: Script ran successfully for all 7 candidates — 100% hit rate, 28.3s avg latency

## Decisions

## Verification
