import { test, expect } from "vitest";
import {
  applyFocusIntent,
  derivePanelView,
  isDraftingStage,
  shouldAutoFocus,
} from "@/lib/workspace/derivePanelView";

// ── view derivation ──────────────────────────────────────────────────────────

test("focused when a saved brief is reopened", () => {
  const r = derivePanelView({
    hasFocusedSavedBrief: true,
    hasFocusedLocalArtifact: false,
    stage: "idle",
  });
  expect(r.view).toBe("focused");
});

test("focused when a local artifact is open", () => {
  const r = derivePanelView({
    hasFocusedSavedBrief: false,
    hasFocusedLocalArtifact: true,
    stage: "idle",
  });
  expect(r.view).toBe("focused");
});

test("focused wins over a build in progress (D2)", () => {
  const r = derivePanelView({
    hasFocusedSavedBrief: false,
    hasFocusedLocalArtifact: true,
    stage: "finance",
  });
  expect(r.view).toBe("focused");
});

test("draft while a build runs and nothing is focused", () => {
  for (const stage of ["district", "candidates", "archiving"] as const) {
    const r = derivePanelView({
      hasFocusedSavedBrief: false,
      hasFocusedLocalArtifact: false,
      stage,
    });
    expect(r.view).toBe("draft");
  }
});

test("list at idle with nothing focused", () => {
  const r = derivePanelView({
    hasFocusedSavedBrief: false,
    hasFocusedLocalArtifact: false,
    stage: "idle",
  });
  expect(r.view).toBe("list");
});

test("R1: a stale live coagent brief never renders at rest (ND zombie)", () => {
  // The live coagent state can still hold the last race the agent touched
  // (stage "complete", currentRaceKey set). derivePanelView takes NO brief
  // content as input — at rest, with no focus slot set, the panel is the
  // LIST regardless of what the live state contains.
  const r = derivePanelView({
    hasFocusedSavedBrief: false,
    hasFocusedLocalArtifact: false,
    stage: "complete",
  });
  expect(r.view).toBe("list");
});

test("list before coagent state hydrates (stage undefined)", () => {
  const r = derivePanelView({
    hasFocusedSavedBrief: false,
    hasFocusedLocalArtifact: false,
    stage: undefined,
  });
  expect(r.view).toBe("list");
});

// ── build pill ───────────────────────────────────────────────────────────────

test("build pill shows whenever a build runs, even while focused", () => {
  const r = derivePanelView({
    hasFocusedSavedBrief: true,
    hasFocusedLocalArtifact: false,
    stage: "positions",
  });
  expect(r.showBuildPill).toBe(true);
});

test("build pill hidden at idle and at complete", () => {
  for (const stage of ["idle", "complete"] as const) {
    const r = derivePanelView({
      hasFocusedSavedBrief: false,
      hasFocusedLocalArtifact: false,
      stage,
    });
    expect(r.showBuildPill).toBe(false);
  }
});

test("isDraftingStage: active stages only", () => {
  expect(isDraftingStage("district")).toBe(true);
  expect(isDraftingStage("idle")).toBe(false);
  expect(isDraftingStage("complete")).toBe(false);
  expect(isDraftingStage(undefined)).toBe(false);
});

// ── focus cross-clear (C3) ───────────────────────────────────────────────────

test("C3: focusing a saved brief clears any local artifact focus", () => {
  const state = { currentRaceKey: "2026-WI-house-04" };
  const next = applyFocusIntent({ kind: "saved", state });
  expect(next).toEqual({ savedBrief: state, localArtifactId: null });
});

test("C3: focusing a local artifact clears any saved brief focus", () => {
  const next = applyFocusIntent({ kind: "local", artifactId: "a1" });
  expect(next).toEqual({ savedBrief: null, localArtifactId: "a1" });
});

test("clear intent empties both focus slots", () => {
  const next = applyFocusIntent({ kind: "clear" });
  expect(next).toEqual({ savedBrief: null, localArtifactId: null });
});

// ── polite auto-focus (D2/C4) ────────────────────────────────────────────────

test("auto-focus fires when a snapshot landed and the user stayed put", () => {
  expect(
    shouldAutoFocus({ snapshotRecorded: true, userNavigatedSinceRunStart: false }),
  ).toBe(true);
});

test("auto-focus suppressed when the user navigated mid-run", () => {
  expect(
    shouldAutoFocus({ snapshotRecorded: true, userNavigatedSinceRunStart: true }),
  ).toBe(false);
});

test("auto-focus suppressed when no snapshot was recorded (no raceKey)", () => {
  expect(
    shouldAutoFocus({ snapshotRecorded: false, userNavigatedSinceRunStart: false }),
  ).toBe(false);
});
