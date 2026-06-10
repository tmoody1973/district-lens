import type { DistrictLensState, ResearchStage } from "@/types/agent-state";

/**
 * Pure panel state machine for the artifact rail (U2):
 *
 *   LIST (rest) ⇄ FOCUSED, with DRAFT taking the panel while a build runs.
 *
 * The live coagent brief is deliberately NOT an input — at rest the panel can
 * only show the artifact LIST or an explicitly focused artifact, which makes
 * the stale-brief-squats-in-panel defect (D1, the "North Dakota zombie")
 * structurally impossible. Pinned by the R1 regression test.
 */

export type PanelView = "list" | "focused" | "draft";

export interface PanelViewInputs {
  hasFocusedSavedBrief: boolean;
  hasFocusedLocalArtifact: boolean;
  /** Live coagent stage; undefined until the coagent state hydrates. */
  stage: ResearchStage | null | undefined;
}

export interface PanelViewResult {
  view: PanelView;
  /** Slim build-progress pill in the panel header — agent visibility is never lost (D2/C4). */
  showBuildPill: boolean;
}

export function isDraftingStage(stage: ResearchStage | null | undefined): boolean {
  return stage != null && stage !== "idle" && stage !== "complete";
}

export function derivePanelView(inputs: PanelViewInputs): PanelViewResult {
  const drafting = isDraftingStage(inputs.stage);
  const focused = inputs.hasFocusedSavedBrief || inputs.hasFocusedLocalArtifact;
  return {
    // A manual focus wins over a running build (D2) — the pill keeps the build visible.
    view: focused ? "focused" : drafting ? "draft" : "list",
    showBuildPill: drafting,
  };
}

/**
 * One focus concept (C3): a reopened saved brief and an open local artifact
 * can never coexist. Callers enact the returned slots against their stores
 * (setReopenedSaved / openArtifact / closeArtifact).
 */
export type FocusIntent =
  | { kind: "saved"; state: DistrictLensState }
  | { kind: "local"; artifactId: string }
  | { kind: "clear" };

export interface FocusSlots {
  savedBrief: DistrictLensState | null;
  localArtifactId: string | null;
}

export function applyFocusIntent(intent: FocusIntent): FocusSlots {
  switch (intent.kind) {
    case "saved":
      return { savedBrief: intent.state, localArtifactId: null };
    case "local":
      return { savedBrief: null, localArtifactId: intent.artifactId };
    case "clear":
      return { savedBrief: null, localArtifactId: null };
  }
}
