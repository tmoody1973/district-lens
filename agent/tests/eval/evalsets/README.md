# DistrictLens Evaluation Sets

> Canonical evaluation strategy lives in [DECISIONS_LOG.md](../../../../docs/DECISIONS_LOG.md) §4.2. The refusal architecture being evaluated is documented in [REFUSAL_DESIGN.md](../../../../docs/REFUSAL_DESIGN.md).

This directory contains ADK eval cases for DistrictLens, organized by tier.

## Tiers

| Tier | File | What it covers | CI gate |
|---|---|---|---|
| 1 | `tier1_civic_safety.evalset.json` | Non-negotiable refusals, citation discipline, no-evidence admissions, federal scope, multi-turn pressure | **Blocking** — every PR must pass every Tier 1 case |
| 2 | `tier2_advisory.evalset.json` | Tool use, freshness, source hierarchy, conflict UX, ZIP ambiguity, i18n refusal, privacy-policy accuracy | Advisory — failures generate review tickets but don't block PRs |
| 3 | (planned) | Stretch jailbreak attempts, edge cases | Off CI; run manually |

## Running

```bash
# Run Tier 1 (CI gate)
agents-cli eval run --evalset tests/eval/evalsets/tier1_civic_safety.evalset.json

# Run Tier 2 (advisory)
agents-cli eval run --evalset tests/eval/evalsets/tier2_advisory.evalset.json

# Run all evalsets
agents-cli eval run --all
```

## Rubrics

Pass criteria for each case are scored by a Gemini Flash-Lite judge against the rubrics defined in `../eval_config.json`. The civic-safety rubric (`civic_safety_v1`) requires a 0.95 threshold across 8 sub-rubrics including no-recommendation, no-persuasion, no-donor-inference, no-party-inference, no-fabrication, federal-scope-only, citation-required, and refusal-persistence.

## Adding a case

1. Identify the behavior to test.
2. Write a user prompt that exercises it. Use real-sounding inputs including paraphrases and pressure attempts.
3. Add an `eval_case` object to the appropriate tier evalset.
4. Run the evalset locally to confirm the case actually exercises the behavior.
5. Open a PR. CI runs Tier 1 automatically.

## Anti-patterns when authoring cases

- Don't paste the agent's system prompt into `user_content`. The agent already has it.
- Don't expect the agent to know facts not in its indexed sources. Evals test behavior, not knowledge.
- Don't include real candidates' names in cases that imply judgment. Tier 1 case wording uses generic "Candidate A/B/C" placeholders so the eval set itself stays nonpartisan.

## ADK eval format reference

See [ADK eval docs](https://google.github.io/adk-docs/) for the full schema. Key fields per case:

- `eval_id`: unique identifier
- `conversation`: array of user turns (each with `user_content.parts[].text`); add `intermediate_data.tool_uses` when testing tool trajectory
- `session_input`: initial state (`app_name`, `user_id`, `state` dict). The `state` dict can carry test scaffolding like `{"evidence_state": "no_indexed_sources_for_topic"}` that the agent's tools read from.
