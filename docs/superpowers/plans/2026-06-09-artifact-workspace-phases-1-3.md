# Artifact Workspace (Phases 1–3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-page chat-with-canvas UI with an artifact-centric three-pane workspace (Library · Chat · Artifact) per the approved spec `docs/superpowers/specs/2026-06-09-artifact-workspace-design.md`, through the contingency cut line: shell + layout engine (Phase 1), artifact layer + library (Phase 2), dark token pass (Phase 3).

**Architecture:** A new `/w` route hosts `WorkspaceShell` (three panes, draggable chat/artifact divider, persona presets persisted to localStorage). The existing CopilotKit `useCoAgent` wiring moves into a `useWorkspaceAgent` hook; the ~21 canvas organs mount unchanged inside `ArtifactPanel`. A new artifact layer (pure lifecycle functions + localStorage store + `ArtifactProvider`) auto-snapshots completed briefs into a local library, with linear immutable versions and sign-in push to Mongo via the existing `/api/saved/brief` endpoint. Phase 3 defines dark tokens in Tailwind v4 `@theme` and sweeps the canvas organs onto them.

**Tech Stack:** Next.js App Router (see `web/AGENTS.md` — read `node_modules/next/dist/docs/` before route work), React 19, Tailwind CSS v4 (`@theme` tokens), CopilotKit (`useCoAgent`, `useAgent`/`useCopilotKit` v2), Clerk, Vitest + Testing Library (jsdom).

**Working directory:** all paths below are relative to `web/` unless prefixed otherwise. Run tests with `cd web && npx vitest run`. The suite currently has 192 green tests — it must stay green after every task.

**Commit style:** conventional commits, NO attribution footer. Push each commit to `origin main`.

**Deployability invariant:** Phases 1 and most of 2 are purely additive (`/w` is a new route; `/` is untouched until Task 19). `main` builds and deploys at every commit. The old `page.tsx` monolith is deleted only in Task 19, after the library sidebar carries My Ballot + Threads — so there is no feature-regression window. (The spec lists the monolith under "Removed"; this plan times the removal at end of Phase 2 deliberately.)

**Judging invariant (CLAUDE.md):** the receipt strip and streaming chat must never disappear. `ArtifactPanel` carries the receipt strip while drafting; `ChatPane`'s collapsed state still shows the agent status message. `AgentToolTrace` (MCP trace cards) mounts in `/w` from Task 8 onward.

---

## File structure (phases 1–3)

```
web/src/
  lib/workspace/
    layout.ts                     # NEW pure layout engine: presets, clamp, parse/serialize
    chat-config.ts                # NEW shared SYSTEM_PROMPT + CHAT_LABELS
    useWorkspaceAgent.ts          # NEW agent wiring hook (extracted from page.tsx)
    useThreads.ts                 # NEW (Task 17) thread logic hook (extracted from page.tsx)
    __tests__/layout.test.ts
  lib/artifacts/
    types.ts                      # NEW ArtifactRecord / ArtifactVersion / ArtifactType
    lifecycle.ts                  # NEW shouldSnapshot / snapshotBrief / deriveArtifactName
    local-store.ts                # NEW localStorage CRUD with quota degradation
    sync.ts                       # NEW (Task 18) one-shot sign-in push
    __tests__/{lifecycle,local-store,sync}.test.ts
  components/workspace/
    WorkspaceLayoutContext.tsx    # NEW layout state provider
    WorkspaceShell.tsx            # NEW three-pane frame + divider
    LibrarySidebar.tsx            # NEW collapsible sidebar (rail ↔ 260px)
    PersonaSwitch.tsx             # NEW voter/journalist toggle
    ChatPane.tsx                  # NEW CopilotChat wrapper, dockable
    ArtifactPanel.tsx             # NEW artifact header + typed body
    ArtifactProvider.tsx          # NEW (Phase 2) library context + auto-snapshot
    LibraryItem.tsx               # NEW (Phase 2) type dot, name, freshness chip
    LibrarySections.tsx           # NEW (Phase 2) Recents / All artifacts sections
    __tests__/*.test.tsx
  app/w/page.tsx                  # NEW workspace route
  app/page.tsx                    # MODIFIED in Task 19 only → landing page
  app/globals.css                 # MODIFIED in Phase 3 → dark tokens
```

Existing files that are **read but not modified** in phases 1–2: everything under `components/canvas/`, `components/map/USMap.tsx`, `lib/brief-layout.ts`, `lib/brief-display.ts`, `lib/brief-fingerprint.ts`, `lib/saved-briefs/*`, `lib/threads/*`, `lib/steps.ts`, `types/agent-state.ts`, `app/providers.tsx`, `app/layout.tsx`.

---

# Phase 1 — Shell + layout engine + presets

Outcome: `/w` renders the dark three-pane shell; address/race/state flows work end-to-end inside it; today's light `RaceCanvas` mounts inside the dark artifact panel ("paper on dark desk" — the approved transitional waypoint, not a bug). `/` is untouched.

### Task 1: Layout engine (pure module)

**Files:**
- Create: `web/src/lib/workspace/layout.ts`
- Test: `web/src/lib/workspace/__tests__/layout.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/lib/workspace/__tests__/layout.test.ts
import { test, expect } from "vitest";
import {
  CHAT_PCT_MAX,
  CHAT_PCT_MIN,
  clampChatPct,
  parseLayout,
  presetFor,
  serializeLayout,
} from "@/lib/workspace/layout";

test("voter preset: library railed, chat docked at 28%", () => {
  expect(presetFor("voter")).toEqual({
    persona: "voter",
    libraryCollapsed: true,
    chatCollapsed: false,
    chatPct: 28,
  });
});

test("journalist preset: library open, chat at 40%", () => {
  expect(presetFor("journalist")).toEqual({
    persona: "journalist",
    libraryCollapsed: false,
    chatCollapsed: false,
    chatPct: 40,
  });
});

test("presetFor returns a fresh object each call (no shared mutation)", () => {
  const a = presetFor("voter");
  a.chatPct = 99;
  expect(presetFor("voter").chatPct).toBe(28);
});

test("clampChatPct clamps below the minimum", () => {
  expect(clampChatPct(5)).toBe(CHAT_PCT_MIN);
});

test("clampChatPct clamps above the maximum", () => {
  expect(clampChatPct(95)).toBe(CHAT_PCT_MAX);
});

test("clampChatPct passes through in-range values", () => {
  expect(clampChatPct(33)).toBe(33);
});

test("parseLayout(null) falls back to the persona preset", () => {
  expect(parseLayout(null, "journalist")).toEqual(presetFor("journalist"));
});

test("parseLayout on corrupt JSON falls back to the preset", () => {
  expect(parseLayout("{not json", "voter")).toEqual(presetFor("voter"));
});

test("parseLayout on wrong field types falls back to the preset", () => {
  const raw = JSON.stringify({ persona: "voter", libraryCollapsed: "yes", chatCollapsed: false, chatPct: 30 });
  expect(parseLayout(raw, "voter")).toEqual(presetFor("voter"));
});

test("parseLayout on unknown persona falls back to the preset", () => {
  const raw = JSON.stringify({ persona: "admin", libraryCollapsed: false, chatCollapsed: false, chatPct: 30 });
  expect(parseLayout(raw, "voter")).toEqual(presetFor("voter"));
});

test("parseLayout clamps a stored out-of-range chatPct", () => {
  const raw = JSON.stringify({ persona: "voter", libraryCollapsed: true, chatCollapsed: false, chatPct: 90 });
  expect(parseLayout(raw, "voter").chatPct).toBe(CHAT_PCT_MAX);
});

test("serialize → parse round-trips a valid layout", () => {
  const layout = { persona: "journalist" as const, libraryCollapsed: true, chatCollapsed: true, chatPct: 35 };
  expect(parseLayout(serializeLayout(layout), "voter")).toEqual(layout);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/workspace/__tests__/layout.test.ts`
Expected: FAIL — `Cannot find module '@/lib/workspace/layout'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/workspace/layout.ts
/**
 * Pure workspace layout engine — persona presets, bounds, persistence codec.
 * Spec: docs/superpowers/specs/2026-06-09-artifact-workspace-design.md §Shell.
 * Persona presets are saved layout states, not code branches: nothing inside
 * the panes is persona-conditional.
 */

export type Persona = "voter" | "journalist";

export interface WorkspaceLayoutState {
  persona: Persona;
  libraryCollapsed: boolean;
  chatCollapsed: boolean;
  /** Chat pane width as a percentage of the chat+artifact area. */
  chatPct: number;
}

export const CHAT_PCT_MIN = 20;
export const CHAT_PCT_MAX = 60;
export const LAYOUT_STORAGE_KEY = "districtlens.workspace.layout.v1";

const PRESETS: Record<Persona, WorkspaceLayoutState> = {
  voter: { persona: "voter", libraryCollapsed: true, chatCollapsed: false, chatPct: 28 },
  journalist: { persona: "journalist", libraryCollapsed: false, chatCollapsed: false, chatPct: 40 },
};

export function presetFor(persona: Persona): WorkspaceLayoutState {
  return { ...PRESETS[persona] };
}

export function clampChatPct(pct: number): number {
  return Math.min(Math.max(pct, CHAT_PCT_MIN), CHAT_PCT_MAX);
}

function isPersona(value: unknown): value is Persona {
  return value === "voter" || value === "journalist";
}

/** Corrupt or missing stored layout resets to the persona preset (spec §Error handling). */
export function parseLayout(raw: string | null, fallback: Persona): WorkspaceLayoutState {
  if (!raw) return presetFor(fallback);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return presetFor(fallback);
    const candidate = parsed as Partial<WorkspaceLayoutState>;
    if (
      !isPersona(candidate.persona) ||
      typeof candidate.libraryCollapsed !== "boolean" ||
      typeof candidate.chatCollapsed !== "boolean" ||
      typeof candidate.chatPct !== "number" ||
      Number.isNaN(candidate.chatPct)
    ) {
      return presetFor(fallback);
    }
    return {
      persona: candidate.persona,
      libraryCollapsed: candidate.libraryCollapsed,
      chatCollapsed: candidate.chatCollapsed,
      chatPct: clampChatPct(candidate.chatPct),
    };
  } catch {
    return presetFor(fallback);
  }
}

export function serializeLayout(layout: WorkspaceLayoutState): string {
  return JSON.stringify(layout);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/workspace/__tests__/layout.test.ts`
Expected: 12 passed.

- [ ] **Step 5: Run the full suite, then commit**

Run: `cd web && npx vitest run` — expected: 192 + 12 passed, 0 failed.

```bash
git add web/src/lib/workspace
git commit -m "feat(web): workspace layout engine with persona presets"
git push origin main
```

### Task 2: WorkspaceLayoutContext provider

**Files:**
- Create: `web/src/components/workspace/WorkspaceLayoutContext.tsx`
- Test: `web/src/components/workspace/__tests__/WorkspaceLayoutContext.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/components/workspace/__tests__/WorkspaceLayoutContext.test.tsx
import { test, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import {
  WorkspaceLayoutProvider,
  useWorkspaceLayout,
} from "../WorkspaceLayoutContext";
import { CHAT_PCT_MAX, LAYOUT_STORAGE_KEY } from "@/lib/workspace/layout";

let api: ReturnType<typeof useWorkspaceLayout>;

function Probe() {
  api = useWorkspaceLayout();
  return <span data-testid="persona">{api.layout.persona}</span>;
}

beforeEach(() => window.localStorage.clear());

test("starts from the initialPersona preset", () => {
  render(
    <WorkspaceLayoutProvider initialPersona="journalist">
      <Probe />
    </WorkspaceLayoutProvider>,
  );
  expect(screen.getByTestId("persona").textContent).toBe("journalist");
  expect(api.layout.chatPct).toBe(40);
});

test("setPersona applies the full preset", () => {
  render(
    <WorkspaceLayoutProvider initialPersona="journalist">
      <Probe />
    </WorkspaceLayoutProvider>,
  );
  act(() => api.setPersona("voter"));
  expect(api.layout).toMatchObject({ persona: "voter", libraryCollapsed: true, chatPct: 28 });
});

test("toggleLibrary flips only libraryCollapsed", () => {
  render(
    <WorkspaceLayoutProvider initialPersona="journalist">
      <Probe />
    </WorkspaceLayoutProvider>,
  );
  act(() => api.toggleLibrary());
  expect(api.layout.libraryCollapsed).toBe(true);
  expect(api.layout.chatPct).toBe(40);
});

test("setChatPct clamps and persists to localStorage", () => {
  render(
    <WorkspaceLayoutProvider initialPersona="voter">
      <Probe />
    </WorkspaceLayoutProvider>,
  );
  act(() => api.setChatPct(99));
  expect(api.layout.chatPct).toBe(CHAT_PCT_MAX);
  const stored = JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY)!);
  expect(stored.chatPct).toBe(CHAT_PCT_MAX);
});

test("restores a previously stored layout on mount", () => {
  window.localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    JSON.stringify({ persona: "journalist", libraryCollapsed: true, chatCollapsed: true, chatPct: 33 }),
  );
  render(
    <WorkspaceLayoutProvider initialPersona="voter">
      <Probe />
    </WorkspaceLayoutProvider>,
  );
  expect(api.layout).toEqual({ persona: "journalist", libraryCollapsed: true, chatCollapsed: true, chatPct: 33 });
});

test("corrupt stored layout resets to the initialPersona preset", () => {
  window.localStorage.setItem(LAYOUT_STORAGE_KEY, "{nope");
  render(
    <WorkspaceLayoutProvider initialPersona="voter">
      <Probe />
    </WorkspaceLayoutProvider>,
  );
  expect(api.layout.persona).toBe("voter");
  expect(api.layout.chatPct).toBe(28);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/workspace/__tests__/WorkspaceLayoutContext.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/components/workspace/WorkspaceLayoutContext.tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  LAYOUT_STORAGE_KEY,
  clampChatPct,
  parseLayout,
  presetFor,
  serializeLayout,
  type Persona,
  type WorkspaceLayoutState,
} from "@/lib/workspace/layout";

interface WorkspaceLayoutContextValue {
  layout: WorkspaceLayoutState;
  setPersona: (persona: Persona) => void;
  toggleLibrary: () => void;
  toggleChat: () => void;
  setChatPct: (pct: number) => void;
  resetToPreset: () => void;
}

const WorkspaceLayoutContext = createContext<WorkspaceLayoutContextValue | null>(null);

export function WorkspaceLayoutProvider({
  children,
  initialPersona = "voter",
}: {
  children: ReactNode;
  initialPersona?: Persona;
}) {
  // Server render uses the preset; the stored layout loads after mount so the
  // server and client first paint match (no hydration mismatch).
  const [layout, setLayout] = useState<WorkspaceLayoutState>(() => presetFor(initialPersona));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    } catch {
      // localStorage unavailable — session-only layout (spec §Error handling)
    }
    setLayout(parseLayout(stored, initialPersona));
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, serializeLayout(layout));
    } catch {
      // quota or unavailable — degrade silently to session-only
    }
  }, [layout, hydrated]);

  const setPersona = useCallback((persona: Persona) => setLayout(presetFor(persona)), []);
  const toggleLibrary = useCallback(
    () => setLayout((l) => ({ ...l, libraryCollapsed: !l.libraryCollapsed })),
    [],
  );
  const toggleChat = useCallback(
    () => setLayout((l) => ({ ...l, chatCollapsed: !l.chatCollapsed })),
    [],
  );
  const setChatPct = useCallback(
    (pct: number) => setLayout((l) => ({ ...l, chatPct: clampChatPct(pct) })),
    [],
  );
  const resetToPreset = useCallback(() => setLayout((l) => presetFor(l.persona)), []);

  return (
    <WorkspaceLayoutContext.Provider
      value={{ layout, setPersona, toggleLibrary, toggleChat, setChatPct, resetToPreset }}
    >
      {children}
    </WorkspaceLayoutContext.Provider>
  );
}

export function useWorkspaceLayout(): WorkspaceLayoutContextValue {
  const ctx = useContext(WorkspaceLayoutContext);
  if (!ctx) throw new Error("useWorkspaceLayout must be used inside WorkspaceLayoutProvider");
  return ctx;
}
```

