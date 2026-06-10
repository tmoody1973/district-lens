"use client";

import { useEffect, useRef } from "react";
import { isDraftingStage } from "./derivePanelView";
import type { ResearchStage } from "@/types/agent-state";

/**
 * Fires once when a build actually starts, keyed off the coagent stage
 * transition (rest → active). This is the source of truth for DRAFT (C2):
 * typed-chat builds never call onRunStart, but the stage still moves.
 *
 * Deliberately silent when hydration lands straight into an active stage
 * (prev unknown) — a mid-build refresh must not wipe focus the user just
 * restored.
 */
export function useBuildStart(
  stage: ResearchStage | null | undefined,
  onBuildStart: () => void,
) {
  const prevRef = useRef(stage);
  // Latest callback without making it an effect dependency — callers pass
  // inline closures over page state.
  const onBuildStartRef = useRef(onBuildStart);
  useEffect(() => {
    onBuildStartRef.current = onBuildStart;
  });

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = stage;
    if (prev != null && !isDraftingStage(prev) && isDraftingStage(stage)) {
      onBuildStartRef.current();
    }
  }, [stage]);
}
