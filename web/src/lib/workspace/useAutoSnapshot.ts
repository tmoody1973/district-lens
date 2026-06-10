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
  // Full state is available via ref so we can narrow effect deps to the fields
  // that actually gate the snapshot decision.
  const stateRef = useRef<DistrictLensState>(state);
  stateRef.current = state;

  useEffect(() => {
    const current = stateRef.current;
    const prev = prevStageRef.current;
    prevStageRef.current = current.stage;
    if (!shouldSnapshot(prev, current.stage, current.currentRaceKey)) return;
    const key = `${current.currentRaceKey}:${current.briefStartedAt ?? ""}`;
    if (firedForRef.current === key) return;
    firedForRef.current = key;
    onSnapshotRef.current(current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stage, state.currentRaceKey, state.briefStartedAt]);
}