Note: the test "restores a previously stored layout on mount" passes because Testing Library's `render` flushes effects synchronously under `act`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/workspace/__tests__/WorkspaceLayoutContext.test.tsx`
Expected: 6 passed.

- [ ] **Step 5: Full suite, commit**

Run: `cd web && npx vitest run` — all green.

```bash
git add web/src/components/workspace
git commit -m "feat(web): workspace layout context with localStorage persistence"
git push origin main
```

### Task 3: PersonaSwitch

**Files:**
- Create: `web/src/components/workspace/PersonaSwitch.tsx`
- Test: `web/src/components/workspace/__tests__/PersonaSwitch.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/components/workspace/__tests__/PersonaSwitch.test.tsx
import { test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceLayoutProvider } from "../WorkspaceLayoutContext";
import { PersonaSwitch } from "../PersonaSwitch";

beforeEach(() => window.localStorage.clear());

function renderSwitch(onPersonaChange = vi.fn()) {
  render(
    <WorkspaceLayoutProvider initialPersona="voter">
      <PersonaSwitch onPersonaChange={onPersonaChange} />
    </WorkspaceLayoutProvider>,
  );
  return onPersonaChange;
}

test("renders both personas with the active one checked", () => {
  renderSwitch();
  expect(screen.getByRole("radio", { name: /voter/i })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("radio", { name: /journalist/i })).toHaveAttribute("aria-checked", "false");
});

test("clicking the other persona checks it and fires the callback", () => {
  const cb = renderSwitch();
  fireEvent.click(screen.getByRole("radio", { name: /journalist/i }));
  expect(screen.getByRole("radio", { name: /journalist/i })).toHaveAttribute("aria-checked", "true");
  expect(cb).toHaveBeenCalledWith("journalist");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/workspace/__tests__/PersonaSwitch.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/components/workspace/PersonaSwitch.tsx
"use client";

import { useWorkspaceLayout } from "./WorkspaceLayoutContext";
import type { Persona } from "@/lib/workspace/layout";

const PERSONA_OPTIONS: Array<{ value: Persona; label: string }> = [
  { value: "voter", label: "🗳️ Voter" },
  { value: "journalist", label: "📰 Journalist" },
];

export function PersonaSwitch({
  onPersonaChange,
}: {
  onPersonaChange?: (persona: Persona) => void;
}) {
  const { layout, setPersona } = useWorkspaceLayout();

  return (
    <div role="radiogroup" aria-label="Persona" className="flex gap-1">
      {PERSONA_OPTIONS.map((option) => {
        const active = layout.persona === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              setPersona(option.value);
              onPersonaChange?.(option.value);
            }}
            className={
              active
                ? "rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-semibold text-white"
                : "rounded-md px-2.5 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/workspace/__tests__/PersonaSwitch.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Full suite, commit**

```bash
git add web/src/components/workspace
git commit -m "feat(web): PersonaSwitch toggle applying layout presets"
git push origin main
```

### Task 4: LibrarySidebar (shell only — sections arrive in Phase 2)

**Files:**
- Create: `web/src/components/workspace/LibrarySidebar.tsx`
- Test: `web/src/components/workspace/__tests__/LibrarySidebar.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/components/workspace/__tests__/LibrarySidebar.test.tsx
import { test, expect, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceLayoutProvider } from "../WorkspaceLayoutContext";
import { LibrarySidebar } from "../LibrarySidebar";

beforeEach(() => window.localStorage.clear());

test("journalist preset renders the expanded sidebar with brand and persona switch", () => {
  render(
    <WorkspaceLayoutProvider initialPersona="journalist">
      <LibrarySidebar>
        <p>section content</p>
      </LibrarySidebar>
    </WorkspaceLayoutProvider>,
  );
  expect(screen.getByText("DistrictLens")).toBeInTheDocument();
  expect(screen.getByRole("radiogroup", { name: "Persona" })).toBeInTheDocument();
  expect(screen.getByText("section content")).toBeInTheDocument();
});

