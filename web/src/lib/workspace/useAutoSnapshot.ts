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
  // Latest callback without re-running the snapshot effect every render —
  // call sites pass inline callbacks, which would otherwise churn the deps.
  const onSnapshotRef = useRef(onSnapshot);
  useEffect(() => {
    onSnapshotRef.current = onSnapshot;
  });

  useEffect(() => {
    const prev = prevStageRef.current;
    prevStageRef.current = state.stage;
    if (!shouldSnapshot(prev, state.stage, state.currentRaceKey)) return;
    const key = `${state.currentRaceKey}:${state.briefStartedAt ?? ""}`;
    if (firedForRef.current === key) return;
    firedForRef.current = key;
    onSnapshotRef.current(state);
  }, [state]);
}
