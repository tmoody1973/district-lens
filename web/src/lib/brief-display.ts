import type { AppMode, DistrictLensState } from "@/types/agent-state";

// A brief paired with the mode that loaded it. This is the unit the UI renders
// and the exact shape a future "Save brief" button would persist.
export interface DisplayedBrief {
  mode: AppMode;
  state: DistrictLensState;
}

// Decide which brief the canvas should show.
//
// The live CopilotKit coagent state is the source of truth while a brief is
// loaded — but it can be cleared out from under us (a coagent-state hiccup, a
// mode toggle that doesn't preserve, etc.). `snapshot` is the last live brief
// we captured; we fall back to it so a completed brief is never lost.
//
// Live wins only when it actually holds a brief (a currentRaceKey) and we know
// which mode loaded it. Otherwise we show the snapshot, which may be null.
export function pickDisplayedBrief(
  agentState: DistrictLensState,
  snapshot: DisplayedBrief | null,
  lastBriefMode: AppMode | null,
): DisplayedBrief | null {
  if (agentState.currentRaceKey && lastBriefMode) {
    return { mode: lastBriefMode, state: agentState };
  }
  return snapshot;
}