test("voter preset renders the collapsed icon rail", () => {
  render(
    <WorkspaceLayoutProvider initialPersona="voter">
      <LibrarySidebar>
        <p>section content</p>
      </LibrarySidebar>
    </WorkspaceLayoutProvider>,
  );
  expect(screen.queryByText("section content")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Expand library" })).toBeInTheDocument();
});

test("collapse and expand round-trip", () => {
  render(
    <WorkspaceLayoutProvider initialPersona="journalist">
      <LibrarySidebar />
    </WorkspaceLayoutProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Collapse library" }));
  fireEvent.click(screen.getByRole("button", { name: "Expand library" }));
  expect(screen.getByText("DistrictLens")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/workspace/__tests__/LibrarySidebar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/components/workspace/LibrarySidebar.tsx
"use client";

import type { ReactNode } from "react";
import { useWorkspaceLayout } from "./WorkspaceLayoutContext";
import { PersonaSwitch } from "./PersonaSwitch";
import type { Persona } from "@/lib/workspace/layout";

export function LibrarySidebar({
  children,
  onPersonaChange,
}: {
  children?: ReactNode;
  onPersonaChange?: (persona: Persona) => void;
}) {
  const { layout, toggleLibrary } = useWorkspaceLayout();

  if (layout.libraryCollapsed) {
    return (
      <aside
        aria-label="Library"
        className="hidden h-full w-12 shrink-0 flex-col items-center border-r border-zinc-800 bg-zinc-950 py-3 lg:flex"
      >
        <button
          type="button"
          onClick={toggleLibrary}
          aria-label="Expand library"
          className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Library"
      className="hidden h-full w-[260px] shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 lg:flex"
    >
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2.5">
        <span className="text-sm font-bold tracking-tight text-zinc-100">DistrictLens</span>
        <button
          type="button"
          onClick={toggleLibrary}
          aria-label="Collapse library"
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>
      <div className="border-b border-zinc-800 px-3 py-2">
        <PersonaSwitch onPersonaChange={onPersonaChange} />
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
    </aside>
  );
}
```

Note on `hidden lg:flex` and the tests: jsdom does not apply CSS, so the collapsed-rail assertions work because the *content* (`section content`, the brand) is conditionally rendered, not CSS-hidden. The `hidden lg:flex` classes are for real browsers (mobile gets the full-screen swap in Phase 6; until then the sidebar is desktop-only).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/workspace/__tests__/LibrarySidebar.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Full suite, commit**

```bash
git add web/src/components/workspace
git commit -m "feat(web): LibrarySidebar with collapse-to-rail"
git push origin main
```

### Task 5: Shared chat config + ChatPane

**Files:**
- Create: `web/src/lib/workspace/chat-config.ts`
- Create: `web/src/components/workspace/ChatPane.tsx`
- Test: `web/src/components/workspace/__tests__/ChatPane.test.tsx`

- [ ] **Step 1: Create the shared chat config (verbatim move — no test needed for constants)**

Copy `SYSTEM_PROMPT` (lines 22–42) and `CHAT_LABELS` (lines 44–49) from `web/src/app/page.tsx` **without editing their text**:

```ts
// web/src/lib/workspace/chat-config.ts
/** Shared by the /w workspace ChatPane. page.tsx keeps its own copy until it
 *  becomes the landing page (Task 19), at which point its copy is deleted. */

export const SYSTEM_PROMPT = `You are DistrictLens, a nonpartisan election-accountability assistant for the 2026 U.S. midterm cycle.

Your job: answer questions about congressional races, candidates, campaign finance, incumbent legislative records, and candidate policy positions. Always cite stored sources. When evidence is missing, say so directly.

Hard rules:
- NEVER recommend how to vote. If asked, decline and offer to compare candidates on a specific issue instead.
- NEVER write campaign content (ads, talking points, fundraising, persuasion).
- NEVER infer a candidate's position from donors or party affiliation alone.
- NEVER fabricate positions. If evidence is missing say "I found no direct statement in the indexed sources."
- Only cover federal 2026 congressional races. For state, county, municipal, or ballot-measure contests, say the tool's scope is federal and decline gracefully.

Voter brief — do NOT orchestrate it yourself:
The full voter brief runs as a deterministic server-side pipeline. When the user submits an address, the frontend sends "Build a complete voter brief for: <address>" and that pipeline resolves the district, candidates, finance, incumbent legislation, and every candidate's stances in a fixed order, streaming each step to the live progress tracker. Do NOT chain lookup_district, get_race_candidates, get_race_finance_brief, get_incumbent_legislation, or search_candidate_positions to assemble a brief — the pipeline owns that path.

Targeted follow-ups (use these for specific chat questions, not to rebuild a brief):
- search_candidate_positions(candidate_name, state, issue) → one candidate's stance on one issue the user names
- get_candidate_finance(candidate_id) → finance detail for a single candidate
- find_candidate(name, state) → look up a candidate in FEC filings

Journalist mode:
When the user asks to see all races in a state, or selects a state on the map (e.g. "Show me all 2026 congressional races in WI"), call get_state_races(state_code) once, then summarize in one sentence how many races there are and any notable fundraising gaps. Do NOT start the voter-brief workflow for this.`;

export const CHAT_LABELS = {
  title: "DistrictLens",
  initial:
    "Enter your address above to build your voter brief, or ask about any 2026 congressional race.",
  placeholder: "Ask about candidates, issues, or fundraising…",
};
```

(This is the exact prompt text from `page.tsx` — the civic-safety rules in it are law (`.claude/rules/`); diff against the source when copying and do not reword.)

- [ ] **Step 2: Write the failing ChatPane tests**

```tsx
// web/src/components/workspace/__tests__/ChatPane.test.tsx
import { test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@copilotkit/react-ui", () => ({
  CopilotChat: () => <div data-testid="copilot-chat" />,
}));

import { WorkspaceLayoutProvider } from "../WorkspaceLayoutContext";
import { ChatPane } from "../ChatPane";

beforeEach(() => window.localStorage.clear());

function renderPane(initialPersona: "voter" | "journalist" = "voter", statusMessage: string | null = null) {
  render(
    <WorkspaceLayoutProvider initialPersona={initialPersona}>
      <ChatPane statusMessage={statusMessage} />
    </WorkspaceLayoutProvider>,
  );
}

test("expanded pane renders the CopilotKit chat", () => {
  renderPane();
  expect(screen.getByTestId("copilot-chat")).toBeInTheDocument();
});

test("collapsing docks the chat to a strip that keeps the agent status visible", () => {
  renderPane("voter", "Searching FEC filings…");
  fireEvent.click(screen.getByRole("button", { name: "Collapse chat" }));
  expect(screen.queryByTestId("copilot-chat")).not.toBeInTheDocument();
  expect(screen.getByText("Searching FEC filings…")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Expand chat" }));
  expect(screen.getByTestId("copilot-chat")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/workspace/__tests__/ChatPane.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```tsx
// web/src/components/workspace/ChatPane.tsx
"use client";

import { CopilotChat } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { useWorkspaceLayout } from "./WorkspaceLayoutContext";
import { CHAT_LABELS, SYSTEM_PROMPT } from "@/lib/workspace/chat-config";

/**
 * Dockable CopilotKit chat. Collapsed it becomes a slim strip that still
 * surfaces the agent's live status — the build must never be hidden
 * (judging + trust requirement, spec §Agent visibility).
 */
export function ChatPane({ statusMessage }: { statusMessage?: string | null }) {
  const { layout, toggleChat } = useWorkspaceLayout();

  if (layout.chatCollapsed) {
    return (
      <div className="flex h-full w-10 shrink-0 flex-col items-center border-r border-zinc-800 bg-zinc-950 py-3">
        <button
          type="button"
          onClick={toggleChat}
          aria-label="Expand chat"
          className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </button>
        {statusMessage && (
          <span className="mt-3 max-h-64 truncate text-[10px] text-zinc-500 [writing-mode:vertical-rl]">
            {statusMessage}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Chat</span>
        <button
          type="button"
          onClick={toggleChat}
          aria-label="Collapse chat"
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <CopilotChat instructions={SYSTEM_PROMPT} labels={CHAT_LABELS} className="h-full" />
      </div>
    </div>
  );
}
```

(CopilotChat keeps its light default styling in Phase 1 — it gets dark CSS-variable overrides in Task 24.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/workspace/__tests__/ChatPane.test.tsx`
Expected: 2 passed.

- [ ] **Step 6: Full suite, commit**

```bash
git add web/src/lib/workspace/chat-config.ts web/src/components/workspace
git commit -m "feat(web): dockable ChatPane wrapping CopilotChat"
git push origin main
```

### Task 6: ArtifactPanel (Phase-1 form: receipt strip + RaceCanvas mount)

**Files:**
- Create: `web/src/components/workspace/ArtifactPanel.tsx`
- Test: `web/src/components/workspace/__tests__/ArtifactPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/components/workspace/__tests__/ArtifactPanel.test.tsx
import { test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/canvas/RaceCanvas", () => ({
  RaceCanvas: ({ state }: { state: { currentRaceKey: string | null } }) => (
    <div data-testid="race-canvas">{state.currentRaceKey}</div>
  ),
}));

import { ArtifactPanel } from "../ArtifactPanel";
import { DEFAULT_STATE, type DistrictLensState } from "@/types/agent-state";

const state = (over: Partial<DistrictLensState>): DistrictLensState => ({
  ...DEFAULT_STATE,
  currentRaceKey: "2026-H-WI-04",
  ...over,
});

test("no state renders the provided empty state", () => {
  render(<ArtifactPanel state={null} title={null} isDrafting={false} emptyState={<p>start here</p>} />);
  expect(screen.getByText("start here")).toBeInTheDocument();
  expect(screen.getByText("No artifact open")).toBeInTheDocument();
});

test("drafting shows the building badge and receipt strip", () => {
  render(
    <ArtifactPanel
      state={state({ stage: "finance", briefStartedAt: Date.now() })}
      title="U.S. House · WI-04"
      isDrafting
      emptyState={<p>start here</p>}
    />,
  );
  expect(screen.getByText("building…")).toBeInTheDocument();
  // ReceiptProgress renders the finance stage's step labels
  expect(screen.getByText(/finance/i)).toBeInTheDocument();
  expect(screen.getByTestId("race-canvas")).toBeInTheDocument();
});

test("complete brief renders title and RaceCanvas without the building badge", () => {
  render(
    <ArtifactPanel
      state={state({ stage: "complete" })}
      title="U.S. House · WI-04"
      isDrafting={false}
      emptyState={<p>start here</p>}
    />,
  );
  expect(screen.getByText("U.S. House · WI-04")).toBeInTheDocument();
  expect(screen.queryByText("building…")).not.toBeInTheDocument();
  expect(screen.getByTestId("race-canvas")).toHaveTextContent("2026-H-WI-04");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/workspace/__tests__/ArtifactPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/components/workspace/ArtifactPanel.tsx
"use client";

import type { ReactNode } from "react";
import { RaceCanvas } from "@/components/canvas/RaceCanvas";
import { ReceiptProgress } from "@/components/canvas/ReceiptProgress";
import { annotateSteps, stepsFromStage } from "@/lib/steps";
import type { DistrictLensState } from "@/types/agent-state";

interface ArtifactPanelProps {
  /** Brief being displayed — live draft or reopened snapshot. Null = nothing open. */
  state: DistrictLensState | null;
  title: string | null;
  isDrafting: boolean;
  /** What to show when no artifact is open (persona-specific, supplied by the page). */
  emptyState: ReactNode;
  /** Extra header actions (history ▾, share — arrive in later phases). */
  headerActions?: ReactNode;
}

export function ArtifactPanel({ state, title, isDrafting, emptyState, headerActions }: ArtifactPanelProps) {
  const steps = state ? annotateSteps(stepsFromStage(state.stage), state) : [];
  const hasBrief = Boolean(state?.currentRaceKey);

  return (
    <section aria-label="Artifact" className="flex h-full min-w-0 flex-col bg-zinc-900">
      <header className="shrink-0 border-b border-zinc-800 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" aria-hidden />
          <span className="truncate text-sm font-medium text-zinc-200">
            {title ?? "No artifact open"}
          </span>
          {isDrafting && (
            <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
              building…
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">{headerActions}</span>
        </div>
        {isDrafting && steps.length > 0 && state && (
          // Receipt strip across the artifact top while drafting (spec §Artifact state).
          // ReceiptProgress is still light-styled — white plate is the Phase-1 waypoint.
          <div className="mt-2 rounded-md bg-white px-3 py-2">
            <ReceiptProgress
              steps={steps}
              briefStartedAt={state.briefStartedAt}
              statusMessage={state.status_message}
              horizontal
            />
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {hasBrief && state ? (
          // "Paper on dark desk": RaceCanvas stays light until the Phase-3 token pass.
          <div className="min-h-full bg-white">
            <RaceCanvas state={state} />
          </div>
        ) : (
          emptyState
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/workspace/__tests__/ArtifactPanel.test.tsx`
Expected: 3 passed. If the `/finance/i` assertion is ambiguous (multiple matches), switch it to `screen.getAllByText(/finance/i).length` being `>= 1` — check `lib/steps.ts` step labels when writing the real test.

- [ ] **Step 5: Full suite, commit**

```bash
git add web/src/components/workspace
git commit -m "feat(web): ArtifactPanel with receipt strip and RaceCanvas mount"
git push origin main
```

### Task 7: WorkspaceShell (three-pane frame + draggable divider)

**Files:**
- Create: `web/src/components/workspace/WorkspaceShell.tsx`
- Test: `web/src/components/workspace/__tests__/WorkspaceShell.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/components/workspace/__tests__/WorkspaceShell.test.tsx
import { test, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceLayoutProvider } from "../WorkspaceLayoutContext";
import { WorkspaceShell } from "../WorkspaceShell";
import { LAYOUT_STORAGE_KEY } from "@/lib/workspace/layout";

beforeEach(() => window.localStorage.clear());

function renderShell(initialPersona: "voter" | "journalist" = "journalist") {
  return render(
    <WorkspaceLayoutProvider initialPersona={initialPersona}>
      <WorkspaceShell
        library={<aside>LIB</aside>}
        chat={<div>CHAT</div>}
        artifact={<div>ARTIFACT</div>}
      />
    </WorkspaceLayoutProvider>,
  );
}

test("renders all three panes and the divider", () => {
  renderShell();
  expect(screen.getByText("LIB")).toBeInTheDocument();
  expect(screen.getByText("CHAT")).toBeInTheDocument();
  expect(screen.getByText("ARTIFACT")).toBeInTheDocument();
  expect(screen.getByRole("separator")).toBeInTheDocument();
});

test("no divider when the chat is collapsed", () => {
  window.localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    JSON.stringify({ persona: "journalist", libraryCollapsed: false, chatCollapsed: true, chatPct: 40 }),
  );
  renderShell();
  expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  expect(screen.getByText("ARTIFACT")).toBeInTheDocument();
});

test("dragging the divider updates the persisted chat width within bounds", () => {
  renderShell();
  const container = screen.getByTestId("workspace-split");
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
    left: 0, right: 1000, top: 0, bottom: 800, width: 1000, height: 800, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);

  fireEvent.mouseDown(screen.getByRole("separator"));
  fireEvent.mouseMove(window, { clientX: 300 }); // 30% of 1000px
  fireEvent.mouseUp(window);

  const stored = JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY)!);
  expect(stored.chatPct).toBe(30);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/workspace/__tests__/WorkspaceShell.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation** (Crate's resizable-split pattern, adapted: the divider sits between chat and artifact, width measured from the split container's left edge)

```tsx
// web/src/components/workspace/WorkspaceShell.tsx
"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useWorkspaceLayout } from "./WorkspaceLayoutContext";

/**
 * Three-pane frame: Library · Chat · Artifact, with a draggable divider
 * between chat and artifact (Crate resizable-split pattern). Pane state
 * lives in WorkspaceLayoutContext and persists to localStorage.
 */
export function WorkspaceShell({
  library,
  chat,
  artifact,
}: {
  library: ReactNode;
  chat: ReactNode;
  artifact: ReactNode;
}) {
  const { layout, setChatPct } = useWorkspaceLayout();
  const splitRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const startDrag = useCallback(() => {
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      if (!isDragging.current || !splitRef.current) return;
      const rect = splitRef.current.getBoundingClientRect();
      if (rect.width === 0) return;
      const pct = ((event.clientX - rect.left) / rect.width) * 100;
      setChatPct(pct); // context clamps to [CHAT_PCT_MIN, CHAT_PCT_MAX]
    }
    function onMouseUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [setChatPct]);

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      {library}
      <div ref={splitRef} data-testid="workspace-split" className="flex min-w-0 flex-1">
        {layout.chatCollapsed ? (
          <>
            {chat}
            <div className="min-w-0 flex-1">{artifact}</div>
          </>
        ) : (
          <>
            <div style={{ width: `${layout.chatPct}%` }} className="min-w-0 shrink-0">
              {chat}
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={startDrag}
              className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-zinc-800 transition-colors hover:bg-zinc-700"
            >
              <div className="h-8 w-0.5 rounded-full bg-zinc-600" />
            </div>
            <div className="min-w-0 flex-1">{artifact}</div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/workspace/__tests__/WorkspaceShell.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Full suite, commit**

```bash
git add web/src/components/workspace
git commit -m "feat(web): WorkspaceShell three-pane frame with draggable divider"
git push origin main
```

### Task 8: useWorkspaceAgent hook + `/w` route

**Files:**
- Create: `web/src/lib/workspace/useWorkspaceAgent.ts`
- Create: `web/src/app/w/page.tsx`

This is glue extracted from `page.tsx` (lines 77–196, 456–465) — the logic is already covered by the existing brief-display/steps unit tests; the new code is hook plumbing, verified by build + the Task 10 dogfood gate. **`web/src/app/page.tsx` is not modified.**

- [ ] **Step 1: Write the hook**

```ts
// web/src/lib/workspace/useWorkspaceAgent.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCoAgent, useCopilotReadable } from "@copilotkit/react-core";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { pickDisplayedBrief, type DisplayedBrief } from "@/lib/brief-display";
import { DEFAULT_STATE, type AppMode, type DistrictLensState } from "@/types/agent-state";

/**
 * CopilotKit agent wiring for the workspace — extracted from the legacy
 * page.tsx so the shell components stay presentation-only.
 */
export function useWorkspaceAgent() {
  const { agent } = useAgent({ agentId: "districtlens_root" });
  const { copilotkit } = useCopilotKit();
  const { state: agentState, setState: setAgentState } = useCoAgent<DistrictLensState>({
    name: "districtlens_root",
    initialState: DEFAULT_STATE,
  });

  // Which mode loaded the current brief (each persona keeps its own view).
  const [lastBriefMode, setLastBriefMode] = useState<AppMode | null>(null);
  // Last live brief, captured continuously — survives coagent state clearing.
  const [briefSnapshot, setBriefSnapshot] = useState<DisplayedBrief | null>(null);
  const prevStageRef = useRef<string>("idle");

  useCopilotReadable({
    description: "Current app mode and selected race",
    value: `Mode: ${agentState.mode}. Current race: ${agentState.currentRaceKey ?? "none"}.`,
  });

  useEffect(() => {
    if (prevStageRef.current === "idle" && agentState.stage !== "idle") {
      setAgentState((prev) => ({ ...DEFAULT_STATE, ...prev, briefStartedAt: Date.now() }));
    }
    prevStageRef.current = agentState.stage;
  }, [agentState.stage, setAgentState]);

  useEffect(() => {
    if (agentState.currentRaceKey && lastBriefMode) {
      setBriefSnapshot({ mode: lastBriefMode, state: agentState });
    }
  }, [agentState, lastBriefMode]);

  const run = useCallback(
    (content: string) => {
      if (agent.isRunning) return;
      agent.addMessage({ id: crypto.randomUUID(), role: "user", content });
      copilotkit.runAgent({ agent }).catch(() => {
        /* surfaced through chat UI; workspace stays usable */
      });
    },
    [agent, copilotkit],
  );

  const submitAddress = useCallback(
    (address: string) => {
      if (!address.trim()) return;
      setLastBriefMode("voter");
      run(`Build a complete voter brief for: ${address}`);
    },
    [run],
  );

  const exploreState = useCallback(
    (stateCode: string) => run(`Show me all 2026 congressional races in ${stateCode}.`),
    [run],
  );

  const openRace = useCallback(
    (raceKey: string) => {
      setLastBriefMode("journalist");
      run(`Build a complete voter brief for race: ${raceKey}`);
    },
    [run],
  );

  const setMode = useCallback(
    (mode: AppMode) => setAgentState((prev) => ({ ...DEFAULT_STATE, ...prev, mode })),
    [setAgentState],
  );

  /** Wipes everything that feeds the artifact panel (thread-switch reset), keeping the persona. */
  const clearBrief = useCallback(() => {
    setBriefSnapshot(null);
    setLastBriefMode(null);
    setAgentState((prev) => ({ ...DEFAULT_STATE, mode: prev?.mode ?? DEFAULT_STATE.mode }));
  }, [setAgentState]);

  const displayed = pickDisplayedBrief(agentState, briefSnapshot, lastBriefMode);

  return {
    agentState,
    setAgentState,
    displayed,
    isRunning: agent.isRunning,
    submitAddress,
    exploreState,
    openRace,
    setMode,
    clearBrief,
  };
}
```

- [ ] **Step 2: Write the `/w` page**

```tsx
// web/src/app/w/page.tsx
"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CopilotChat } from "@copilotkit/react-ui";
import { AgentToolTrace } from "@/components/canvas/AgentToolTrace";
import { CanvasEmptyState } from "@/components/canvas/CanvasEmptyState";
import { RaceTable } from "@/components/canvas/RaceTable";
import { USMap } from "@/components/map/USMap";
import { ArtifactPanel } from "@/components/workspace/ArtifactPanel";
import { ChatPane } from "@/components/workspace/ChatPane";
import { LibrarySidebar } from "@/components/workspace/LibrarySidebar";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import {
  WorkspaceLayoutProvider,
  useWorkspaceLayout,
} from "@/components/workspace/WorkspaceLayoutContext";
import { CHAT_LABELS, SYSTEM_PROMPT } from "@/lib/workspace/chat-config";
import { useWorkspaceAgent } from "@/lib/workspace/useWorkspaceAgent";
import { deriveLabel } from "@/lib/saved-briefs/schema";
import type { Persona } from "@/lib/workspace/layout";

function WorkspaceInner() {
  const params = useSearchParams();
  const { setPersona } = useWorkspaceLayout();
  const { agentState, displayed, submitAddress, exploreState, openRace, setMode } =
    useWorkspaceAgent();
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const kickedOff = useRef(false);

  // Landing handoff: /w?addr=… starts a voter brief; /w?state=XX opens the
  // journalist state view. Runs once.
  useEffect(() => {
    if (kickedOff.current) return;
    const addr = params.get("addr");
    const stateCode = params.get("state");
    if (addr) {
      kickedOff.current = true;
      submitAddress(addr);
    } else if (stateCode) {
      kickedOff.current = true;
      setPersona("journalist");
      setMode("journalist");
      exploreState(stateCode);
    }
  }, [params, submitAddress, exploreState, setMode, setPersona]);

  const handlePersonaChange = (persona: Persona) => setMode(persona);

  const isJournalist = agentState.mode === "journalist";
  const showBrief = displayed
    ? isJournalist
      ? displayed.mode === "journalist"
      : displayed.mode === "voter"
    : false;
  const briefState = showBrief && displayed ? displayed.state : null;
  const isDrafting = agentState.stage !== "idle" && agentState.stage !== "complete";
  const panelState = briefState ?? (isDrafting ? agentState : null);
  const title = panelState?.currentRaceKey ? deriveLabel(panelState.currentRaceKey) : null;

  const emptyState = isJournalist ? (
    <div className="flex h-full flex-col overflow-y-auto bg-white">
      <div className="shrink-0 p-4">
        <USMap
          focusedState={agentState.mapFocus}
          onStateClick={exploreState}
          mode={agentState.mode}
          heatmapData={agentState.stateRaces}
        />
      </div>
      {agentState.stateRaces.length > 0 ? (
        <RaceTable races={agentState.stateRaces} onRaceClick={openRace} />
      ) : (
        <p className="px-4 text-sm text-slate-400">
          Click a state on the map to explore its 2026 races.
        </p>
      )}
    </div>
  ) : (
    <div className="h-full bg-white">
      <CanvasEmptyState onSubmit={(addr) => addr && submitAddress(addr)} />
    </div>
  );

  return (
    <>
      {/* Renders agent tool calls (incl. MongoDB MCP) inline in the chat */}
      <AgentToolTrace />
      <WorkspaceShell
        library={<LibrarySidebar onPersonaChange={handlePersonaChange} />}
        chat={<ChatPane statusMessage={agentState.status_message} />}
        artifact={
          <ArtifactPanel
            state={panelState}
            title={title}
            isDrafting={isDrafting}
            emptyState={emptyState}
          />
        }
      />

      {/* Mobile chat: floating trigger + bottom sheet (full mobile swap is Phase 6) */}
      <button
        type="button"
        onClick={() => setMobileChatOpen(true)}
        className="fixed bottom-4 right-4 z-30 rounded-full border border-zinc-700 bg-zinc-800 px-5 py-3 text-sm font-semibold text-white shadow-lg lg:hidden"
      >
        Ask
      </button>
      {mobileChatOpen && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileChatOpen(false)}
            aria-hidden
          />
          <div className="relative flex h-[80vh] flex-col rounded-t-xl border-t border-zinc-700 bg-zinc-950">
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
              <span className="text-sm font-bold text-zinc-100">DistrictLens</span>
              <button
                type="button"
                onClick={() => setMobileChatOpen(false)}
                aria-label="Close chat"
                className="text-zinc-500 hover:text-zinc-200"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <CopilotChat instructions={SYSTEM_PROMPT} labels={CHAT_LABELS} className="h-full" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function WorkspacePage() {
  const params = useSearchParams();
  const initialPersona: Persona = params.get("state") ? "journalist" : "voter";
  return (
    <WorkspaceLayoutProvider initialPersona={initialPersona}>
      <WorkspaceInner />
    </WorkspaceLayoutProvider>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <WorkspacePage />
    </Suspense>
  );
}
```

Implementation notes for the executor:
- `useSearchParams` requires the `<Suspense>` boundary — check `node_modules/next/dist/docs/` per `web/AGENTS.md` in case this Next version changed the convention.
- `deriveLabel` is exported from `@/lib/saved-briefs/schema` ("2026-H-WI-04" → "U.S. House · WI-04").
- The CopilotKit provider already wraps the whole app from `app/providers.tsx`, so `/w` needs no provider work.

- [ ] **Step 3: Verify it builds and the suite stays green**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

Run: `cd web && npm run build`
Expected: build succeeds, `/w` listed in the route table.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/workspace/useWorkspaceAgent.ts web/src/app/w
git commit -m "feat(web): /w workspace route wiring shell to the coagent"
git push origin main
```

### Task 9: Workspace smoke dogfood (gate before Phase 2)

No new files. Browser verification with screenshot evidence (gstack `browse` skill).

- [ ] **Step 1: Start the dev server**

Run: `cd web && npm run dev` (background). Wait for `Ready`.

- [ ] **Step 2: Dogfood checklist (screenshots each)**

1. `http://localhost:3000/w` → dark three-pane shell renders; voter preset (library rail, chat ~28%).
2. Type an address into the empty-state input → receipt strip appears in the artifact header, chat streams tool activity, brief builds section-by-section, `RaceCanvas` shows white-on-dark.
3. Drag the divider → widths change, bounded; reload → width persisted.
4. Switch persona to Journalist → library expands, chat widens to 40%; click a state on the map → race table loads; click a race → brief builds.
5. `http://localhost:3000/` → old page still fully intact.

- [ ] **Step 3: Fix anything broken, then commit any fixes and deploy checkpoint**

Optional deploy (Tarik's call): `gcloud run deploy districtlens-web --source web --region us-central1 --project civicsync-440613`

```bash
git commit -am "fix(web): phase-1 dogfood fixes" # only if fixes were needed
git push origin main
```

---

# Phase 2 — Artifact layer

Outcome: completed briefs auto-snapshot into a local-first library with linear versions; library sidebar gets real sections (Recents, All artifacts, My Ballot, Threads); `/w?a=<id>` deep-links; sign-in pushes local artifacts to Mongo; `/` becomes the landing page and the 785-line monolith is deleted.

### Task 10: Artifact types + lifecycle (pure)

**Files:**
- Create: `web/src/lib/artifacts/types.ts`
- Create: `web/src/lib/artifacts/lifecycle.ts`
- Test: `web/src/lib/artifacts/__tests__/lifecycle.test.ts`

- [ ] **Step 1: Write the types (no test — type-only file)**

```ts
// web/src/lib/artifacts/types.ts
import type { BriefFingerprint } from "@/lib/brief-fingerprint";
import type { SourceRef } from "@/lib/saved-briefs/schema";
import type { DistrictLensState } from "@/types/agent-state";

export type ArtifactType = "brief" | "comparison" | "overview" | "lead";

/** One immutable snapshot. Versions are append-only (linear history). */
export interface ArtifactVersion {
  versionId: string;
  savedAt: string; // ISO
  snapshot: DistrictLensState;
  fingerprint: BriefFingerprint;
  sourceRefs: SourceRef[];
}

export interface ArtifactRecord {
  artifactId: string;
  type: ArtifactType;
  name: string;
  raceKey: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  versions: ArtifactVersion[];
  /** Set after a one-shot sign-in push to Mongo (Task 18). */
  syncedAt?: string;
}
```

- [ ] **Step 2: Write the failing lifecycle tests**

```ts
// web/src/lib/artifacts/__tests__/lifecycle.test.ts
import { test, expect } from "vitest";
import {
  deriveArtifactName,
  shouldSnapshot,
  snapshotBrief,
} from "@/lib/artifacts/lifecycle";
import { DEFAULT_STATE, type DistrictLensState } from "@/types/agent-state";

const complete = (over: Partial<DistrictLensState> = {}): DistrictLensState => ({
  ...DEFAULT_STATE,
  stage: "complete",
  currentRaceKey: "2026-H-WI-04",
  candidates: [
    {
      candidateId: "C1",
      name: "A. Person",
      party: "DEM",
      status: "challenger",
      photoUrl: "",
      photoSource: "placeholder",
      raceKey: "2026-H-WI-04",
    },
  ],
  ...over,
});

const ids = { artifactId: "art-1", versionId: "v-1" };
const NOW = new Date("2026-06-09T12:00:00Z");

// --- shouldSnapshot: snapshot ONLY on the transition into complete ---

test("snapshots on the transition into complete", () => {
  expect(shouldSnapshot("positions", "complete", "2026-H-WI-04")).toBe(true);
});

test("does not snapshot while still drafting", () => {
  expect(shouldSnapshot("finance", "positions", "2026-H-WI-04")).toBe(false);
});

test("does not re-snapshot when stage stays complete across renders", () => {
  expect(shouldSnapshot("complete", "complete", "2026-H-WI-04")).toBe(false);
});

test("failed/incomplete builds never save: no race key means no snapshot", () => {
  expect(shouldSnapshot("district", "complete", null)).toBe(false);
});

// --- snapshotBrief ---

test("first snapshot creates a named single-version record", () => {
  const record = snapshotBrief(complete(), null, ids, NOW);
  expect(record.type).toBe("brief");
  expect(record.name).toBe("U.S. House · WI-04 · 2026");
  expect(record.raceKey).toBe("2026-H-WI-04");
  expect(record.versions).toHaveLength(1);
  expect(record.versions[0].savedAt).toBe(NOW.toISOString());
});

test("identical fingerprint dedupes: returns the existing record unchanged", () => {
  const first = snapshotBrief(complete(), null, ids, NOW);
  const again = snapshotBrief(complete(), first, { artifactId: "x", versionId: "v-2" }, NOW);
  expect(again).toBe(first);
  expect(again.versions).toHaveLength(1);
});

test("changed evidence appends a new version, old version untouched", () => {
  const first = snapshotBrief(complete(), null, ids, NOW);
  const refreshed = complete({
    positions: [
      {
        candidateName: "A. Person",
        issue: "housing",
        answer: "Supports zoning reform.",
        sources: [],
      },
    ],
  });
  const second = snapshotBrief(refreshed, first, { artifactId: "x", versionId: "v-2" }, NOW);
  expect(second.versions).toHaveLength(2);
  expect(second.versions[0]).toBe(first.versions[0]); // immutable old version
  expect(second.versions[1].versionId).toBe("v-2");
});

test("snapshotBrief refuses a state without a race key", () => {
  expect(() => snapshotBrief({ ...DEFAULT_STATE, stage: "complete" }, null, ids, NOW)).toThrow();
});

test("deriveArtifactName formats race key with year", () => {
  expect(deriveArtifactName("2026-H-WI-04")).toBe("U.S. House · WI-04 · 2026");
});
```

(Check `deriveLabel`'s exact output in `lib/saved-briefs/schema.ts` before finalizing the name assertions — if it returns e.g. `"U.S. House · WI-04"` the expected strings above are right; adjust to its real format if it differs.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/artifacts/__tests__/lifecycle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```ts
// web/src/lib/artifacts/lifecycle.ts
import { computeFingerprint, type BriefFingerprint } from "@/lib/brief-fingerprint";
import { collectSourceRefs, deriveLabel } from "@/lib/saved-briefs/schema";
import type { DistrictLensState } from "@/types/agent-state";
import type { ArtifactRecord, ArtifactVersion } from "./types";

/**
 * Auto-snapshot fires only on the transition INTO `complete` with a race key.
 * Failed or partial builds never reach the library (spec §Error handling).
 */
export function shouldSnapshot(
  prevStage: string,
  stage: string,
  raceKey: string | null,
): boolean {
  return stage === "complete" && prevStage !== "complete" && raceKey !== null;
}

export function fingerprintsEqual(a: BriefFingerprint, b: BriefFingerprint): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function deriveArtifactName(raceKey: string): string {
  const year = raceKey.split("-")[0];
  return `${deriveLabel(raceKey)} · ${year}`;
}

/**
 * Snapshot a completed brief. Returns a NEW record (immutability rule):
 * - no existing record → single-version record with a generated name
 * - identical latest fingerprint → existing record returned as-is (dedupe)
 * - changed fingerprint → new version appended; prior versions untouched
 */
export function snapshotBrief(
  state: DistrictLensState,
  existing: ArtifactRecord | null,
  ids: { artifactId: string; versionId: string },
  now: Date = new Date(),
): ArtifactRecord {
  if (!state.currentRaceKey) {
    throw new Error("Cannot snapshot a brief without a race key");
  }
  const fingerprint = computeFingerprint(state);
  const version: ArtifactVersion = {
    versionId: ids.versionId,
    savedAt: now.toISOString(),
    snapshot: state,
    fingerprint,
    sourceRefs: collectSourceRefs(state),
  };

  if (!existing) {
    return {
      artifactId: ids.artifactId,
      type: "brief",
      name: deriveArtifactName(state.currentRaceKey),
      raceKey: state.currentRaceKey,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      versions: [version],
    };
  }

  const latest = existing.versions[existing.versions.length - 1];
  if (latest && fingerprintsEqual(latest.fingerprint, fingerprint)) {
    return existing;
  }
  return {
    ...existing,
    updatedAt: now.toISOString(),
    versions: [...existing.versions, version],
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/artifacts/__tests__/lifecycle.test.ts`
Expected: 9 passed.

- [ ] **Step 6: Full suite, commit**

```bash
git add web/src/lib/artifacts
git commit -m "feat(web): artifact lifecycle - snapshot on complete, linear versions, dedupe"
git push origin main
```

### Task 11: Local artifact store (localStorage with degradation)

**Files:**
- Create: `web/src/lib/artifacts/local-store.ts`
- Test: `web/src/lib/artifacts/__tests__/local-store.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/lib/artifacts/__tests__/local-store.test.ts
import { test, expect } from "vitest";
import { ARTIFACTS_STORAGE_KEY, createLocalArtifactStore } from "@/lib/artifacts/local-store";
import type { ArtifactRecord } from "@/lib/artifacts/types";

const record = (over: Partial<ArtifactRecord> = {}): ArtifactRecord => ({
  artifactId: "art-1",
  type: "brief",
  name: "U.S. House · WI-04 · 2026",
  raceKey: "2026-H-WI-04",
  createdAt: "2026-06-09T12:00:00Z",
  updatedAt: "2026-06-09T12:00:00Z",
  versions: [],
  ...over,
});

function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

test("upsert then list round-trips through storage", () => {
  const storage = fakeStorage();
  const store = createLocalArtifactStore(storage);
  expect(store.upsert(record())).toBe(true);
  const rehydrated = createLocalArtifactStore(storage);
  expect(rehydrated.list()).toHaveLength(1);
  expect(rehydrated.get("art-1")?.name).toBe("U.S. House · WI-04 · 2026");
});

test("list is sorted by updatedAt descending", () => {
  const store = createLocalArtifactStore(fakeStorage());
  store.upsert(record({ artifactId: "old", updatedAt: "2026-06-01T00:00:00Z" }));
  store.upsert(record({ artifactId: "new", updatedAt: "2026-06-09T00:00:00Z" }));
  expect(store.list().map((r) => r.artifactId)).toEqual(["new", "old"]);
});

test("findByRaceKey matches type and race", () => {
  const store = createLocalArtifactStore(fakeStorage());
  store.upsert(record());
  expect(store.findByRaceKey("2026-H-WI-04", "brief")?.artifactId).toBe("art-1");
  expect(store.findByRaceKey("2026-H-WI-05", "brief")).toBeNull();
});

test("rename and remove", () => {
  const store = createLocalArtifactStore(fakeStorage());
  store.upsert(record());
  expect(store.rename("art-1", "My ballot race")).toBe(true);
  expect(store.get("art-1")?.name).toBe("My ballot race");
  store.remove("art-1");
  expect(store.get("art-1")).toBeNull();
});

test("null storage degrades to in-memory (no crash, available=false)", () => {
  const store = createLocalArtifactStore(null);
  expect(store.available).toBe(false);
  expect(store.upsert(record())).toBe(true);
  expect(store.list()).toHaveLength(1);
});

test("quota errors degrade: upsert returns false but memory copy survives", () => {
  const storage = fakeStorage();
  storage.setItem = () => {
    throw new DOMException("quota", "QuotaExceededError");
  };
  const store = createLocalArtifactStore(storage);
  expect(store.upsert(record())).toBe(false);
  expect(store.list()).toHaveLength(1); // session-only copy
});

test("corrupt stored JSON resets to an empty library", () => {
  const storage = fakeStorage();
  storage.setItem(ARTIFACTS_STORAGE_KEY, "{corrupt");
  const store = createLocalArtifactStore(storage);
  expect(store.list()).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/artifacts/__tests__/local-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/artifacts/local-store.ts
import type { ArtifactRecord, ArtifactType } from "./types";

export const ARTIFACTS_STORAGE_KEY = "districtlens.artifacts.v1";

export interface ArtifactStore {
  /** False when localStorage is missing/blocked — session-only mode. */
  available: boolean;
  list(): ArtifactRecord[];
  get(artifactId: string): ArtifactRecord | null;
  /** Returns false when the write could not be persisted (quota/unavailable). */
  upsert(record: ArtifactRecord): boolean;
  rename(artifactId: string, name: string): boolean;
  remove(artifactId: string): void;
  findByRaceKey(raceKey: string, type: ArtifactType): ArtifactRecord | null;
}

function readAll(storage: Storage | null): ArtifactRecord[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(ARTIFACTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ArtifactRecord[]) : [];
  } catch {
    return []; // corrupt store → empty library, never a crash
  }
}

export function createLocalArtifactStore(storage: Storage | null): ArtifactStore {
  // In-memory mirror is the source of truth for reads; storage is the durable
  // copy. Quota failures keep the session copy alive (spec §Error handling).
  let records: ArtifactRecord[] = readAll(storage);

  function persist(): boolean {
    if (!storage) return false;
    try {
      storage.setItem(ARTIFACTS_STORAGE_KEY, JSON.stringify(records));
      return true;
    } catch {
      return false;
    }
  }

  return {
    available: storage !== null,

    list(): ArtifactRecord[] {
      return [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    get(artifactId: string): ArtifactRecord | null {
      return records.find((r) => r.artifactId === artifactId) ?? null;
    },

    upsert(record: ArtifactRecord): boolean {
      const index = records.findIndex((r) => r.artifactId === record.artifactId);
      records =
        index === -1
          ? [...records, record]
          : [...records.slice(0, index), record, ...records.slice(index + 1)];
      return persist();
    },

    rename(artifactId: string, name: string): boolean {
      const existing = records.find((r) => r.artifactId === artifactId);
      if (!existing) return false;
      records = records.map((r) =>
        r.artifactId === artifactId
          ? { ...r, name, updatedAt: new Date().toISOString() }
          : r,
      );
      persist();
      return true;
    },

    remove(artifactId: string): void {
      records = records.filter((r) => r.artifactId !== artifactId);
      persist();
    },

    findByRaceKey(raceKey: string, type: ArtifactType): ArtifactRecord | null {
      return records.find((r) => r.raceKey === raceKey && r.type === type) ?? null;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/artifacts/__tests__/local-store.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Full suite, commit**

```bash
git add web/src/lib/artifacts
git commit -m "feat(web): local artifact store with quota degradation"
git push origin main
```

### Task 12: ArtifactProvider (library context + auto-snapshot)

**Files:**
- Create: `web/src/components/workspace/ArtifactProvider.tsx`
- Test: `web/src/components/workspace/__tests__/ArtifactProvider.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/components/workspace/__tests__/ArtifactProvider.test.tsx
import { test, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ArtifactProvider, useArtifacts } from "../ArtifactProvider";
import { createLocalArtifactStore } from "@/lib/artifacts/local-store";
import { DEFAULT_STATE, type DistrictLensState } from "@/types/agent-state";

let api: ReturnType<typeof useArtifacts>;

function Probe() {
  api = useArtifacts();
  return <span data-testid="count">{api.library.length}</span>;
}

const completeState = (over: Partial<DistrictLensState> = {}): DistrictLensState => ({
  ...DEFAULT_STATE,
  stage: "complete",
  currentRaceKey: "2026-H-WI-04",
  ...over,
});

function renderProvider() {
  const store = createLocalArtifactStore(null); // in-memory for tests
  render(
    <ArtifactProvider store={store}>
      <Probe />
    </ArtifactProvider>,
  );
  return store;
}

beforeEach(() => window.localStorage.clear());

test("starts with an empty library", () => {
  renderProvider();
  expect(screen.getByTestId("count").textContent).toBe("0");
});

test("recordSnapshot adds a brief artifact to the library and store", () => {
  const store = renderProvider();
  act(() => {
    api.recordSnapshot(completeState());
  });
  expect(api.library).toHaveLength(1);
  expect(api.library[0].type).toBe("brief");
  expect(store.list()).toHaveLength(1);
});

test("snapshotting the same race twice with identical evidence keeps one version", () => {
  renderProvider();
  act(() => void api.recordSnapshot(completeState()));
  act(() => void api.recordSnapshot(completeState()));
  expect(api.library).toHaveLength(1);
  expect(api.library[0].versions).toHaveLength(1);
});

test("open / close an artifact", () => {
  renderProvider();
  act(() => void api.recordSnapshot(completeState()));
  const id = api.library[0].artifactId;
  act(() => api.openArtifact(id));
  expect(api.active?.artifactId).toBe(id);
  expect(api.activeVersionIndex).toBe(0);
  act(() => api.closeArtifact());
  expect(api.active).toBeNull();
});

test("openArtifact with an unknown id leaves active null (dead-link path)", () => {
  renderProvider();
  act(() => api.openArtifact("nope"));
  expect(api.active).toBeNull();
});

test("rename and delete update both context and store", () => {
  const store = renderProvider();
  act(() => void api.recordSnapshot(completeState()));
  const id = api.library[0].artifactId;
  act(() => api.renameArtifact(id, "Maya's race"));
  expect(store.get(id)?.name).toBe("Maya's race");
  act(() => api.deleteArtifact(id));
  expect(api.library).toHaveLength(0);
  expect(store.get(id)).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/workspace/__tests__/ArtifactProvider.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/components/workspace/ArtifactProvider.tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { snapshotBrief } from "@/lib/artifacts/lifecycle";
import {
  createLocalArtifactStore,
  type ArtifactStore,
} from "@/lib/artifacts/local-store";
import type { ArtifactRecord } from "@/lib/artifacts/types";
import type { DistrictLensState } from "@/types/agent-state";

interface ArtifactContextValue {
  library: ArtifactRecord[];
  active: ArtifactRecord | null;
  activeVersionIndex: number;
  storageAvailable: boolean;
  openArtifact: (artifactId: string) => void;
  closeArtifact: () => void;
  selectVersion: (index: number) => void;
  renameArtifact: (artifactId: string, name: string) => void;
  deleteArtifact: (artifactId: string) => void;
  /** Snapshot a completed brief into the library. Returns the record, or null if nothing saved. */
  recordSnapshot: (state: DistrictLensState) => ArtifactRecord | null;
}

const ArtifactContext = createContext<ArtifactContextValue | null>(null);

function defaultStore(): ArtifactStore {
  if (typeof window === "undefined") return createLocalArtifactStore(null);
  try {
    return createLocalArtifactStore(window.localStorage);
  } catch {
    return createLocalArtifactStore(null);
  }
}

export function ArtifactProvider({
  children,
  store,
}: {
  children: ReactNode;
  /** Injectable for tests; defaults to localStorage. */
  store?: ArtifactStore;
}) {
  const [artifactStore] = useState<ArtifactStore>(() => store ?? defaultStore());
  const [library, setLibrary] = useState<ArtifactRecord[]>(() => artifactStore.list());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeVersionIndex, setActiveVersionIndex] = useState(0);

  const active = useMemo(
    () => library.find((r) => r.artifactId === activeId) ?? null,
    [library, activeId],
  );

  const refresh = useCallback(() => setLibrary(artifactStore.list()), [artifactStore]);

  const openArtifact = useCallback(
    (artifactId: string) => {
      const record = artifactStore.get(artifactId);
      if (!record) return; // dead link — caller renders "not in your library"
      setActiveId(artifactId);
      setActiveVersionIndex(record.versions.length > 0 ? record.versions.length - 1 : 0);
    },
    [artifactStore],
  );

  const closeArtifact = useCallback(() => {
    setActiveId(null);
    setActiveVersionIndex(0);
  }, []);

  const selectVersion = useCallback(
    (index: number) => {
      if (!active) return;
      const clamped = Math.min(Math.max(index, 0), active.versions.length - 1);
      setActiveVersionIndex(clamped);
    },
    [active],
  );

  const renameArtifact = useCallback(
    (artifactId: string, name: string) => {
      artifactStore.rename(artifactId, name);
      refresh();
    },
    [artifactStore, refresh],
  );

  const deleteArtifact = useCallback(
    (artifactId: string) => {
      artifactStore.remove(artifactId);
      setActiveId((current) => (current === artifactId ? null : current));
      refresh();
    },
    [artifactStore, refresh],
  );

  const recordSnapshot = useCallback(
    (state: DistrictLensState): ArtifactRecord | null => {
      if (!state.currentRaceKey) return null;
      const existing = artifactStore.findByRaceKey(state.currentRaceKey, "brief");
      const record = snapshotBrief(state, existing, {
        artifactId: crypto.randomUUID(),
        versionId: crypto.randomUUID(),
      });
      if (record !== existing) artifactStore.upsert(record);
      refresh();
      return record;
    },
    [artifactStore, refresh],
  );

  return (
    <ArtifactContext.Provider
      value={{
        library,
        active,
        activeVersionIndex,
        storageAvailable: artifactStore.available,
        openArtifact,
        closeArtifact,
        selectVersion,
        renameArtifact,
        deleteArtifact,
        recordSnapshot,
      }}
    >
      {children}
    </ArtifactContext.Provider>
  );
}

export function useArtifacts(): ArtifactContextValue {
  const ctx = useContext(ArtifactContext);
  if (!ctx) throw new Error("useArtifacts must be used inside ArtifactProvider");
  return ctx;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/workspace/__tests__/ArtifactProvider.test.tsx`
Expected: 6 passed.

- [ ] **Step 5: Full suite, commit**

```bash
git add web/src/components/workspace
git commit -m "feat(web): ArtifactProvider with library state and snapshot recording"
git push origin main
```

### Task 13: LibraryItem + library sections

**Files:**
- Create: `web/src/components/workspace/LibraryItem.tsx`
- Create: `web/src/components/workspace/LibrarySections.tsx`
- Test: `web/src/components/workspace/__tests__/LibraryItem.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/components/workspace/__tests__/LibraryItem.test.tsx
import { test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LibraryItem } from "../LibraryItem";
import type { ArtifactRecord } from "@/lib/artifacts/types";

const artifact: ArtifactRecord = {
  artifactId: "art-1",
  type: "brief",
  name: "U.S. House · WI-04 · 2026",
  raceKey: "2026-H-WI-04",
  createdAt: "2026-06-09T12:00:00Z",
  updatedAt: "2026-06-09T12:00:00Z",
  versions: [],
};

test("shows name and saved date, fires onOpen", () => {
  const onOpen = vi.fn();
  render(<LibraryItem artifact={artifact} active={false} onOpen={onOpen} onDelete={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /U\.S\. House · WI-04 · 2026/ }));
  expect(onOpen).toHaveBeenCalledWith("art-1");
});

test("active item is visually marked", () => {
  render(<LibraryItem artifact={artifact} active onOpen={vi.fn()} onDelete={vi.fn()} />);
  expect(screen.getByRole("button", { name: /WI-04/ }).className).toContain("bg-zinc-800");
});

test("version count chip appears when there is more than one version", () => {
  const versioned = {
    ...artifact,
    versions: [
      { versionId: "v1", savedAt: "2026-06-01T00:00:00Z", snapshot: {} as never, fingerprint: {} as never, sourceRefs: [] },
      { versionId: "v2", savedAt: "2026-06-09T00:00:00Z", snapshot: {} as never, fingerprint: {} as never, sourceRefs: [] },
    ],
  };
  render(<LibraryItem artifact={versioned} active={false} onOpen={vi.fn()} onDelete={vi.fn()} />);
  expect(screen.getByText("v2")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/workspace/__tests__/LibraryItem.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write LibraryItem**

```tsx
// web/src/components/workspace/LibraryItem.tsx
"use client";

import type { ArtifactRecord, ArtifactType } from "@/lib/artifacts/types";

/** Evidence-adjacent type dots; amber is reserved for discovery (leads). */
const TYPE_DOT: Record<ArtifactType, string> = {
  brief: "bg-emerald-400",
  comparison: "bg-sky-400",
  overview: "bg-violet-400",
  lead: "bg-amber-400",
};

export function LibraryItem({
  artifact,
  active,
  onOpen,
  onDelete,
}: {
  artifact: ArtifactRecord;
  active: boolean;
  onOpen: (artifactId: string) => void;
  onDelete: (artifactId: string) => void;
}) {
  return (
    <div className="group flex items-center gap-1">
      <button
        type="button"
        onClick={() => onOpen(artifact.artifactId)}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
          active ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
        }`}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_DOT[artifact.type]}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{artifact.name}</span>
          <span className="block text-[10px] text-zinc-600">
            saved {new Date(artifact.updatedAt).toLocaleDateString()}
          </span>
        </span>
        {artifact.versions.length > 1 && (
          <span className="shrink-0 rounded bg-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-400">
            v{artifact.versions.length}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => onDelete(artifact.artifactId)}
        aria-label={`Delete ${artifact.name}`}
        className="shrink-0 rounded p-1 text-zinc-600 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        </svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Write LibrarySections** (consumes `useArtifacts`; no own test — it is exercised through the Task 12 provider tests' primitives and the dogfood gate)

```tsx
// web/src/components/workspace/LibrarySections.tsx
"use client";

import { useState } from "react";
import { useArtifacts } from "./ArtifactProvider";
import { LibraryItem } from "./LibraryItem";

const RECENTS_LIMIT = 5;

function Section({
  title,
  children,
  defaultExpanded = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className="px-3 py-2">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between text-xs font-semibold uppercase text-zinc-500"
      >
        {title}
        <span className="text-[10px]">{expanded ? "▼" : "►"}</span>
      </button>
      {expanded && <div className="mt-1 space-y-0.5">{children}</div>}
    </div>
  );
}

/** Recents + All artifacts, fed by the local-first library. */
export function LibrarySections() {
  const { library, active, openArtifact, deleteArtifact, storageAvailable } = useArtifacts();

  if (library.length === 0) {
    return (
      <p className="px-3 py-3 text-xs text-zinc-600">
        Briefs you build are saved here automatically.
        {!storageAvailable && " (This browser blocks storage — saves last only for this session.)"}
      </p>
    );
  }

  const recents = library.slice(0, RECENTS_LIMIT);

  return (
    <>
      {!storageAvailable && (
        <p className="px-3 pt-2 text-[10px] text-amber-500">
          Storage unavailable — artifacts last only for this session.
        </p>
      )}
      <Section title="Recents">
        {recents.map((a) => (
          <LibraryItem
            key={a.artifactId}
            artifact={a}
            active={active?.artifactId === a.artifactId}
            onOpen={openArtifact}
            onDelete={deleteArtifact}
          />
        ))}
      </Section>
      {library.length > RECENTS_LIMIT && (
        <Section title="All artifacts" defaultExpanded={false}>
          {library.map((a) => (
            <LibraryItem
              key={a.artifactId}
              artifact={a}
              active={active?.artifactId === a.artifactId}
              onOpen={openArtifact}
              onDelete={deleteArtifact}
            />
          ))}
        </Section>
      )}
    </>
  );
}
```

- [ ] **Step 5: Run tests, commit**

Run: `cd web && npx vitest run` — all green.

```bash
git add web/src/components/workspace
git commit -m "feat(web): library item and sections fed by the local artifact store"
git push origin main
```

### Task 14: Wire artifacts into `/w` — auto-snapshot, open-from-library, `?a=` deep link

**Files:**
- Modify: `web/src/app/w/page.tsx`
- Create: `web/src/lib/workspace/useAutoSnapshot.ts`
- Test: `web/src/lib/workspace/__tests__/useAutoSnapshot.test.tsx`

- [ ] **Step 1: Write the failing auto-snapshot hook test**

```tsx
// web/src/lib/workspace/__tests__/useAutoSnapshot.test.tsx
import { test, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { useAutoSnapshot } from "@/lib/workspace/useAutoSnapshot";
import { DEFAULT_STATE, type DistrictLensState } from "@/types/agent-state";

function Harness({ state, onSnapshot }: { state: DistrictLensState; onSnapshot: (s: DistrictLensState) => unknown }) {
  useAutoSnapshot(state, onSnapshot);
  return null;
}

const drafting: DistrictLensState = { ...DEFAULT_STATE, stage: "positions", currentRaceKey: "2026-H-WI-04" };
const complete: DistrictLensState = { ...DEFAULT_STATE, stage: "complete", currentRaceKey: "2026-H-WI-04" };

test("fires exactly once on the drafting → complete transition", () => {
  const onSnapshot = vi.fn();
  const { rerender } = render(<Harness state={drafting} onSnapshot={onSnapshot} />);
  expect(onSnapshot).not.toHaveBeenCalled();
  rerender(<Harness state={complete} onSnapshot={onSnapshot} />);
  expect(onSnapshot).toHaveBeenCalledTimes(1);
  rerender(<Harness state={complete} onSnapshot={onSnapshot} />); // stays complete
  expect(onSnapshot).toHaveBeenCalledTimes(1);
});

test("never fires for a completed state with no race key (failed build)", () => {
  const onSnapshot = vi.fn();
  const { rerender } = render(
    <Harness state={{ ...DEFAULT_STATE, stage: "district" }} onSnapshot={onSnapshot} />,
  );
  rerender(<Harness state={{ ...DEFAULT_STATE, stage: "complete" }} onSnapshot={onSnapshot} />);
  expect(onSnapshot).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/workspace/__tests__/useAutoSnapshot.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the hook**

```ts
// web/src/lib/workspace/useAutoSnapshot.ts
"use client";

import { useEffect, useRef } from "react";
import { shouldSnapshot } from "@/lib/artifacts/lifecycle";
import type { DistrictLensState } from "@/types/agent-state";

/**
 * Auto-snapshot: the "Save" button becomes automatic behavior. Fires the
 * callback exactly once per drafting→complete transition (spec §Artifact state).
 */
export function useAutoSnapshot(
  state: DistrictLensState,
  onSnapshot: (state: DistrictLensState) => unknown,
) {
  const prevStageRef = useRef<string>(state.stage);
  // Re-arm per raceKey so a fresh build of the same race can snapshot a new version.
  const firedForRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevStageRef.current;
    prevStageRef.current = state.stage;
    if (!shouldSnapshot(prev, state.stage, state.currentRaceKey)) return;
    const key = `${state.currentRaceKey}:${state.briefStartedAt ?? ""}`;
    if (firedForRef.current === key) return;
    firedForRef.current = key;
    onSnapshot(state);
  }, [state, onSnapshot]);
}
```

- [ ] **Step 4: Run hook tests to verify they pass**

Run: `cd web && npx vitest run src/lib/workspace/__tests__/useAutoSnapshot.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Wire into `/w/page.tsx`**

Edits to `WorkspaceInner` (and its surroundings) in `web/src/app/w/page.tsx`:

1. Wrap the page in the provider — in `WorkspacePage`:

```tsx
return (
  <WorkspaceLayoutProvider initialPersona={initialPersona}>
    <ArtifactProvider>
      <WorkspaceInner />
    </ArtifactProvider>
  </WorkspaceLayoutProvider>
);
```

2. Inside `WorkspaceInner`, add:

```tsx
const {
  library,
  active,
  activeVersionIndex,
  openArtifact,
  closeArtifact,
  selectVersion,
  recordSnapshot,
} = useArtifacts();

// Auto-snapshot completed drafts into the library, then mark "Saved ✓".
// (Task 16 REPLACES this callback with a version that adds the signed-in
// Mongo mirror write — do not end up with two useAutoSnapshot calls.)
const [justSaved, setJustSaved] = useState(false);
useAutoSnapshot(agentState, (state) => {
  const record = recordSnapshot(state);
  if (record) {
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 4000);
  }
});

// Deep link: /w?a=<artifactId>. Unknown id → "not in your library" (spec §Error handling).
const requestedArtifactId = params.get("a");
useEffect(() => {
  if (requestedArtifactId) openArtifact(requestedArtifactId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [requestedArtifactId]);
const deadLink = Boolean(
  requestedArtifactId && !library.some((r) => r.artifactId === requestedArtifactId),
);
```

3. Display priority — a reopened artifact wins over the live brief (mirrors the old `openedBrief` rule):

```tsx
const reopenedState = active ? active.versions[activeVersionIndex]?.snapshot ?? null : null;
const panelState = reopenedState ?? briefState ?? (isDrafting ? agentState : null);
const title = active ? active.name : panelState?.currentRaceKey ? deriveLabel(panelState.currentRaceKey) : null;
```

4. Add the dead-link empty state, ahead of the persona empty states:

```tsx
const deadLinkState = deadLink ? (
  <div className="flex h-full flex-col items-center justify-center gap-3 bg-zinc-900 p-8 text-center">
    <p className="text-sm text-zinc-300">That artifact isn’t in this browser’s library.</p>
    <p className="text-xs text-zinc-500">
      Artifacts live on the device where they were built. Rebuild the brief to recreate it here.
    </p>
    <button
      type="button"
      onClick={() => router.replace("/w")} // clears ?a= — add: const router = useRouter() from next/navigation
      className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
    >
      Start fresh
    </button>
  </div>
) : null;
// …pass `emptyState={deadLinkState ?? emptyState}` to ArtifactPanel
```

5. Header actions — saved chip + version history flip (linear history, History ▾):

```tsx
headerActions={
  <>
    {justSaved && <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-400">Saved ✓</span>}
    {active && active.versions.length > 1 && (
      <select
        aria-label="Version history"
        value={activeVersionIndex}
        onChange={(e) => selectVersion(Number(e.target.value))}
        className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-300"
      >
        {active.versions.map((v, i) => (
          <option key={v.versionId} value={i}>
            {new Date(v.savedAt).toLocaleDateString()} {i === active.versions.length - 1 ? "(latest)" : ""}
          </option>
        ))}
      </select>
    )}
    {active && (
      <button
        type="button"
        onClick={closeArtifact}
        aria-label="Close artifact"
        className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
      >
        ✕
      </button>
    )}
  </>
}
```

(`selectVersion` is already in the edit-2 destructure.)

6. Put the sections into the sidebar:

```tsx
library={
  <LibrarySidebar onPersonaChange={handlePersonaChange}>
    <LibrarySections />
  </LibrarySidebar>
}
```

- [ ] **Step 6: Type-check, full suite, build, commit**

Run: `cd web && npx tsc --noEmit && npx vitest run && npm run build`
Expected: all green.

```bash
git add web/src
git commit -m "feat(web): auto-snapshot to library, reopen with version history, ?a= deep link"
git push origin main
```

### Task 15: Threads hook extraction

**Files:**
- Create: `web/src/lib/workspace/useThreads.ts`

This is a **verbatim logic move** of the thread machinery from `web/src/app/page.tsx` lines 84–93 (`lastSavedTranscriptRef`, `autoSavedRef`, `openThreadIdRef`), 233–393 (loadThreads / openThread / auto-capture / createThread / renameThread / saveThreadNotes / deleteThread / transcript capture), and 395–448 (saveBrief / openSavedBrief / thread-switch reset). The old page keeps working off its own copy until Task 19 deletes it. The logic is already deployed and battle-tested — do not refactor its behavior while moving it; keep the comments.

- [ ] **Step 1: Create the hook with this exact shape**

```ts
// web/src/lib/workspace/useThreads.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCopilotChat, useCopilotMessagesContext } from "@copilotkit/react-core";
import type { AgentThreadDoc, ThreadSummary } from "@/lib/threads/schema";
import type { SavedBriefDoc } from "@/lib/saved-briefs/schema";
import type { DistrictLensState } from "@/types/agent-state";

export interface UseThreadsArgs {
  agentState: DistrictLensState;
  /** Restores a saved brief into the artifact panel (replaces setOpenedBrief). */
  onRestoreBrief: (state: DistrictLensState) => void;
  /** Clears all displayed-brief state on thread switch. */
  onClearBrief: () => void;
  /** Refresh My Ballot after an auto-capture lands. */
  onBallotChanged?: () => void;
}

export function useThreads({
  agentState,
  onRestoreBrief,
  onClearBrief,
  onBallotChanged,
}: UseThreadsArgs) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThread, setActiveThread] = useState<{
    thread: AgentThreadDoc;
    briefs: SavedBriefDoc[];
  } | null>(null);
  const { visibleMessages } = useCopilotChat();
  const { setMessages } = useCopilotMessagesContext();
  const lastSavedTranscriptRef = useRef<string>("");
  // Tracks the raceKey:threadId pair already auto-saved this run so we don't
  // double-capture the same brief if stage stays "complete" across renders.
  const autoSavedRef = useRef<string | null>(null);
  // Tracks the last requested threadId so stale async fetches don't clobber.
  const openThreadIdRef = useRef<string | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/threads");
      if (!res.ok) { setThreads([]); return; }
      const data = await res.json();
      setThreads(data.threads ?? []);
    } catch {
      setThreads([]);
    }
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  const openThread = useCallback(async (threadId: string) => {
    openThreadIdRef.current = threadId;
    try {
      const res = await fetch(`/api/threads/${threadId}`);
      if (!res.ok) return;
      // Stale-write guard: bail if user switched to a different thread while
      // this fetch was in flight.
      if (openThreadIdRef.current !== threadId) return;
      const data = await res.json();
      setActiveThread({ thread: data.thread, briefs: data.briefs ?? [] });
      // Restore chat synchronously from the already-loaded thread doc — no
      // second round-trip needed. We do NOT call setThreadId(): switching
      // CopilotKit's thread flips it into explicit-threadId mode, which makes
      // it reconnect the agent and reset coagent state (mode → voter) on every
      // thread open. ADK is stateless and we own message history here, so the
      // runtime threadId is not load-bearing.
      setMessages(data.thread?.messages ?? []);
    } catch {
      /* ignore */
    }
  }, [setMessages]);

  // Auto-capture: when a brief completes and a thread is open, silently file
  // it as an artifact. Dedup via autoSavedRef prevents re-saving the same
  // raceKey+threadId pair if stage stays "complete" across renders.
  useEffect(() => {
    if (agentState.stage !== "complete") return;
    if (!agentState.currentRaceKey || !activeThread) return;
    const threadId = activeThread.thread.thread_id;
    const dedupKey = `${agentState.currentRaceKey}:${threadId}`;
    if (autoSavedRef.current === dedupKey) return;
    autoSavedRef.current = dedupKey;
    const state = agentState;
    fetch("/api/saved/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, threadId }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        onBallotChanged?.();
        loadThreads();
        // Refresh the active thread's briefs list without disturbing the live chat.
        // Calling openThread here would also reset messages, clobbering the conversation.
        try {
          const refresh = await fetch(`/api/threads/${threadId}`);
          if (refresh.ok) {
            const { briefs } = await refresh.json();
            setActiveThread((prev) =>
              prev && prev.thread.thread_id === threadId
                ? { ...prev, briefs: briefs ?? [] }
                : prev,
            );
          }
        } catch { /* ignore */ }
      })
      .catch(() => {});
    // agentState used in body but only stage/raceKey are reactive triggers;
    // dedup key prevents stale captures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentState.stage, agentState.currentRaceKey, activeThread?.thread.thread_id, onBallotChanged, loadThreads]);

  const createThread = useCallback(async () => {
    try {
      const seed = agentState.currentRaceKey ? { raceKey: agentState.currentRaceKey } : {};
      const res = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(seed),
      });
      if (!res.ok) return;
      const data = await res.json();
      await loadThreads();
      // Open via the GET path so the active thread has the same clean shape as
      // every other opened thread (projected, defaults applied).
      if (data.thread?.thread_id) await openThread(data.thread.thread_id);
    } catch {
      /* ignore */
    }
  }, [agentState.currentRaceKey, loadThreads, openThread]);

  const renameThread = useCallback(async (threadId: string, title: string) => {
    await fetch(`/api/threads/${threadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    await loadThreads();
    setActiveThread((prev) =>
      prev && prev.thread.thread_id === threadId
        ? { ...prev, thread: { ...prev.thread, title } }
        : prev,
    );
  }, [loadThreads]);

  const saveThreadNotes = useCallback(async (threadId: string, notes: string) => {
    await fetch(`/api/threads/${threadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    setActiveThread((prev) =>
      prev && prev.thread.thread_id === threadId
        ? { ...prev, thread: { ...prev.thread, notes } }
        : prev,
    );
  }, []);

  const deleteThread = useCallback(async (threadId: string) => {
    await fetch(`/api/threads/${threadId}`, { method: "DELETE" });
    setActiveThread((prev) => (prev && prev.thread.thread_id === threadId ? null : prev));
    await loadThreads();
  }, [loadThreads]);

  // While a thread is open, capture the chat conversation onto it as a read-only
  // transcript (debounced). Stored so reopening the thread shows what was asked.
  const activeThreadId = activeThread?.thread.thread_id ?? null;
  useEffect(() => {
    if (!activeThreadId) return;
    const transcript = (visibleMessages ?? []).flatMap((m) => {
      const role = (m as { role?: unknown }).role;
      const content = (m as { content?: unknown }).content;
      return typeof content === "string" && (role === "user" || role === "assistant")
        ? [{ role, content }]
        : [];
    });
    if (transcript.length === 0) return;
    const sig = activeThreadId + JSON.stringify(transcript);
    if (sig === lastSavedTranscriptRef.current) return;
    const timer = setTimeout(() => {
      lastSavedTranscriptRef.current = sig;
      fetch(`/api/threads/${activeThreadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: transcript }),
      })
        .then(() =>
          setActiveThread((prev) =>
            prev && prev.thread.thread_id === activeThreadId
              ? { ...prev, thread: { ...prev.thread, messages: transcript } }
              : prev,
          ),
        )
        .catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [visibleMessages, activeThreadId]);

  // Reopen a saved snapshot into the artifact panel.
  const openSavedBrief = useCallback(async (briefId: string) => {
    try {
      const res = await fetch(`/api/saved/brief/${briefId}`);
      if (!res.ok) return;
      const { brief } = await res.json();
      onRestoreBrief(brief.answer_snapshot as DistrictLensState);
    } catch {
      /* ignore — reopening is best-effort */
    }
  }, [onRestoreBrief]);

  // On thread switch: wipe ALL state that feeds the artifact panel and chat,
  // then restore the new thread's brief if it has one.
  useEffect(() => {
    setMessages([]);
    onClearBrief();
    autoSavedRef.current = null; // reset dedup so new thread can auto-capture
    if (activeThread && activeThread.briefs.length > 0) {
      openSavedBrief(activeThread.briefs[0].brief_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.thread.thread_id]);

  return {
    threads,
    activeThread,
    loadThreads,
    openThread,
    closeThread: () => setActiveThread(null),
    createThread,
    renameThread,
    saveThreadNotes,
    deleteThread,
    openSavedBrief,
  };
}
```

(These bodies are verbatim moves from `page.tsx` with only the noted callback substitutions — `loadBallot()` → `onBallotChanged?.()`, `setOpenedBrief(...)` → `onRestoreBrief(...)`, and the thread-switch reset delegating to `onClearBrief()`. Do not refactor behavior while moving; the stale-write guard, dedup refs, debounce timing, and eslint-disable comments are deliberate. Diff against `page.tsx` after copying.)

- [ ] **Step 2: Type-check (behavior is exercised in Task 16's wiring + dogfood)**

Run: `cd web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/workspace/useThreads.ts
git commit -m "refactor(web): extract journalist thread logic into useThreads hook"
git push origin main
```

### Task 16: Threads + My Ballot in the workspace sidebar

**Files:**
- Modify: `web/src/app/w/page.tsx`

- [ ] **Step 1: Wire `useThreads` and My Ballot into `WorkspaceInner`**

```tsx
// additions inside WorkspaceInner (w/page.tsx)
import { ThreadsPanel } from "@/components/canvas/ThreadsPanel";
import { Show, useUser } from "@clerk/nextjs";
import { useThreads } from "@/lib/workspace/useThreads";
import type { SavedBallotItem } from "@/lib/saved-briefs/schema";

const { isSignedIn } = useUser();
// add `clearBrief` to the useWorkspaceAgent() destructure (Task 8 exports it)

// Reopened-saved-brief display slot (mirrors old `openedBrief`):
const [reopenedSaved, setReopenedSaved] = useState<DistrictLensState | null>(null);

// My Ballot (signed-in voters) — same fetch as the old page:
const [savedItems, setSavedItems] = useState<SavedBallotItem[]>([]);
const loadBallot = useCallback(async () => {
  try {
    const res = await fetch("/api/saved");
    if (!res.ok) { setSavedItems([]); return; }
    const data = await res.json();
    setSavedItems(data.items ?? []);
  } catch {
    setSavedItems([]);
  }
}, []);
useEffect(() => { loadBallot(); }, [loadBallot]);

const threadsApi = useThreads({
  agentState,
  onRestoreBrief: (state) => setReopenedSaved(state),
  onClearBrief: () => {
    setReopenedSaved(null);
    clearBrief(); // resets snapshot + coagent state, keeps persona
  },
  onBallotChanged: loadBallot,
});

// REPLACE the Task-14 useAutoSnapshot call with this extended version (one
// call only): signed-in users also mirror the snapshot to Mongo so My Ballot
// stays the cross-device source of truth (spec §Data flow: "library write —
// localStorage anon, Mongo signed in"). Skip when a journalist thread is
// open: useThreads' auto-capture already posts that brief with its threadId.
useAutoSnapshot(agentState, (state) => {
  const record = recordSnapshot(state);
  if (record) {
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 4000);
  }
  if (isSignedIn && !(isJournalist && threadsApi.activeThread)) {
    fetch("/api/saved/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    })
      .then((res) => { if (res.ok) loadBallot(); })
      .catch(() => {});
  }
});
```

Display priority becomes: `reopenedSaved` (Mongo saved brief) > `active` local artifact > live brief:

```tsx
const panelState = reopenedSaved ?? reopenedState ?? briefState ?? (isDrafting ? agentState : null);
```

Sidebar composition:

```tsx
library={
  <LibrarySidebar onPersonaChange={handlePersonaChange}>
    {isJournalist && (
      <Show when="signed-in">
        <ThreadsPanel
          threads={threadsApi.threads}
          active={threadsApi.activeThread}
          onNew={threadsApi.createThread}
          onOpen={threadsApi.openThread}
          onClose={threadsApi.closeThread}
          onRename={threadsApi.renameThread}
          onSaveNotes={threadsApi.saveThreadNotes}
          onDelete={threadsApi.deleteThread}
          onReopenBrief={threadsApi.openSavedBrief}
        />
      </Show>
    )}
    {!isJournalist && savedItems.length > 0 && (
      <Show when="signed-in">
        <div className="px-3 py-2">
          <p className="text-xs font-semibold uppercase text-zinc-500">My Ballot</p>
          <ul className="mt-1 space-y-0.5">
            {savedItems.map((item) => (
              <li key={item.raceKey}>
                <button
                  type="button"
                  onClick={() => item.briefId && threadsApi.openSavedBrief(item.briefId)}
                  disabled={!item.briefId}
                  className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
                >
                  <span className="block truncate text-xs font-semibold">{item.label}</span>
                  <span className="block text-[10px] text-zinc-600">
                    saved {new Date(item.savedAt).toLocaleDateString()}
                  </span>
                  {item.changes.length > 0 &&
                    item.changes.map((c) => (
                      <span key={c} className="block text-[10px] font-medium text-amber-500">● {c}</span>
                    ))}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Show>
    )}
    <LibrarySections />
  </LibrarySidebar>
}
```

Note: `ThreadsPanel` is one of the still-light organs — it will look light-on-dark inside the sidebar until its Phase-3 token sweep (Task 22). Acceptable transitional state.

- [ ] **Step 2: Type-check, suite, build, commit**

Run: `cd web && npx tsc --noEmit && npx vitest run && npm run build` — all green.

```bash
git add web/src/app/w
git commit -m "feat(web): threads and My Ballot in the workspace library sidebar"
git push origin main
```

### Task 17: Sign-in sync push

**Files:**
- Create: `web/src/lib/artifacts/sync.ts`
- Test: `web/src/lib/artifacts/__tests__/sync.test.ts`
- Modify: `web/src/app/w/page.tsx` (trigger)

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/lib/artifacts/__tests__/sync.test.ts
import { test, expect, vi } from "vitest";
import { pushLocalArtifacts } from "@/lib/artifacts/sync";
import { createLocalArtifactStore } from "@/lib/artifacts/local-store";
import { DEFAULT_STATE } from "@/types/agent-state";
import type { ArtifactRecord } from "@/lib/artifacts/types";

const briefRecord = (over: Partial<ArtifactRecord> = {}): ArtifactRecord => ({
  artifactId: "art-1",
  type: "brief",
  name: "U.S. House · WI-04 · 2026",
  raceKey: "2026-H-WI-04",
  createdAt: "2026-06-09T12:00:00Z",
  updatedAt: "2026-06-09T12:00:00Z",
  versions: [
    {
      versionId: "v1",
      savedAt: "2026-06-09T12:00:00Z",
      snapshot: { ...DEFAULT_STATE, stage: "complete", currentRaceKey: "2026-H-WI-04" },
      fingerprint: {} as never,
      sourceRefs: [],
    },
  ],
  ...over,
});

test("pushes each unsynced brief's latest snapshot to /api/saved/brief", async () => {
  const store = createLocalArtifactStore(null);
  store.upsert(briefRecord());
  const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
  const result = await pushLocalArtifacts(store, fetchFn as unknown as typeof fetch);
  expect(result).toEqual({ pushed: 1, failed: 0 });
  expect(fetchFn).toHaveBeenCalledWith(
    "/api/saved/brief",
    expect.objectContaining({ method: "POST" }),
  );
  expect(store.get("art-1")?.syncedAt).toBeTruthy();
});

test("already-synced and non-brief artifacts are skipped", async () => {
  const store = createLocalArtifactStore(null);
  store.upsert(briefRecord({ artifactId: "done", syncedAt: "2026-06-08T00:00:00Z" }));
  store.upsert(briefRecord({ artifactId: "lead-1", type: "lead" }));
  const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
  const result = await pushLocalArtifacts(store, fetchFn as unknown as typeof fetch);
  expect(result).toEqual({ pushed: 0, failed: 0 });
  expect(fetchFn).not.toHaveBeenCalled();
});

test("a failed POST counts as failed and stays unsynced for retry", async () => {
  const store = createLocalArtifactStore(null);
  store.upsert(briefRecord());
  const fetchFn = vi.fn(async () => new Response(null, { status: 500 }));
  const result = await pushLocalArtifacts(store, fetchFn as unknown as typeof fetch);
  expect(result).toEqual({ pushed: 0, failed: 1 });
  expect(store.get("art-1")?.syncedAt).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/artifacts/__tests__/sync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/lib/artifacts/sync.ts
import type { ArtifactStore } from "./local-store";

export interface SyncResult {
  pushed: number;
  failed: number;
}

/**
 * One-shot sign-in push: local brief artifacts → Mongo via the existing
 * /api/saved/brief endpoint (server dedupes by race key). Mongo becomes the
 * source of truth; localStorage stays the offline cache (spec §Data flow).
 * Comparison/overview/lead sync arrives with those types in later phases.
 */
export async function pushLocalArtifacts(
  store: ArtifactStore,
  fetchFn: typeof fetch = fetch,
): Promise<SyncResult> {
  const pending = store
    .list()
    .filter((record) => record.type === "brief" && !record.syncedAt && record.versions.length > 0);

  let pushed = 0;
  let failed = 0;
  for (const record of pending) {
    const latest = record.versions[record.versions.length - 1];
    try {
      const res = await fetchFn("/api/saved/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: latest.snapshot }),
      });
      if (res.ok) {
        store.upsert({ ...record, syncedAt: new Date().toISOString() });
        pushed += 1;
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }
  return { pushed, failed };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/artifacts/__tests__/sync.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Trigger on sign-in in `/w/page.tsx`**

ArtifactProvider exposes its store for this (add `store: ArtifactStore` to the context value in `ArtifactProvider.tsx`, returning `artifactStore`). Then in `WorkspaceInner`:

```tsx
import { useUser } from "@clerk/nextjs";
import { pushLocalArtifacts } from "@/lib/artifacts/sync";

const { isSignedIn } = useUser();
const syncedRef = useRef(false);
useEffect(() => {
  if (!isSignedIn || syncedRef.current) return;
  syncedRef.current = true;
  pushLocalArtifacts(store).then(() => loadBallot()).catch(() => {});
}, [isSignedIn, store, loadBallot]);
```

- [ ] **Step 6: Type-check, suite, build, commit**

```bash
git add web/src
git commit -m "feat(web): one-shot sign-in push of local artifacts to Mongo"
git push origin main
```

### Task 18: Landing page swap + monolith deletion

**Files:**
- Modify: `web/src/app/page.tsx` (full replacement → landing)
- Delete (within the same file): the 785-line monolith body

The workspace now carries everything the monolith did (brief flow, threads, ballot, save). `/` becomes the spec's landing: address input (Maya) + state map entry (Devon); submitting drops into `/w` with the agent already working (via the `?addr=`/`?state=` kick-off from Task 8).

- [ ] **Step 1: Replace `web/src/app/page.tsx` entirely**

```tsx
// web/src/app/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { USMap } from "@/components/map/USMap";

export default function LandingPage() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (address.length < 5) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/district/suggest?q=${encodeURIComponent(address)}`);
        const data = await res.json();
        setSuggestions(data.suggestions ?? []);
        setShowSuggestions(true);
      } catch {
        setSuggestions([]);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [address]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function goToWorkspace(addr: string) {
    if (!addr.trim()) return;
    router.push(`/w?addr=${encodeURIComponent(addr)}`);
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <span className="text-lg font-bold tracking-tight">DistrictLens</span>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs font-medium uppercase tracking-widest text-zinc-500 lg:block">
            Nonpartisan · Evidence-first
          </span>
          <Show
            when="signed-in"
            fallback={
              <SignInButton mode="modal">
                <button className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white">
                  Sign in
                </button>
              </SignInButton>
            }
          >
            <UserButton />
          </Show>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-10 px-6 py-16">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">What’s on your ballot?</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Evidence-first briefs on 2026 congressional races — cited, dated, nonpartisan.
          </p>
        </div>

        <div ref={wrapperRef} className="relative w-full max-w-xl">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              goToWorkspace(address);
            }}
          >
            <input
              type="text"
              placeholder="Street address or ZIP code"
              aria-label="Street address or ZIP code"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg bg-zinc-100 px-5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-white"
            >
              Build my brief
            </button>
          </form>
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
              {suggestions.map((s) => (
                <li
                  key={s}
                  onMouseDown={() => goToWorkspace(s)}
                  className="cursor-pointer px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="w-full">
          <p className="mb-2 text-center text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Or explore a state’s races
          </p>
          {/* USMap is still light-styled until its Phase-3 sweep — render it on a paper plate. */}
          <div className="rounded-xl bg-white p-4">
            <USMap
              focusedState={null}
              onStateClick={(stateCode) => router.push(`/w?state=${stateCode}`)}
              mode="journalist"
            />
          </div>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Type-check, full suite, build**

Run: `cd web && npx tsc --noEmit && npx vitest run && npm run build`
Expected: all green; no remaining imports of the deleted monolith internals (the old page's `SYSTEM_PROMPT` copy dies with it — `/w` uses `chat-config.ts`).

- [ ] **Step 3: Commit**

```bash
git add web/src/app/page.tsx
git commit -m "feat(web): landing page replaces the legacy three-column monolith"
git push origin main
```

### Task 19: Phase-2 dogfood gate (Maya + Devon loops) + /simplify

- [ ] **Step 1: Run `/simplify`** on the accumulated workspace code (skill: `simplify`). Apply its accepted cleanups, keep the suite green, commit as `refactor(web): simplify pass on workspace + artifact layer`.

- [ ] **Step 2: Dogfood — Maya loop** (browse skill, screenshots):
  1. `/` → address → lands in `/w` with the draft building.
  2. Brief completes → "Saved ✓" chip; artifact appears under Recents.
  3. Reload `/w` → artifact still in library; open it → renders instantly from snapshot.
  4. Build the same race again (same address) → no duplicate library entry (dedupe), or a v2 if evidence actually changed.
  5. DevTools → Application → block storage (or use Firefox private mode) → app degrades to the session-only notice, no crash.

- [ ] **Step 3: Dogfood — Devon loop** (signed in — use a real browser, Clerk can't be headless):
  1. Journalist persona → create a thread → build two races into it.
  2. Both auto-capture into the thread; artifacts land in the library in real time.
  3. Reopen the thread → chat transcript restores, briefs listed.
  4. Sign-in sync: build a brief signed-out, then sign in → it appears in My Ballot (pushed to Mongo).
  5. Open a saved brief → version history ▾ if multiple versions exist.

- [ ] **Step 4: Fix findings, commit, deploy checkpoint**

```bash
git commit -am "fix(web): phase-2 dogfood fixes"  # if needed
git push origin main
gcloud run deploy districtlens-web --source web --region us-central1 --project civicsync-440613
```

---

# Phase 3 — Dark token pass

Outcome: shared dark tokens in `globals.css`; `BriefArtifact` organs (the canvas components) restyled onto them; evidence-color semantics preserved with dark-tuned values; CopilotChat themed dark. After this phase the app is visually coherent — the contingency cut line.

### Task 20: Token definitions

**Files:**
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Add the token block** (Tailwind v4: `@theme` makes `bg-surface`, `text-ink`, `border-edge` etc. real utilities — verify against the Tailwind v4 docs via Context7 if unsure)

Append to `web/src/app/globals.css` after the existing `:root` block:

```css
/* -----------------------------------------------------------------------
   Workspace dark tokens — artifact-workspace redesign (spec §Dark restyle).
   Semantic names, zinc values. Evidence-color SEMANTICS are unchanged:
   green = direct quote, blue = questionnaire, indigo = voting record,
   amber = reported/discovery — values tuned for dark-background contrast.
------------------------------------------------------------------------ */
@theme {
  /* surfaces */
  --color-surface: #09090b;          /* zinc-950 — app shell */
  --color-surface-raised: #18181b;   /* zinc-900 — panels, cards */
  --color-surface-hover: #27272a;    /* zinc-800 — hover, active */

  /* edges */
  --color-edge: #27272a;             /* zinc-800 — default borders */
  --color-edge-strong: #3f3f46;      /* zinc-700 — emphasized borders */

  /* ink */
  --color-ink: #fafafa;              /* zinc-50 — primary text */
  --color-ink-muted: #a1a1aa;        /* zinc-400 — secondary text */
  --color-ink-faint: #71717a;        /* zinc-500 — tertiary/labels */

  /* evidence colors, dark-tuned (≥4.5:1 on surface-raised) */
  --color-evidence-direct: #4ade80;        /* green-400 */
  --color-evidence-questionnaire: #60a5fa; /* blue-400 */
  --color-evidence-voting: #a5b4fc;        /* indigo-300 */
  --color-evidence-reported: #fbbf24;      /* amber-400 */

  /* party dots, dark-contrast checked */
  --color-party-dem: #60a5fa;        /* blue-400 */
  --color-party-rep: #f87171;        /* red-400 */
  --color-party-ind: #c084fc;        /* purple-400 */
}
```

Do **not** change `body { background: var(--civic-slate-50); … }` globally — the landing page and workspace already set their own dark backgrounds; remaining light surfaces disappear as the sweep proceeds. (If after Task 23 nothing light remains, a follow-up commit may flip the body default.)

- [ ] **Step 2: Verify utilities exist**

Add a temporary `bg-surface` class to any workspace component, run `cd web && npm run build`, confirm no unknown-utility warning, remove the temp class. (Vitest/jsdom won't validate CSS — the build is the check.)

- [ ] **Step 3: Commit**

```bash
git add web/src/app/globals.css
git commit -m "feat(web): dark workspace tokens in @theme"
git push origin main
```

### Task 21: Class-mapping sweep — group A (header organs)

**Files (modify):** `web/src/components/canvas/DecisionHeader.tsx`, `CandidateField.tsx`, `CandidateCard.tsx`, `NomineeStatusBanner.tsx`, `CanVoteStrip.tsx`, `RaceCanvas.tsx`

Apply this **mapping table** mechanically to every className in the group (this is the token-based restyle — same mapping every task; deviations only where contrast demands):

| Old (light)                              | New (token)                  |
|------------------------------------------|------------------------------|
| `bg-white`, `bg-slate-50`                | `bg-surface-raised`          |
| `bg-slate-100`                           | `bg-surface-hover`           |
| `bg-slate-900` (filled buttons/chips)    | `bg-zinc-100` + `text-zinc-900` (inverted) |
| `text-slate-900`, `text-slate-800`       | `text-ink`                   |
| `text-slate-600`, `text-slate-500`       | `text-ink-muted`             |
| `text-slate-400`                         | `text-ink-faint`             |
| `border-slate-900` (brutal borders)      | `border-edge-strong`         |
| `border-slate-200`, `border-slate-300`   | `border-edge`                |
| `hover:bg-slate-100`                     | `hover:bg-surface-hover`     |
| `text-green-700/800` (direct quote)      | `text-evidence-direct`       |
| `text-blue-700/800` (questionnaire)      | `text-evidence-questionnaire`|
| `text-indigo-*` (voting record)          | `text-evidence-voting`       |
| `text-amber-700` (reported/discovery)    | `text-evidence-reported`     |
| green/blue/indigo/amber `bg-*-50` chips  | same hue `bg-*-900/30` (e.g. `bg-green-50` → `bg-green-900/30`) |

Procedure per file:
- [ ] **Step 1:** Read the file; apply the mapping to every className.
- [ ] **Step 2:** Run the component's existing test file — behavior assertions must stay green (they assert text/roles, not colors). If a test asserts a specific light class, update the assertion to the token class in the same commit and note it in the commit body.
- [ ] **Step 3:** Grep gate for the whole group:

```bash
grep -nE "bg-white|bg-slate-50|text-slate-[89]00|border-slate-900" \
  web/src/components/canvas/DecisionHeader.tsx \
  web/src/components/canvas/CandidateField.tsx \
  web/src/components/canvas/CandidateCard.tsx \
  web/src/components/canvas/NomineeStatusBanner.tsx \
  web/src/components/canvas/CanVoteStrip.tsx \
  web/src/components/canvas/RaceCanvas.tsx
```

Expected: no output.

- [ ] **Step 4:** Remove the `bg-white` plate wrappers added in Phase 1 — in `ArtifactPanel.tsx` change `<div className="min-h-full bg-white">` to `<div className="min-h-full">` and the receipt-strip plate `bg-white` to `bg-surface-raised`; the paper-on-dark waypoint ends here for the brief body.

- [ ] **Step 5:** Full suite + commit:

```bash
cd web && npx vitest run
git add web/src
git commit -m "feat(web): dark token sweep - decision header, candidates, race canvas"
git push origin main
```

### Task 22: Sweep — group B (evidence + records + threads)

**Files (modify):** `IssueAccordion.tsx`, `EvidenceCard.tsx`, `PositionsEmptyState.tsx`, `VotingRecordCard.tsx`, `BillFeed.tsx`, `FinanceChart.tsx`, `FinanceToolCard.tsx`, `CollapsibleSection.tsx`, `ThreadsPanel.tsx` — all in `web/src/components/canvas/`.

- [ ] **Step 1:** Apply the Task 21 mapping table to each file.
- [ ] **Step 2:** Evidence-strength labels in `EvidenceCard.tsx` are the heart of the trust UI — after mapping, verify each evidence type still has a *distinct* color and the label text uses the dark-tuned token (`text-evidence-*`). Honest-empty states (`PositionsEmptyState`, "no direct statement") must read clearly: `text-ink-muted` on `bg-surface-raised`.
- [ ] **Step 3:** Run the group's tests:

```bash
cd web && npx vitest run src/components/canvas/__tests__/IssueAccordion.test.tsx \
  src/components/canvas/__tests__/EvidenceCard.test.tsx \
  src/components/canvas/__tests__/PositionsEmptyState.test.tsx \
  src/components/canvas/__tests__/VotingRecordCard.test.tsx \
  src/components/canvas/__tests__/BillFeed.test.tsx \
  src/components/canvas/__tests__/FinanceToolCard.test.tsx \
  src/components/canvas/__tests__/CollapsibleSection.test.tsx
```

Expected: all pass (update class-assertions to tokens where present, same rule as Task 21).
- [ ] **Step 4:** Grep gate (same pattern as Task 21 over this file list) → no output. Full suite. Commit:

```bash
git add web/src/components/canvas
git commit -m "feat(web): dark token sweep - evidence, finance, records, threads"
git push origin main
```

### Task 23: Sweep — group C (news, tables, map, ballotpedia, receipt)

**Files (modify):** `NewsCard.tsx`, `NewsAccordion.tsx`, `RaceTable.tsx`, `ReceiptProgress.tsx`, `CanvasEmptyState.tsx`, `ballotpedia/BallotpediaCardShell.tsx`, `ballotpedia/*.tsx`, `web/src/components/map/USMap.tsx`.

- [ ] **Step 1:** Apply the mapping table. Special cases:
  - **Ballotpedia cards:** keep the amber discovery governance identity — dashed amber borders become `border-amber-500/40`, governance footer text `text-evidence-reported`, card body `bg-surface-raised`. The "DISCOVERY — verify before citing" chrome must remain visually loud on dark.
  - **USMap:** heatmap fills (slate-200/violet-200/400/700) stay as data colors but the container/labels go dark (`bg-surface-raised`, `text-ink-muted`); check the violet scale reads against dark — if violet-200 vanishes, shift the no-data/low band to `zinc-700`/`violet-500/40`.
  - **ReceiptProgress:** this is the judging centerpiece — done=green/running=amber/pending states must be unmistakable on `bg-surface-raised`.
- [ ] **Step 2:** Run ballotpedia + canvas test files touched; update class assertions to tokens where they exist (the ballotpedia shell tests DO assert governance chrome — keep those assertions, just re-point colors).
- [ ] **Step 3:** Project-wide grep gate:

```bash
grep -rnE "bg-white|bg-slate-50|text-slate-[89]00|border-slate-900" web/src/components/canvas web/src/components/map web/src/components/workspace
```

Expected: no output.
- [ ] **Step 4:** Full suite + build + commit:

```bash
cd web && npx vitest run && npm run build
git add web/src/components
git commit -m "feat(web): dark token sweep - news, tables, map, ballotpedia governance"
git push origin main
```

### Task 24: CopilotChat dark theme + final Phase-3 gate

**Files:**
- Modify: `web/src/app/globals.css`
- Modify: `web/src/components/workspace/ChatPane.tsx` (add the scoping class)

- [ ] **Step 1: Scope CopilotKit CSS variables** — append to `globals.css`:

```css
/* Dark theme for the CopilotKit chat, scoped to the workspace ChatPane. */
.dl-chat-dark {
  --copilot-kit-background-color: #09090b;
  --copilot-kit-secondary-color: #18181b;
  --copilot-kit-secondary-contrast-color: #fafafa;
  --copilot-kit-primary-color: #fafafa;
  --copilot-kit-contrast-color: #09090b;
  --copilot-kit-separator-color: #27272a;
  --copilot-kit-muted-color: #71717a;
}
```

(Variable names: verify against the installed `@copilotkit/react-ui` version's theming docs via Context7 — the set above is the documented v1 surface; adjust names if the installed version differs.)

In `ChatPane.tsx`, change the chat wrapper `<div className="min-h-0 flex-1">` to `<div className="min-h-0 flex-1 dl-chat-dark">` — and add the same class to the mobile bottom-sheet chat wrapper in `w/page.tsx`.

- [ ] **Step 2: /simplify** over the Phase-3 diff; apply accepted findings.
- [ ] **Step 3: Final dogfood gate (both loops, dark)** — browse skill, screenshot evidence:
  1. Maya loop on dark: landing → brief → every section legible; evidence labels distinct; party dots visible; honest-empty states readable.
  2. Devon loop on dark: map heatmap legible, race table scannable, threads panel coherent in the sidebar.
  3. Ballotpedia discovery card in chat → amber governance chrome pops on dark.
  4. Receipt strip during a build → stages clearly differentiated.
  5. Mobile width (375px) spot-check: nothing unreadable (full mobile UX is Phase 6).
- [ ] **Step 4: Commit, deploy, mark the cut line**

```bash
git add web/src
git commit -m "feat(web): dark CopilotChat theme - phase 3 complete (contingency cut line)"
git push origin main
gcloud run deploy districtlens-web --source web --region us-central1 --project civicsync-440613
```

---

## Self-review notes (spec ↔ plan)

- **Spec coverage, phases 1–3:** shell/divider/presets (T1–T8), receipt-strip visibility (T6, T24), persona presets as layout states (T1–T3), auto-snapshot on complete only (T10, T14), failed builds never save (T10 tests), linear immutable versions + History ▾ (T10, T14), local-first + quota degradation (T11, T13 notice), sign-in push with Mongo as source of truth (T17), dead `?a=` link (T14), corrupt layout reset (T1–T2), threads unchanged + visible auto-capture (T15–T16), landing route (T18), dark tokens with preserved evidence semantics (T20–T24), monolith removal (T18), 192 existing tests stay green (every task's full-suite step).
- **Deliberately deferred to the phases 4–6 plan:** ComparisonArtifact / OverviewArtifact / LeadArtifact renderers + governance footer tests + publish-endpoint lead rejection, "save as artifact" chat affordances, freshness banner on reopen ("2 new statements… Refresh brief"), share/publish + `/share/[shareId]`, mobile view swap, Cmd+K, per-persona empty states polish. The publish-rejects-leads guardrail test ships WITH the publish endpoint (phase 5) — there is no publish surface to guard before then.
- **Known judgment calls encoded above:** monolith deletion moved to end of Phase 2 (no regression window); `RaceCanvas` light-on-dark is the approved Phase-1 waypoint; ballotpedia governance chrome stays amber-loud on dark.
