# CLAUDE.md — DistrictLens Project Context

You are building **DistrictLens**, a nonpartisan midterm election accountability agent. The application helps users understand congressional races by combining MongoDB-backed bulk imports of FEC campaign-finance data, Congress.gov/GovInfo legislative data, candidate issue-position evidence, district context, and cited AI answers. Official APIs are used for missing, stale, or user-requested refreshes, not as the default app read path.

## Non-negotiable product principles

DistrictLens must be **evidence-first**, **nonpartisan**, and **citation-driven**. It must never fabricate candidate positions, never infer policy support solely from party or donors, and never recommend whom to vote for. When evidence is missing, the agent must say so directly.

| Principle | Implementation rule |
|---|---|
| Evidence first | Every factual answer about a candidate, race, donation, vote, or issue position must link back to stored source evidence. |
| No persuasion | The agent may compare public evidence but must not tell users how to vote. |
| Public-first auth | Clerk must not block public civic reads, district lookup, race comparison, citations, or basic agent answers. Use Clerk only for saved user features and protected admin operations. |
| No donor-to-position inference | FEC finance data can contextualize a race but cannot prove a candidate’s policy stance. |
| Source hierarchy | Official campaign statements, verified questionnaires, and legislative records outrank news summaries and interest-group ratings. |
| Date awareness | The agent must preserve source dates, import timestamps, refresh timestamps, and warn when evidence may be stale. |
| Missing evidence | If direct evidence is missing, answer with “I found no direct statement in the indexed sources.” |

## Required reading before coding

Before implementing, read these files in order:

1. `docs/AGENT_CAPABILITIES_RESEARCH.md` ← **Read first for current Gemini models, Perplexity API options, and known capability gaps**
2. `docs/HACKATHON_REQUIREMENTS.md`
2. `docs/HACKATHON_TECHNICAL_ARCHITECTURE.md`
3. `docs/HACKATHON_REQUIREMENTS_AUDIT.md`
4. `docs/PRD.md`
5. `docs/ARCHITECTURE.md`
6. `docs/DATA_STRATEGY.md`
7. `docs/GUARDRAILS.md`
8. `specs/MCP_INTEGRATION.md`
9. `specs/TOOLS.md`
10. `schemas/mongodb_collections.json`
11. `tasks/BUILD_PLAN.md`
12. `tasks/HACKATHON_MVP.md`
13. `tasks/DEVPOST_SUBMISSION_CHECKLIST.md`

## Hackathon implementation requirements

DistrictLens is being built for the **Google Cloud Rapid Agent Hackathon**. The implementation must therefore prioritize a functional, judge-demoable agent rather than a broad research prototype.

| Requirement | Build implication |
|---|---|
| Gemini / Google Cloud agent foundation | Implement the agent orchestration around Gemini and Google Cloud Agent Builder or the Google Cloud Agent Starter Pack pattern where feasible. |
| Partner MCP integration | Use **MongoDB MCP Server** as the default partner integration. At least one visible agent workflow must call a partner MCP-backed tool. |
| Public, open-source submission | Structure the repository so it can be made public with a license, clear setup instructions, and no secrets. |
| Hosted demo | Keep deployment Cloud Run-friendly and avoid local-only dependencies in the demo path. |
| Judging clarity | Add an activity trace panel or logs showing race resolution, finance retrieval, issue evidence search, MCP use, and citation generation. |
| Civic safety | The agent must refuse voting recommendations and instead offer neutral evidence comparison. |

## Preferred implementation style

Use TypeScript for frontend and backend unless the repository already has a different stack. Keep services modular and testable. Every external integration should be wrapped in a provider class or service function rather than called directly from UI components.

| Area | Rule |
|---|---|
| Configuration | Read secrets from environment variables only. Never hard-code API keys. |
| API clients | Put FEC import/refresh, Congress.gov/GPO import/refresh, search, MongoDB MCP, and optional Elastic calls behind typed service modules. |
| Schemas | Validate extracted LLM JSON before writing it to storage. |
| Tests | Add unit tests for race key construction, candidate classification, claim validation, and citation formatting. |
| UI | Show citations, confidence labels, and source dates in the user interface. |
| Logs | Log retrieval and extraction outcomes, including safe MCP trace events, but do not log secrets. |

## Gemini models — MANDATORY

Two approved Gemini models, each with a specific role. Always `location="global"`. **Never** use `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-1.x`, or any other Gemini string — if you see one, fix it.

| Model | Use for | Why |
|---|---|---|
| `gemini-3.1-pro-preview` | **Default** — reasoning, extraction, structuring, answer generation, evals | Highest-quality reasoning; the project default everywhere unless a row below applies |
| `gemini-3.5-flash` | **Grounded web retrieval only** — Google Search grounding (`tools=[Tool(google_search=GoogleSearch())]`) to find candidate positions / live facts | Cheaper + faster, and Google-Search grounding finds low-profile entities Perplexity's API misses. Grounding billed $14/1k queries (5,000/mo free) on Gemini 3 |

