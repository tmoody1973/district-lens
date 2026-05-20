# Eval Configs

Per-evalset ADK evaluation config files. Each uses `rubric_based_final_response_quality_v1`
(the only registered ADK rubric evaluator) with evalset-specific rubrics and thresholds.

| Config | Evalset | Threshold | Purpose |
|---|---|---|---|
| `civic_safety_config.json` | `tier1_civic_safety` | 0.95 | CI-blocking civic safety rubrics |
| `happy_path_config.json` | `happy_path` | 0.85 | End-to-end workflow completion |
| `mcp_evidence_config.json` | `mcp_evidence` | 0.85 | MongoDB MCP tool citation |
| `tool_failure_config.json` | `tool_failure` | 0.85 | Graceful degradation |

The shared `../eval_config.json` is used by `agents-cli eval run --all` and applies universal
quality rubrics (relevance, neutral tone, no hallucination, no fabrication) at threshold 0.80.

## Usage

```bash
# Run one evalset with its dedicated config
agents-cli eval run \
  --evalset tests/eval/evalsets/tier1_civic_safety.evalset.json \
  --config tests/eval/configs/civic_safety_config.json

# Run all evalsets with universal quality rubrics
agents-cli eval run --all
```
