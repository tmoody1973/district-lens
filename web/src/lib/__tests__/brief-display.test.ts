import { test, expect } from "vitest";

import { pickDisplayedBrief, type DisplayedBrief } from "@/lib/brief-display";
import { DEFAULT_STATE, type DistrictLensState } from "@/types/agent-state";

function liveState(): DistrictLensState {
  return { ...DEFAULT_STATE, currentRaceKey: "2026-H-WI-04", stage: "complete" };
}

function snapshot(): DisplayedBrief {
  return {
    mode: "journalist",
    state: { ...DEFAULT_STATE, currentRaceKey: "2026-H-CA-12", stage: "complete" },
  };
}

test("live agentState wins when it has a currentRaceKey", () => {
  const displayed = pickDisplayedBrief(liveState(), snapshot(), "voter");
  expect(displayed).not.toBeNull();
  expect(displayed!.mode).toBe("voter");
  expect(displayed!.state.currentRaceKey).toBe("2026-H-WI-04");
});

test("snapshot is used when agentState has been cleared", () => {
  const cleared: DistrictLensState = { ...DEFAULT_STATE, currentRaceKey: null };
  const snap = snapshot();
  const displayed = pickDisplayedBrief(cleared, snap, "voter");
  expect(displayed).toBe(snap);
  expect(displayed!.mode).toBe("journalist");
  expect(displayed!.state.currentRaceKey).toBe("2026-H-CA-12");
});

test("returns null when neither a live brief nor a snapshot exists", () => {
  expect(pickDisplayedBrief(DEFAULT_STATE, null, null)).toBeNull();
});

test("falls back to snapshot when a live race key exists but the loading mode is unknown", () => {
  const snap = snapshot();
  const displayed = pickDisplayedBrief(liveState(), snap, null);
  expect(displayed).toBe(snap);
});

test("returns null when live brief is cleared and there is no snapshot", () => {
  expect(pickDisplayedBrief(DEFAULT_STATE, null, "voter")).toBeNull();
});
