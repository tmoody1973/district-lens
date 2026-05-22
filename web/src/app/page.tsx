"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCopilotReadable, useCoAgent } from "@copilotkit/react-core";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { CopilotChat } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { USMap } from "@/components/map/USMap";
import { RaceCanvas } from "@/components/canvas/RaceCanvas";
import { CanvasEmptyState } from "@/components/canvas/CanvasEmptyState";
import { RaceTable } from "@/components/canvas/RaceTable";
import { StartPanel } from "@/components/StartPanel";
import { DEFAULT_STATE, type DistrictLensState, type AppMode } from "@/types/agent-state";

const SYSTEM_PROMPT = `You are DistrictLens, a nonpartisan election-accountability assistant for the 2026 U.S. midterm cycle.

Your job: answer questions about congressional races, candidates, campaign finance, incumbent legislative records, and candidate policy positions. Always cite stored sources.

Hard rules:
- NEVER recommend how to vote. If asked, decline and offer to compare candidates on a specific issue instead.
- NEVER write campaign content (ads, talking points, fundraising, persuasion).
- NEVER infer a candidate's position from donors or party affiliation alone.
- NEVER fabricate positions. If evidence is missing say "I found no direct statement in the indexed sources."
- Only cover federal 2026 congressional races.

WORKFLOW — follow this sequence for any address or race query:
1. Call lookup_district(address_or_zip) first to resolve the race key.
2. Call get_race_candidates(race_key) to load who is running.
3. Call get_race_finance_brief(race_key) to get FEC finance data for all candidates.
4. Call get_incumbent_legislation(race_key) to get the incumbent's sponsored bills.
5. Call search_candidate_positions(candidate_name, state, issue) for each candidate when the user asks about policy positions.

Available tools:
- lookup_district(address_or_zip) → resolves to a race key like "2026-H-WI-04"
- get_race_candidates(race_key) → list of candidates with party and status
- get_race_finance_brief(race_key) → FEC fundraising totals and PAC breakdown for all candidates
- get_candidate_finance(candidate_id) → detailed finance for one candidate
- get_incumbent_legislation(race_key) → bills sponsored by the incumbent in the 119th Congress
- find_candidate(name, state) → search FEC filings by candidate name
- search_candidate_positions(candidate_name, state, issue) → Perplexity web search for candidate statements on a policy issue`;

