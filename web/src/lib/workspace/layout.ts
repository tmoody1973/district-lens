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
  voter: {
    persona: "voter",
    libraryCollapsed: true,
    chatCollapsed: false,
    chatPct: 28,
  },
  journalist: {
    persona: "journalist",
    libraryCollapsed: false,
    chatCollapsed: false,
    chatPct: 40,
  },
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
export function parseLayout(
  raw: string | null,
  fallback: Persona
): WorkspaceLayoutState {
  if (!raw) return presetFor(fallback);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null)
      return presetFor(fallback);
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