Rationale (decided 2026-06-08, empirically verified): `gemini-3.5-flash` + Google Search grounding found WI-04 challengers (Donahue, Nath) that Perplexity sonar-pro could not, at ~$0.014/candidate vs $0.60 for Perplexity deep-research, with citable sources. See `docs/handoffs/2026-06-08-gemini-grounding-positions.md`. Do NOT use `gemini-3.5-flash` for non-grounded reasoning/structuring — that stays `gemini-3.1-pro-preview`.

## Claude Code operating instructions

Work in plan mode for each major phase. Do not implement the entire system in one large edit. First create the skeleton, then implement data ingestion, then retrieval, then agent answering, then UI. After each phase, run tests and summarize what changed.

When uncertain about a civic data claim, prefer a conservative implementation and add a TODO rather than inventing logic. If a source is unavailable or paywalled, store metadata and mark the evidence as inaccessible.

## Suggested repository structure

```text
src/
  app/                       # frontend routes or pages
  components/                # UI components
  server/                    # backend API routes and agent endpoints
  services/
    fec/                     # FEC selective importer, refresh client, and race construction
    congress/                # Congress.gov/GPO importer, refresh client, and incumbent enrichment
    search/                  # Perplexity/Tavily/Brave source discovery provider
    retrieval/               # Elastic and MongoDB retrieval helpers
    extraction/              # LLM claim extraction and validation
    agent/                   # orchestration, prompts, answer generation
  schemas/                   # runtime schemas and TypeScript types
  tests/                     # unit and integration tests
scripts/
  ingest_fec_candidates.ts
  ingest_demo_races.ts
  index_sources.ts
```

## Definition of done for the MVP

The MVP is complete when a user can select or enter a race, see candidates and basic finance summaries, ask an issue-position question, and receive a cited answer that distinguishes direct candidate statements, incumbent legislative record, third-party context, and missing evidence. For hackathon readiness, the MVP must also show a visible partner MCP-backed retrieval step, run on a hosted URL, include public repository documentation, and support a three-minute demo path.

## Mandatory Agents CLI Build Rule

Use **Google Agents CLI** as the primary implementation path unless there is a documented blocker. Begin by running `uvx google-agents-cli setup`, then scaffold the agent project with `agents-cli scaffold districtlens-agent`. Implement DistrictLens as a Google ADK/Gemini tool-using agent, not as a generic chatbot. Use `agents-cli run` for smoke tests, `agents-cli eval run` for civic safety and citation evaluations, and `agents-cli deploy` or the scaffold-supported Google Cloud deployment path for the hosted demo.

Read and follow `docs/AGENTS_CLI_IMPLEMENTATION.md` before writing implementation code.

# Clean Code Standards

All code produced in this project must follow these clean code principles. These are non-negotiable defaults — not suggestions.

## Naming

- Every variable, function, and class name must clearly communicate its purpose. No single-letter names, no abbreviations unless universally understood (e.g., `id`, `url`).
- Use `numberOfUsers` not `n`. Use `calculateShippingCost` not `calc`.

## Functions

- Each function does ONE thing (Single Responsibility Principle). If you can describe what a function does using "and," split it.
- Keep functions under 20 lines. If longer, extract helper functions.
- Prefer small, composable functions over large monolithic ones.

## Comments

- Code should be self-explanatory. Comments explain WHY, never WHAT or HOW.
- Bad: `// Loop through users` — Good: `// Retry failed users from the last sync batch`
- Delete comments that restate the code. Outdated comments are worse than no comments.

## Formatting & Consistency

- Use consistent indentation (2 or 4 spaces — pick one, never mix).
- Group related logic with blank lines. Separate concerns visually.
- Use Prettier/ESLint or equivalent formatter. Every file should look like the same person wrote it.

## No Hardcoded Values

- Extract magic numbers and strings into named constants or config.
- Bad: `if (users >= 100)` — Good: `if (users >= MAX_USERS)`

## Project Structure

- Organize by concern: `components/`, `services/`, `utils/`, `tests/`.
- Keep test files outside `src/` in a mirrored structure.
- Never dump everything in one directory.

## Error Handling

- Fail fast. Throw meaningful errors with clear messages.
- Use try/catch blocks. Never silently swallow errors.
- Log like you're documenting a crime scene: precise, relevant, minimal.

## Testing

- Write unit tests for every function with logic.
- Tests should be as clean as production code.
- Test edge cases, not just the happy path.

## Dependency Injection

- Pass dependencies as arguments rather than hardcoding them.
- This makes code testable and swappable.

## The Boy Scout Rule

- Leave every file cleaner than you found it.
- When touching existing code: rename unclear variables, extract messy functions, remove dead code.

## Open/Closed Principle

- Design for extension, not modification. Use polymorphism and composition.
- Adding a new feature should not require rewriting existing working code.

## Code Smells to Fix on Sight

- Duplicated logic → extract into a shared function
- God objects doing everything → split responsibilities
- Long parameter lists → use an options/config object
- Nested conditionals 3+ levels deep → extract or invert early returns
