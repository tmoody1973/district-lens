"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { useCoAgentStateRender, useCopilotReadable, useCopilotAction } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { USMap } from "@/components/map/USMap";
import { RaceCanvas } from "@/components/canvas/RaceCanvas";
import { DEFAULT_STATE, type DistrictLensState, type AppMode } from "@/types/agent-state";

const SYSTEM_PROMPT = `You are DistrictLens, a nonpartisan election-accountability assistant for the 2026 U.S. midterm cycle.

Your job: answer questions about congressional races, candidates, campaign finance, incumbent legislative records, and election dates. Always cite stored sources.

Hard rules:
- NEVER recommend how to vote. If asked, decline and offer to call compare_candidates.
- NEVER write campaign content (ads, talking points, fundraising, persuasion).
- NEVER infer a candidate's position from donors or party affiliation alone.
- NEVER fabricate positions. If evidence is missing say "I found no direct statement in the indexed sources."
- Only cover federal 2026 congressional races.

Available tools:
- lookup_district(address) → race_key. Call first for any address.
- get_race_brief(race_key) → candidates + FEC finance. Call after lookup_district. Returns STRUCTURED_DATA.
- get_incumbent_legislation(race_key) → sponsored bills. Returns STRUCTURED_DATA.
- find_candidate(name, state?) → FEC name search.
- get_state_races(state_code) → all races in a state. Returns STRUCTURED_DATA.
- find_competitive_races(state?) → challenger outraising incumbent. Returns STRUCTURED_DATA.
- build_candidate_profile(race_key) → photos, websites, committees. Returns STRUCTURED_DATA.
- search_candidate_positions(candidate_name, issue) → Perplexity web search. Returns STRUCTURED_DATA.
- search_current_news(candidate_name) → last 7 days news. Returns STRUCTURED_DATA.
- get_election_dates(state_code) → primary dates, early voting.
- set_canvas_state(updates) → UPDATE THE CANVAS DISPLAY. Call this after every tool that returns STRUCTURED_DATA.

CRITICAL CANVAS UPDATE RULE:
After EVERY tool call that returns "STRUCTURED_DATA:" in its response:
1. Parse the JSON after "STRUCTURED_DATA:"
2. Immediately call set_canvas_state with the parsed data as "updates" (JSON string)
3. Also include "stage" and "currentRaceKey" in set_canvas_state when relevant

Example flow:
1. lookup_district("123 Main St") → returns "District: 2026-H-WI-04..."
2. set_canvas_state({ updates: '{"stage":"district","currentRaceKey":"2026-H-WI-04"}' })
3. get_race_brief("2026-H-WI-04") → returns "...STRUCTURED_DATA:{candidates:[...],finance:[...]}"
4. set_canvas_state({ updates: '{"stage":"candidates","candidates":[...],"finance":[...]}' })
5. get_incumbent_legislation("2026-H-WI-04") → returns "...STRUCTURED_DATA:{legislation:[...]}"
6. set_canvas_state({ updates: '{"stage":"legislation","legislation":[...]}' })`;

export default function HomePage() {
  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<AppMode>("voter");
  const [agentState, setAgentState] = useState<DistrictLensState>(DEFAULT_STATE);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useCoAgentStateRender<DistrictLensState>({
    name: "districtlens",
    render: ({ state }) => {
      if (state) setAgentState(state);
      return null;
    },
  });

  useCopilotReadable({
    description: "Current app mode and selected race",
    value: `Mode: ${mode}. Current race: ${agentState.currentRaceKey ?? "none"}.`,
  });

  useCopilotAction({
    name: "set_canvas_state",
    description:
      "Update the canvas display with structured data from a tool result. " +
      "Call after every tool that returns STRUCTURED_DATA.",
    parameters: [
      {
        name: "updates",
        type: "string",
        description:
          "JSON stringified partial DistrictLensState object. " +
          "Keys: stage, currentRaceKey, candidates, finance, legislation, news, positions, stateRaces, comparisons.",
        required: true,
      },
    ],
    handler: async ({ updates }: { updates: string }) => {
      try {
        const parsed = JSON.parse(updates) as Partial<DistrictLensState>;
        setAgentState((prev) => ({ ...prev, ...parsed }));
        return "Canvas updated.";
      } catch {
        return "Canvas update failed — invalid JSON.";
      }
    },
  });

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

  const handleStateClick = useCallback((stateCode: string) => {
    setAgentState((prev) => ({ ...prev, mapFocus: stateCode }));
  }, []);

  function handleSuggestionClick(s: string) {
    setAddress(s);
    setSuggestions([]);
    setShowSuggestions(false);
  }

  return (
    <CopilotSidebar
      instructions={SYSTEM_PROMPT}
      defaultOpen={true}
      labels={{
        title: "DistrictLens",
        initial: "Enter an address to find your district, or ask about any 2026 congressional race.",
        placeholder: "Ask about a race, candidate, or issue…",
      }}
    >
      <div className="flex flex-col h-screen">
        {/* Header */}
        <header className="border-b-2 border-slate-900 bg-white px-6 py-3 shrink-0">
          <div className="mx-auto flex max-w-7xl items-center gap-6">
            <span className="text-lg font-bold tracking-tight text-slate-900">DistrictLens</span>

            {/* Mode toggle */}
            <div className="flex rounded-[2px] border-2 border-slate-900 overflow-hidden">
              {(["voter", "journalist"] as AppMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={[
                    "px-4 py-1.5 text-sm font-semibold capitalize transition-colors",
                    mode === m
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-100",
                  ].join(" ")}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Address bar */}
            <div ref={wrapperRef} className="relative flex-1 max-w-md">
              <form className="flex gap-2" onSubmit={(e) => e.preventDefault()}>
                <input
                  type="text"
                  placeholder="Street address or ZIP code"
                  value={address}
                  onChange={(e) => { setAddress(e.target.value); setError(null); }}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  className="flex-1 rounded-[2px] border-2 border-slate-900 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
                <Button
                  type="submit"
                  isDisabled={loading}
                  size="sm"
                  className="rounded-[2px] border-2 border-slate-900 bg-slate-900 px-4 font-semibold text-white"
                >
                  {loading ? "…" : "Find"}
                </Button>
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

            {error && (
              <p className="text-sm text-red-700">{error}</p>
            )}

            <span className="ml-auto text-xs font-medium uppercase tracking-widest text-slate-400 hidden lg:block">
              Nonpartisan &middot; Evidence-first
            </span>
          </div>
        </header>

        {/* Three-zone body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Map zone — 40% */}
          <div className="w-2/5 border-r-2 border-slate-900 p-4 overflow-y-auto shrink-0">
            <USMap
              focusedState={agentState.mapFocus}
              onStateClick={handleStateClick}
            />
            {agentState.mapFocus && (
              <p className="mt-3 text-sm text-slate-600">
                <span className="font-semibold">{agentState.mapFocus}</span> selected &mdash; ask the agent about races in this state.
              </p>
            )}
          </div>

          {/* Canvas zone — 60% */}
          <div className="flex-1 overflow-y-auto">
            <RaceCanvas state={agentState} />
          </div>
        </div>
      </div>
    </CopilotSidebar>
  );
}
