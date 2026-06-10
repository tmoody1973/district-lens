"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCoAgent, useCopilotReadable } from "@copilotkit/react-core";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { pickDisplayedBrief, type DisplayedBrief } from "@/lib/brief-display";
import { DEFAULT_STATE, type AppMode, type DistrictLensState } from "@/types/agent-state";

export interface UseWorkspaceAgentOptions {
  /** Called synchronously after accepting a run (after the isRunning guard). */
  onRunStart?: () => void;
}

/**
 * CopilotKit agent wiring for the workspace — extracted from the legacy
 * page.tsx so the shell components stay presentation-only.
 */
export function useWorkspaceAgent(options?: UseWorkspaceAgentOptions) {
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
      options?.onRunStart?.();
      agent.addMessage({ id: crypto.randomUUID(), role: "user", content });
      copilotkit.runAgent({ agent }).catch(() => {
        /* surfaced through chat UI; workspace stays usable */
      });
    },
    // options.onRunStart intentionally excluded — callers should pass a stable
    // ref-backed callback to avoid re-creating run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
