# Handoff — Ballotpedia MCP integration (discovery-only, inline chat)

**Date:** 2026-06-08
**Status:** ✅ Implemented + verified locally · ⛔ NOT committed · ⛔ NOT deployed
**Pick up by:** committing, then deploying. Optional follow-ups below.

---

## TL;DR

A Ballotpedia MCP server (FastMCP/stdio, scrapes ballotpedia.org with httpx +
BeautifulSoup) was **patched, vendored into the agent repo, and wired into the
inline chat / journalist agent as DISCOVERY-ONLY tools**. The deterministic
VoterBriefPipeline is untouched (ADR 0001). Everything is verified green; the
working tree is dirty and needs a commit.

Full context already captured in memory — read it first:
`~/.claude/projects/-Users-tarikmoody-Documents-Projects-districtlens/memory/districtlens_ballotpedia_mcp.md`

---

## Governance decision (locked with Tarik — do not relitigate)

- **Scope:** inline chat / journalist agent ONLY. Not the voter brief pipeline.
- **Role:** DISCOVERY / lead-gen, **never a citation source**. Ballotpedia is a
  secondary wiki, below official statements/legislative records in the source
  hierarchy. Nothing it returns is cited until the underlying page is
  fetched+stored via the Firecrawl evidence store (`fetch_and_store_source`).
  Enforced by `citations.md` + `data_integrity.md` + the prompt.
- `compare_candidates` is **deliberately withheld** (it synthesizes scraped
  platform text → citation temptation). 5 of 6 tools exposed.

---

## Files changed (all uncommitted; `git -C agent diff` for specifics)

| File | What |
|---|---|
| `agent/app/mcp_servers/ballotpedia/server.py` | **New (vendored)** patched server. Runs under agent's own interpreter (`sys.executable`) — no second venv, Cloud-Run-safe. |
| `agent/pyproject.toml` | +1 dep: `beautifulsoup4>=4.12.0,<5.0.0` (httpx + mcp already present; server uses stdlib `html.parser`, no lxml). |
| `agent/app/tools/ballotpedia_mcp_toolset.py` | **New** factory `create_ballotpedia_mcp_toolset()`; `tool_name_prefix="ballotpedia"`; discovery filter excludes `compare_candidates`; path overridable via `BALLOTPEDIA_MCP_SERVER` env. |
| `agent/app/agent.py` | Import + register in `_build_tools()` (non-fatal try/except, mirrors MongoDB MCP). Reaches the chat LlmAgent only. |
| `agent/app/prompts/civic_safety.md` | Narrowed the old federal-only refusal (line ~21) to hyper-local only; added "Ballotpedia discovery tools (leads only)" section. |
| `agent/tests/unit/test_ballotpedia_mcp_toolset.py` | **New** — 5 unit tests. |

Patches applied to the server (also still in the original `~/Downloads/ballotpedia-mcp`):
1. `get_ballot_by_zip` now expands 2-letter state abbrevs (was 404ing on `state="WI"`).
2. `get_ballot_measures` maps columns by header name (Type/Title were swapped).
3. `STATE_ABBREVS` extracted to one shared module constant (+`normalize_state`).

---

## Verification done (re-run if you doubt anything)

```bash
cd agent
.venv/bin/python -m pytest tests/unit/ -q          # 328 passed (323 + 5 new)
.venv/bin/python -c "import logging;logging.basicConfig(level=logging.INFO);import app.agent as a;a._build_tools()"
#   → logs "Ballotpedia MCP toolset registered (discovery-only)"
```
Live end-to-end (server spawned with agent interpreter via MCP, `get_ballot_measures("CA")`
returned 8 measures with correct title/type) was confirmed in-session.

The original standalone server: `cd ~/Downloads/ballotpedia-mcp && uv run pytest tests/ -v` → 29/29.

---

## What's LEFT for the next session

1. **Commit.** Suggested: `feat(agent): add discovery-only Ballotpedia MCP to inline chat`.
   Branch first if not already (work is on `main`).
2. **Deploy** (manual, per `districtlens_deploy_mechanism` memory):
   `terraform apply -var-file=vars/local.tfvars`. Vendored server + dep ride along
   in the image (under `agent/app/`).
3. **Optional — schedule the server's integration tests as a canary.** Scraper is
   HTML-fragile; `~/Downloads/ballotpedia-mcp/tests` has live-network tests.
4. **Optional cleanup:** an earlier `uv sync` pruned ad-hoc `ruff`/`ty`/`tabulate`
   from the agent venv (not in declared deps). Re-add if your lint flow needs them.

---

## Gotchas / non-obvious

- Each Bash tool call resets cwd to the repo root — use absolute paths or `cd agent &&`.
- Don't add Ballotpedia to the VoterBriefPipeline as a live dep (demo-critical path;
  the whole point of ADR 0001 is determinism). A measures-discovery step that routes
  through Firecrawl would be a *future* phase, not this one.
- `civic_safety.md` was the real blocker: it told the agent to decline ballot-measure
  / state topics, which would have made the tools inert. That's why the scope edit
  was required (and it also reconciles the stale "federal-only" line with the
  2026-05-26 "governor/state in scope" decision).

## Suggested skills for next session
- `superpowers:finishing-a-development-branch` (decide merge/PR/cleanup) or `/ship`.
- `/code-review` on the diff before committing if you want a second pass.
