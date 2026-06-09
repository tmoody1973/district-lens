# Handoff — DistrictLens Artifact Workspace: write the implementation plan

**Date:** 2026-06-09
**Repo:** /Users/tarikmoody/Documents/Projects/districtlens (branch `main`)
**Next session's job:** invoke `superpowers:writing-plans` against the approved
spec, produce the implementation plan, then build it (TDD).

## Where things stand

Brainstorming is COMPLETE through the user-review gate. Tarik approved the spec:

→ **`docs/superpowers/specs/2026-06-09-artifact-workspace-design.md`** (commit `f40055b`)

Read it first — it is the single source of truth for this redesign: personas
(Maya/Devon), 8 locked decisions, routes, shell architecture, the 4 artifact
renderers, artifact lifecycle (auto-snapshot, linear versions, local-first sync),
error handling, civic guardrails (leads never publish), testing strategy, and the
6-phase build sequence (every phase must leave `main` deployable; contingency cut
line after phase 3).

Do NOT re-litigate decisions in the spec — they were chosen interactively
(theme = Crate Dark; layout = one engine, two persona presets; CopilotKit is the
pipe, MongoDB the warehouse; full redesign before hackathon submission).

## Context the spec references but doesn't contain

**Current DistrictLens UI (what's being replaced / kept):**
- Shell to replace: `web/src/app/page.tsx` (~785-line monolith, 3-column).
- Organs to KEEP (mount inside `BriefArtifact`): `web/src/components/canvas/` —
  `DecisionHeader`, `CandidateField`, `IssueAccordion`, `EvidenceCard`,
  `FinanceChart`, `RaceCanvas`, `ReceiptProgress`, `ThreadsPanel`, plus
  `web/src/components/map/USMap.tsx`, `RaceTable`.
- Logic to KEEP: `web/src/lib/brief-layout.ts` (SEAT/FIELD/MONEY/AT STAKE +
  section plans), `brief-display.ts` (display priority), `saved-briefs/`
  (SavedBriefDoc + fingerprint freshness), `threads/` (thread schema),
  `web/src/types/agent-state.ts` (DistrictLensState).
- Chat/generative-UI to KEEP: CopilotKit `useCoAgent` wiring in `page.tsx` /
  `providers.tsx`; `AgentToolTrace.tsx` + ballotpedia cards (recently shipped,
  tested — add "open as artifact ↗" affordances, don't rewrite).

**Crate Web (the donor patterns; read for reference, adapt don't import):**
`/Users/tarikmoody/Documents/Projects/crate-web/src/components/workspace/`
(`workspace-shell.tsx`, `deep-cuts-panel.tsx`, `artifact-provider.tsx`,
`chat-panel.tsx`) and `src/components/sidebar/*-section.tsx`,
`session-item.tsx`. Resizable split lives in `src/app/w/[sessionId]/page.tsx`
(localStorage-persisted %, 30–70 bounds). Crate is zinc-950/800 dark, no
component library — that aesthetic is the chosen theme.

**Approved visual mockups** (what Tarik clicked): `.superpowers/brainstorm/
42214-1781028271/content/` — `theme.html` (chose B, Crate Dark) and
`layout-approaches.html` (chose C, one-engine-two-presets).

## Process expectations (how Tarik works — non-negotiable)

- **TDD always** (`superpowers:test-driven-development`): RED before GREEN,
  watch tests fail. Web tests: `cd web && npx vitest run` (192 currently green —
  keep them green).
- **`/simplify` after each significant code phase**; `superpowers:verification-
  before-completion` before claiming done.
- **Dogfood in a real browser** (gstack `browse` skill) with screenshot evidence —
  Clerk sign-in can't be tested headless (verify signed-in features live or via
  Mongo scripts).
- **Deploys are manual:** `gcloud run deploy districtlens-web --source web
  --region us-central1 --project civicsync-440613` (agent likewise with
  `--source agent`). No push-CI/CD. Commit style: conventional commits, NO
  attribution footer. Push each commit to `origin main`.
- **Civic guardrails are law** (`.claude/rules/`): citations required, no vote
  recommendations, honest-empty over invented evidence, Ballotpedia =
  discovery-only.
- Plain-English explanations of CopilotKit/architecture concepts before
  implementing (explicit Tarik preference).

## Suggested skills for the next session

1. `superpowers:writing-plans` — FIRST action: turn the spec into the
   implementation plan (the spec's 6 phases are the natural plan skeleton).
2. `superpowers:executing-plans` or `superpowers:subagent-driven-development` —
   for the build, phase by phase.
3. `superpowers:test-driven-development` — per task.
4. `browse` (gstack) — dogfooding gates (Maya loop / Devon loop per spec §Testing).
5. `vercel:nextjs` / `tailwind` — reference for App Router routes + token-based
   dark restyle.

## Watch-outs discovered during brainstorming

- The hackathon demo depends on a VISIBLE working agent + MongoDB MCP trace —
  the receipt strip and streaming chat must never disappear during the redesign
  (judging criterion, see CLAUDE.md).
- Phase 1 intentionally mounts the still-light `RaceCanvas` inside the dark shell
  ("paper on dark desk") — that's the approved transitional waypoint, not a bug.
- `LeadArtifact` governance footer must be structurally unremovable, and the
  publish endpoint must reject lead-type artifacts (spec guardrail; test both).
- Anonymous chat transcripts are deliberately ephemeral; only artifacts persist
  locally (privacy posture — don't "fix" this).
- Backend/agent is OUT OF SCOPE. All recent Ballotpedia work (Firecrawl stealth
  fallback, Mongo page cache, exact-name lookup — see
  `docs/handoffs/2026-06-08-ballotpedia-mcp-handoff.md` and memory) is deployed
  (agent rev 00038-vxr) and must not be disturbed by this UI work.
