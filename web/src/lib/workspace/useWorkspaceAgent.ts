"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCoAgent, useCopilotReadable } from "@copilotkit/react-core";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
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

  // Track when the agent can actually accept a programmatic run. Connection
  // status alone is NOT enough: the core flips to Connected before the /info
  // agents land in the registry, and until then useAgent() hands out a
  // provisional agent whose messages are DISCARDED on the swap to the real
  // instance (the backend then errors with "requires either a new_message or
  // an invocation_id"). Ready = runtime connected AND districtlens_root is
  // registered as a real agent.
  const computeAgentReady = useCallback(
    () =>
      copilotkit.runtimeConnectionStatus === CopilotKitCoreRuntimeConnectionStatus.Connected &&
      copilotkit.getAgent("districtlens_root") !== undefined,
    [copilotkit],
  );
  const [isAgentReady, setIsAgentReady] = useState(computeAgentReady);

  useEffect(() => {
    // Sync once on mount in case readiness resolved between the useState seed
    // and the first render commit (React double-invoke in StrictMode, etc.).
    if (computeAgentReady()) setIsAgentReady(true);

    const subscription = copilotkit.subscribe({
      onRuntimeConnectionStatusChanged: ({ status }) => {
        setIsAgentReady(computeAgentReady());
      },
      onAgentsChanged: () => {
        setIsAgentReady(computeAgentReady());
      },
    });

    return () => subscription.unsubscribe();
  }, [copilotkit, computeAgentReady]);

  // Which mode loaded the current brief (each persona keeps its own view).
  const [lastBriefMode, setLastBriefMode] = useState<AppMode | null>(null);
  // Last live brief, captured continuously — survives coagent state clearing.
  const [briefSnapshot, setBriefSnapshot] = useState<DisplayedBrief | null>(null);
  const prevStageRef = useRef<string>("idle");
  // Snapshots are captured at stage transitions (incl. complete, which carries
  // the full final state) instead of every streaming tick.
  const latestStateRef = useRef<DistrictLensState>(agentState);
  latestStateRef.current = agentState;

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
    if (latestStateRef.current.currentRaceKey && lastBriefMode) {
      setBriefSnapshot({ mode: lastBriefMode, state: latestStateRef.current });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentState.currentRaceKey, agentState.stage, lastBriefMode]);

  // Pending-run queue: at mount, useCoAgent's connectAgent handshake is itself
  // an agent run, so agent.isRunning is briefly true. A kickoff arriving in
  // that window must wait for the handshake to settle, not be dropped.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
  }, []);

  const run = useCallback(
    (content: string) => {
      const attempt = (retriesLeft: number) => {
        // Resolve the registered agent at run time: the `agent` from useAgent()
        // may still be the pre-connect provisional instance, whose messages are
        // discarded on the swap to the real one (backend then errors with
        // "requires either a new_message or an invocation_id").
        const liveAgent = copilotkit.getAgent("districtlens_root") ?? agent;
        if (liveAgent.isRunning) {
          // A real brief build in progress → drop (legacy behavior). Only the
          // mount-time connect handshake (stage still idle) is worth waiting out.
          if (latestStateRef.current.stage !== "idle" || retriesLeft <= 0) return;
          retryTimerRef.current = setTimeout(() => attempt(retriesLeft - 1), 250);
          return;
        }
        options?.onRunStart?.();
        liveAgent.addMessage({ id: crypto.randomUUID(), role: "user", content });
        copilotkit.runAgent({ agent: liveAgent }).catch(() => {
          /* surfaced through chat UI; workspace stays usable */
        });
      };
      attempt(40); // up to ~10s for the handshake to settle
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
    isAgentReady,
    isRunning: agent.isRunning,
    submitAddress,
    exploreState,
    openRace,
    setMode,
    clearBrief,
  };
}