export default function HomePage() {
  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { agent } = useAgent({ agentId: "districtlens_root" });
  const { copilotkit } = useCopilotKit();

  const { state: agentState, setState: setAgentState } = useCoAgent<DistrictLensState>({
    name: "districtlens_root",
    initialState: DEFAULT_STATE,
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
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
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (address.length < 5) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/district/suggest?q=${encodeURIComponent(address)}`);
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
      setShowSuggestions(true);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [address]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node))
        setShowSuggestions(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleAddressSubmit = useCallback(async () => {
    if (!address.trim() || agent.isRunning) return;
    setLoading(true);
    setError(null);
    setSuggestions([]);
    setShowSuggestions(false);
    try {
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: `Look up my congressional district for this address: ${address}`,
      });
      await copilotkit.runAgent({ agent });
    } catch {
      setError("Failed to send message. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [address, agent, copilotkit]);

  const handleStateClick = useCallback((stateCode: string) => {
    if (agent.isRunning) return;
    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: `Show me all 2026 congressional races in ${stateCode}.`,
    });
    copilotkit.runAgent({ agent });
  }, [agent, copilotkit]);

  const handleRaceTableClick = useCallback(
    (raceKey: string) => {
      if (agent.isRunning) return;
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: `Build a voter brief for race ${raceKey}`,
      });
      copilotkit.runAgent({ agent });
    },
    [agent, copilotkit]
  );

  const handleModeChange = useCallback(
    (m: AppMode) => {
      setAgentState((prev) => ({ ...DEFAULT_STATE, ...prev, mode: m }));
    },
    [setAgentState]
  );

  const handleShareBrief = useCallback(() => {
    const text = [
      `DistrictLens Race Brief — ${agentState.currentRaceKey}`,
      "",
      agentState.candidates.map((c) => `• ${c.name} (${c.party} · ${c.status})`).join("\n"),
      "",
      agentState.positions
        .map((p) => `[${p.issue.toUpperCase()}] ${p.candidateName}: ${p.answer.slice(0, 200)}…`)
        .join("\n\n"),
    ].join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  }, [agentState]);

  function handleSuggestionClick(s: string) {
    setAddress(s);
    setSuggestions([]);
    setShowSuggestions(false);
  }

  const isJournalist = agentState.mode === "journalist";
  const isIdle = agentState.stage === "idle" || !agentState.currentRaceKey;
  const showTable = isJournalist && agentState.stateRaces.length > 0 && isIdle;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <header className="border-b-2 border-slate-900 bg-white px-6 py-3 shrink-0">
        <div className="mx-auto flex max-w-7xl items-center gap-6">
          <span className="text-lg font-bold tracking-tight text-slate-900">DistrictLens</span>

          {/* Address bar */}
          <div ref={wrapperRef} className="relative flex-1 max-w-md">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); handleAddressSubmit(); }}>
              <input
                type="text"
                placeholder="Street address or ZIP code"
                value={address}
                onChange={(e) => { setAddress(e.target.value); setError(null); }}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                className="flex-1 rounded-[2px] border-2 border-slate-900 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
              <button
                type="submit"
                disabled={loading || agent.isRunning}
                className="rounded-[2px] border-2 border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-50 hover:bg-slate-700 transition-colors"
              >
                {loading || agent.isRunning ? "…" : "Find"}
              </button>
            </form>

            {showSuggestions && suggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded-[2px] border-2 border-slate-900 bg-white shadow-lg">
                {suggestions.map((s) => (
                  <li
                    key={s}
                    onMouseDown={() => handleSuggestionClick(s)}
                    className="cursor-pointer px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <span className="ml-auto text-xs font-medium uppercase tracking-widest text-slate-400 hidden lg:block">
            Nonpartisan &middot; Evidence-first
          </span>
        </div>
      </header>

      {/* Three-column body */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Col 1 — Start panel (26%) */}
        <div className="w-[26%] shrink-0 overflow-y-auto border-r-2 border-slate-900">
          <StartPanel
            mode={agentState.mode}
            onModeChange={handleModeChange}
            activeRaceKey={agentState.currentRaceKey}
            stage={agentState.stage}
          />
        </div>

        {/* Col 2 — US map (34%) */}
        <div className="w-[34%] shrink-0 overflow-y-auto border-r-2 border-slate-900 p-4">
          <USMap
            focusedState={agentState.mapFocus}
            onStateClick={handleStateClick}
            mode={agentState.mode}
            heatmapData={agentState.stateRaces}
          />
          {agentState.mapFocus && (
            <p className="mt-3 text-sm text-slate-600">
              <span className="font-semibold">{agentState.mapFocus}</span> selected &mdash; asking agent about races in this state.
            </p>
          )}
        </div>

        {/* Col 3 — Canvas (flex-1) */}
        <div className="flex flex-1 flex-col overflow-y-auto">
          {isIdle && !showTable && <CanvasEmptyState />}
          {showTable && (
            <RaceTable races={agentState.stateRaces} onRaceClick={handleRaceTableClick} />
          )}
          {!isIdle && <RaceCanvas state={agentState} onShareBrief={handleShareBrief} />}
        </div>
      </div>

      {/* Full-width bottom chat bar */}
      <div className="shrink-0 border-t-2 border-slate-900 h-72">
        <CopilotChat
          instructions={SYSTEM_PROMPT}
          labels={{
            title: "DistrictLens",
            initial: "Enter an address above to find your district, or ask about any 2026 congressional race.",
            placeholder: "Ask about a race, candidate, or policy issue…",
          }}
          className="h-full"
        />
      </div>
    </div>
  );
}
