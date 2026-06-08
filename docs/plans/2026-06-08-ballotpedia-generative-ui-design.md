# Design — Ballotpedia generative-UI cards (CopilotKit)

**Date:** 2026-06-08
**Status:** Design validated, not implemented.
**Goal:** Replace the raw `{"content":[{"type":"text"…}]}` tool-call blob for the
Ballotpedia MCP tools with styled generative-UI cards in the CopilotKit chat.

## Context

The agent exposes 5 discovery-only Ballotpedia MCP tools (see
`districtlens_ballotpedia_mcp` memory). In the chat they currently fall through to
the generic `TraceCard` (`AgentToolTrace.tsx` → `useDefaultTool`), rendering raw
JSON. The app already has the pattern to fix this: `useRenderToolCall` +
`FinanceToolCard` render a rich card for `get_race_finance_brief`. We mirror it.

**Scope:** cards for 4 of the 5 tools — `ballotpedia_get_ballot_measures`,
`_get_elections_by_state`, `_search_candidates`, `_summarize_candidate_platform`.
`ballotpedia_get_ballot_by_zip` is out of scope (rarely fires; overlaps
`lookup_district`).

**Non-goal:** changing Ballotpedia's governance. It stays DISCOVERY-ONLY — the
cards present leads, never cited evidence.

## Architecture

Mirrors `AgentToolTrace.tsx` / `FinanceToolCard.tsx` exactly.

- **Registration:** add 4 `useRenderToolCall({ name: "ballotpedia_<tool>", render })`
  calls in `AgentToolTrace.tsx`, beside the existing finance one. Loading →
  card-specific skeleton; `complete` → the card. Everything else still falls
  through to the generic `TraceCard`.
- **MCP unwrap helper** — `web/src/lib/mcp-result.ts` → `unwrapMcpResult(result)`.
  MCP tools return `{content:[{type:"text", text:"<json-string>"}]}`, unlike the
  FEC tool's plain object. The helper handles: MCP envelope → already-parsed object
  → plain JSON string → MCP *error* envelope → malformed (returns `null`). This is
  the riskiest piece; it gets a hard unit test.
- **Components** — `web/src/components/canvas/ballotpedia/`:
  - `BallotpediaCardShell.tsx` — shared chrome: header chip + **discovery badge** +
    governance footer. All 4 cards wrap with it (DRY + one governance treatment).
  - `BallotMeasuresCard.tsx`, `ElectionsCard.tsx`, `CandidateSearchCard.tsx`,
    `CandidateProfileCard.tsx`.

Visual language matches `FinanceToolCard` (`border-2 border-slate-900`,
`rounded-[2px]`, uppercase tracking-widest headers) but with a **distinct marker**
(dashed accent + amber `Ballotpedia · discovery` chip) so these read as leads, not
the solid evidence cards.

## Card content (data shapes from `server.py`, post-unwrap)

| Card | Tool result | Renders |
|---|---|---|
| BallotMeasuresCard | `{state, year, measures:[{title, type, subject, description, status, url}], sources}` | measures **grouped by `subject`**; row = title (→ url), `type` badge, truncated description |
| ElectionsCard | `{state, year, elections:[{title, url, date, office_type, candidates_preview:[{name,url}]}], sources}` | per race: title, `office_type` badge, date, preview names. **Filters section-header noise** ("Election dates", "Offices on the ballot") |
| CandidateSearchCard | `{query, candidates:[{name, url, party, office, state, status, snippet?}], sources}` | per hit: party dot, name (→ url), office/state, truncated snippet |
| CandidateProfileCard | `{name, url, party, office, state, bio, campaign_themes, key_votes, election_history, endorsements, …}` | name, party/office/state, bio + `campaign_themes` (truncated); votes/endorsements only if present (honest-empty) |

## Governance (load-bearing)

`BallotpediaCardShell` footer: *"Discovery lead from Ballotpedia (a wiki) — verify
before citing; not indexed evidence."* The **CandidateProfileCard** is highest-risk
(carries platform text) → strongest wording. The dashed/amber marker visually
separates these from cited evidence cards for users and judges alike.

## Backend tweak (required for "group by subject")

`get_ballot_measures` currently drops the Ballotpedia "Subject" column into
`description`. Capture it as a distinct `subject` field in the vendored
`agent/app/mcp_servers/ballotpedia/server.py` (both `_parse_measures_page` and the
inline national-page parser), and keep the `~/Downloads/ballotpedia-mcp` original in
sync. Subjects are semicolon-joined; group on the **first** subject token.
**Deploy dependency:** the agent must be redeployed (`gcloud run deploy
districtlens-agent --source agent`) before grouping works; cards ship via the web
deploy independently.

## Defensive rendering

`unwrapMcpResult` survives error envelopes, empty arrays, and malformed JSON → each
card degrades to a minimal "Ballotpedia returned no results" shell, never a crash
(mirrors FinanceToolCard's normalize-or-`{}`).

## Testing

- **Unit (hard):** `unwrapMcpResult` — MCP envelope, plain object, JSON string,
  error envelope, malformed → expected output/`null`.
- **Per card:** one fixture-based render assertion verifying key fields **and the
  governance footer are present** (so the discovery label can't silently regress).
- Backend: extend the ballotpedia server's measure-parsing test to assert the new
  `subject` field.

## File summary

```
web/src/lib/mcp-result.ts                              (new) unwrap helper
web/src/lib/__tests__/mcp-result.test.ts               (new)
web/src/components/canvas/ballotpedia/
  BallotpediaCardShell.tsx                             (new)
  BallotMeasuresCard.tsx / ElectionsCard.tsx /
  CandidateSearchCard.tsx / CandidateProfileCard.tsx   (new)
web/src/components/canvas/AgentToolTrace.tsx           (edit) +4 useRenderToolCall
agent/app/mcp_servers/ballotpedia/server.py            (edit) capture `subject`
~/Downloads/ballotpedia-mcp/server.py                  (edit) keep in sync
```

## Deploy order

1. Backend `subject` tweak → `gcloud run deploy districtlens-agent --source agent`.
2. Web cards → `gcloud run deploy districtlens-web --source web`.
(Cards render regardless; subject grouping needs step 1 live.)
