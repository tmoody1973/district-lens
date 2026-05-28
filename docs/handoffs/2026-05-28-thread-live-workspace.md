# Handoff — Per-thread live workspace (brief + chat restore/resume per thread)

**Next session's job:** make a journalist research **thread own its full working surface** — open a thread and the **center canvas (brief)** and the **right chat column (conversation)** restore to *that thread's* state, and the chat is **resumable** (keep asking, continuing that thread's conversation). This is the "revisitable like Claude chats" vision, the **heavy/live-replay model** that was deliberately deferred while we shipped the light model.

Repo: `/Users/tarikmoody/Documents/Projects/districtlens` · web app in `web/` · prod `civicsync-440613` (Cloud Run, us-central1). Date: 2026-05-28.

## ⚠️ Read first: what already exists (don't rebuild it)

The journalist saved workspace shipped this session in the **light model**. All live in prod (web rev **`districtlens-web-00051-v7s`**), `main` == prod.

**Collections (exist in prod Mongo, created on first write):**
- `saved_briefs` — frozen brief snapshots: `brief_id, clerk_user_id, race_key, question, answer_snapshot (full DistrictLensState), source_refs[], freshness (BriefFingerprint), created_at, updated_at, thread_id?`
- `saved_districts` — one-per-race bookmarks (voter "My Ballot")
- `agent_threads` — research threads: `thread_id, clerk_user_id, title, race_keys[], notes, messages[] ({role,content}), created_at, updated_at`

**What works today (verified):**
- **Auth:** Clerk, public-first. `web/src/proxy.ts` runs bare `clerkMiddleware()` (Next 16 renamed middleware→`proxy.ts`); protects nothing; save/thread routes self-gate via `auth()` → 401 JSON. Publishable key is baked into `web/Dockerfile` build stage (it's public); `CLERK_SECRET_KEY` is a Secret Manager secret (`districtlens-clerk-secret-key`) on the web service at runtime.
- **Voter "My Ballot":** save brief → `saved_briefs` + `saved_districts`; list + reopen; "what changed since you saved" diff (candidates + fundraising). All verified against live Mongo.
- **Journalist threads (light):** `ThreadsPanel` (left sidebar, journalist mode) — create / list / rename / notes / delete; always-visible list, selected thread expands inline (keyed by `thread_id` to remount). Briefs filed into a thread via "Save to '<thread>'" (tags `saved_briefs.thread_id` + `$addToSet` race onto thread). Read-only chat **transcript** captured onto the active thread and shown in the **left** panel.

**API routes (all `web/src/app/api/`, auth-gated + owner-scoped):**
- `saved/route.ts` (GET list), `saved/brief/route.ts` (POST save, accepts `threadId`), `saved/brief/[id]/route.ts` (GET reopen)
- `threads/route.ts` (GET list, POST create), `threads/[id]/route.ts` (GET/PATCH/DELETE)

**Core libs:**
- `web/src/lib/threads/{schema.ts,store.ts}` — thread types/zod, `buildThreadDoc`, CRUD, `attachRaceToThread`
- `web/src/lib/saved-briefs/{schema.ts,store.ts,diff.ts}`, `web/src/lib/brief-fingerprint.ts`
- `web/src/lib/brief-display.ts` — `pickDisplayedBrief` (the center-canvas source-of-truth picker)
- `web/src/components/canvas/ThreadsPanel.tsx`
- Everything is in `web/src/app/page.tsx` (large client component inside the CopilotKit provider).

136 tests pass; `tsc` clean.

## The gap to close

Two columns are **NOT per-thread today**:

1. **Center canvas (the brief).** Driven by `displayed = openedBrief ?? pickDisplayedBrief(agentState, briefSnapshot, lastBriefMode)` in `page.tsx`. A thread's brief only appears in the center when the user **clicks a specific brief** inside the thread's Briefs list (`openSavedBrief(briefId)` → sets `openedBrief`). Opening a thread does **not** auto-restore a brief.
2. **Right chat column.** A **single global CopilotKit conversation** (`<CopilotChat>` from `@copilotkit/react-ui`, runtime in `web/src/app/api/copilotkit/route.ts` proxies to the Python ADK agent via `HttpAgent`). **No persistence is wired** — `web/src/app/api/copilotkit/threads/route.ts` is a stub returning `{ threads: [] }`. The "transcript" we built is a read-only *copy* of `useCopilotChat().visibleMessages` snapshotted onto the active thread — it is **not** the live chat, and the chat is global (can bleed across threads).

## What "done" looks like

Open thread A → center shows A's brief, right column shows A's conversation and you can keep chatting (it continues A). Switch to B → both columns swap to B. Each thread is a self-contained, resumable workspace.

## Implementation approach (proposed, verify against current CopilotKit/ADK docs first)

**This is the hard part — CopilotKit thread persistence + ADK session resume. Research before building (AGENTS.md: this Next.js 16 / CopilotKit 1.57 may differ from training data; read `node_modules/@copilotkit/*` types and ADK docs).**

Suggested phases (one PR each, verify on deploy — headless can't sign into Clerk, see Gotchas):

- **W1 — Restore the center brief on thread open.** When `openThread(id)` runs, if the thread has briefs, auto-`openSavedBrief(latestBriefId)` so the center shows the thread's brief. Lower risk; reuses existing reopen path. (Decide: latest brief, or persist the live `agentState` per thread and restore that.)
- **W2 — Per-thread CopilotKit conversation.** Give each workspace thread a CopilotKit `threadId`. Wire real persistence:
  - Implement `GET /api/copilotkit/threads` + message load/save (replace the stub) backed by `agent_threads.messages` or a dedicated store.
  - On thread open, point the chat/agent at that thread's `threadId` and load its messages so the **right column** shows + resumes that conversation. Investigate v2 `useAgent`/`useCopilotKit` (`web/src/app/page.tsx` already uses them) for `threadId`/message-loading support, and whether the ADK backend (`AGENT_URL` `/copilotkit`) supports session resume.
  - This likely supersedes the read-only transcript (or keeps it as a fallback).
- **W3 — Persist live agentState per thread (optional).** So the center restores the exact in-progress brief, not just a saved snapshot.

**Open design questions to resolve with the owner:** does opening a thread *replace* the global chat (one active workspace at a time) or keep voter chat separate? What happens to the voter-mode chat when switching to a journalist thread? Is the chat scoped per-thread only in journalist mode?

## Gotchas (learned the hard way this session)

- **Headless browsers can't test Clerk sign-in** (cross-origin cookie handshake → false "infinite redirect loop"). Verify signed-in features in a **real browser** (owner), or by querying live Mongo with a Node script (`MONGODB_URI` from `web/.env.local`, `require` mongodb from `web/node_modules`, run from repo root). This is how every signed-in feature was verified this session.
- **Next.js 16:** middleware is `proxy.ts`; route params are `Promise<{id}>` (`await params`). **Clerk 7 is "Core 3":** no `<SignedIn>/<SignedOut>` — use `<Show when="signed-in" fallback={…}>`.
- **Schema/data drift:** old `agent_threads` docs created before the `messages` field crashed the UI (`thread.messages.length` on undefined). Always default new fields on read (`thread.messages ?? []`) AND backfill existing docs. Same lesson will apply to any new per-thread field.
- **React stale-state:** `ThreadDetail` needed `key={thread_id}` to remount per thread, else local draft state leaked across threads. Watch for this when the chat column becomes per-thread.
- **FEC dates are `MM/DD/YYYY`**, not ISO — compare via `Date.parse`, never string compare (see `brief-fingerprint.ts` `toTime`).
- **Deploy (web-only, no Terraform):** the web service is **not** TF-managed (only the agent is). `git stash push .gitignore web/package.json web/bun.lock` (HeroUI WIP — currently parked in `stash@{0}`, leave it), then `gcloud run deploy districtlens-web --source web --region us-central1 --project civicsync-440613 --quiet`, then `git stash pop`. The Clerk secret + Dockerfile publishable key already persist on the service.

## Decisions already locked
- Light model (named container of briefs + notes) shipped; **this handoff is the upgrade to live replay.**
- Heuristic thread titles (renameable), multi-race threads.
- Public-first: reads never gate; only writes (save/threads) require Clerk.
- Verify per-thread chat isolation carefully — the current global-chat capture bleeds across threads; the live model must fix that.
