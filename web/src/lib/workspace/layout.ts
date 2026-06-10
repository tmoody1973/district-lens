/**
 * Pure workspace layout engine — bounds and persistence codec for the one
 * unified workspace (U1). The persona presets died with the Voter/Journalist
 * tabs; the parser stays tolerant of persona-era stored blobs (R2).
 */

export interface WorkspaceLayoutState {
  libraryCollapsed: boolean;
  chatCollapsed: boolean;
  /** Chat pane width as a percentage of the chat+artifact area. */
  chatPct: number;
}

export const CHAT_PCT_MIN = 20;
export const CHAT_PCT_MAX = 60;
export const LAYOUT_STORAGE_KEY = "districtlens.workspace.layout.v1";

export const DEFAULT_LAYOUT: WorkspaceLayoutState = {
  libraryCollapsed: false,
  chatCollapsed: false,
  chatPct: 32,
};

export function defaultLayout(): WorkspaceLayoutState {
  return { ...DEFAULT_LAYOUT };
}

export function clampChatPct(pct: number): number {
  return Math.min(Math.max(pct, CHAT_PCT_MIN), CHAT_PCT_MAX);
}

/**
 * Corrupt or missing stored layout resets to the default (spec §Error
 * handling). Unknown fields — including the persona-era `persona` — are
 * ignored, not errors (R2).
 */
export function parseLayout(raw: string | null): WorkspaceLayoutState {
  if (!raw) return defaultLayout();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return defaultLayout();
    const candidate = parsed as Partial<WorkspaceLayoutState>;
    if (
      typeof candidate.libraryCollapsed !== "boolean" ||
      typeof candidate.chatCollapsed !== "boolean" ||
      typeof candidate.chatPct !== "number" ||
      Number.isNaN(candidate.chatPct)
    ) {
      return defaultLayout();
    }
    return {
      libraryCollapsed: candidate.libraryCollapsed,
      chatCollapsed: candidate.chatCollapsed,
      chatPct: clampChatPct(candidate.chatPct),
    };
  } catch {
    return defaultLayout();
  }
}

export function serializeLayout(layout: WorkspaceLayoutState): string {
  return JSON.stringify(layout);
}
