"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCopilotReadable, useCoAgent, useCopilotChat, useCopilotMessagesContext, useThreads } from "@copilotkit/react-core";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { CopilotChat } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { USMap } from "@/components/map/USMap";
import { RaceCanvas } from "@/components/canvas/RaceCanvas";
import { CanvasEmptyState } from "@/components/canvas/CanvasEmptyState";
import { RaceTable } from "@/components/canvas/RaceTable";
import { ReceiptProgress } from "@/components/canvas/ReceiptProgress";
import { AgentToolTrace } from "@/components/canvas/AgentToolTrace";
import { ThreadsPanel } from "@/components/canvas/ThreadsPanel";
import { annotateSteps, stepsFromStage } from "@/lib/steps";
import { pickDisplayedBrief, type DisplayedBrief } from "@/lib/brief-display";
import type { SavedBallotItem, SavedBriefDoc } from "@/lib/saved-briefs/schema";
import type { AgentThreadDoc, ThreadSummary } from "@/lib/threads/schema";
import { DEFAULT_STATE, type DistrictLensState, type AppMode } from "@/types/agent-state";

const SYSTEM_PROMPT = `You are DistrictLens, a nonpartisan election-accountability assistant for the 2026 U.S. midterm cycle.

Your job: answer questions about congressional races, candidates, campaign finance, incumbent legislative records, and candidate policy positions. Always cite stored sources. When evidence is missing, say so directly.

Hard rules:
- NEVER recommend how to vote. If asked, decline and offer to compare candidates on a specific issue instead.
- NEVER write campaign content (ads, talking points, fundraising, persuasion).
- NEVER infer a candidate's position from donors or party affiliation alone.
- NEVER fabricate positions. If evidence is missing say "I found no direct statement in the indexed sources."
- Only cover federal 2026 congressional races. For state, county, municipal, or ballot-measure contests, say the tool's scope is federal and decline gracefully.

Voter brief — do NOT orchestrate it yourself:
The full voter brief runs as a deterministic server-side pipeline. When the user submits an address, the frontend sends "Build a complete voter brief for: <address>" and that pipeline resolves the district, candidates, finance, incumbent legislation, and every candidate's stances in a fixed order, streaming each step to the live progress tracker. Do NOT chain lookup_district, get_race_candidates, get_race_finance_brief, get_incumbent_legislation, or search_candidate_positions to assemble a brief — the pipeline owns that path.

Targeted follow-ups (use these for specific chat questions, not to rebuild a brief):
- search_candidate_positions(candidate_name, state, issue) → one candidate's stance on one issue the user names
- get_candidate_finance(candidate_id) → finance detail for a single candidate
- find_candidate(name, state) → look up a candidate in FEC filings

Journalist mode:
When the user asks to see all races in a state, or selects a state on the map (e.g. "Show me all 2026 congressional races in WI"), call get_state_races(state_code) once, then summarize in one sentence how many races there are and any notable fundraising gaps. Do NOT start the voter-brief workflow for this.`;

const CHAT_LABELS = {
  title: "DistrictLens",
  initial:
    "Enter your address above to build your voter brief, or ask about any 2026 congressional race.",
  placeholder: "Ask about candidates, issues, or fundraising…",
};

export default function HomePage() {
  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  // Which mode loaded the current brief. Lets each tab show its own view:
  // the journalist map isn't replaced by a voter brief, and switching tabs
  // back preserves the brief (map exploration doesn't change this).
  const [lastBriefMode, setLastBriefMode] = useState<AppMode | null>(null);
  // Last live brief, captured continuously. Survives any later clearing of the
  // CopilotKit coagent state so a completed brief is never lost to a hiccup,
  // and is the serializable shape a future "Save brief" button persists.
  const [briefSnapshot, setBriefSnapshot] = useState<DisplayedBrief | null>(null);
  // "My Ballot" — the signed-in user's saved races, and a brief reopened from it.
  // An opened saved brief takes display priority over the live/snapshot brief.
  const [savedItems, setSavedItems] = useState<SavedBallotItem[]>([]);
  const [openedBrief, setOpenedBrief] = useState<DisplayedBrief | null>(null);
  // Journalist research threads (named containers of saved briefs + notes).
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThread, setActiveThread] = useState<{
    thread: AgentThreadDoc;
    briefs: SavedBriefDoc[];
  } | null>(null);

  const { agent } = useAgent({ agentId: "districtlens_root" });
  const { copilotkit } = useCopilotKit();

  const { state: agentState, setState: setAgentState } = useCoAgent<DistrictLensState>({
    name: "districtlens_root",
    initialState: DEFAULT_STATE,
  });
  const { visibleMessages } = useCopilotChat();
  const { setMessages } = useCopilotMessagesContext();
  const { setThreadId } = useThreads();
  const lastSavedTranscriptRef = useRef<string>("");
  // Tracks the raceKey:threadId pair already auto-saved this run so we don't
  // double-capture the same brief if stage stays "complete" across renders.
  const autoSavedRef = useRef<string | null>(null);
  // Tracks the last requested threadId so stale async fetches don't clobber.
  const openThreadIdRef = useRef<string | null>(null);

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

  // Capture the live brief while it's present. When agentState later loses its
  // currentRaceKey the guard is false, so the last good snapshot is retained
  // rather than overwritten with an empty state.
  useEffect(() => {
    if (agentState.currentRaceKey && lastBriefMode) {
      setBriefSnapshot({ mode: lastBriefMode, state: agentState });
    }
  }, [agentState, lastBriefMode]);

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

  const handleAddressSubmit = useCallback(async (addrOverride?: string) => {
    const addr = addrOverride ?? address;
    if (!addr.trim() || agent.isRunning) return;
    if (addrOverride) setAddress(addrOverride);
    setLoading(true);
    setError(null);
    setSuggestions([]);
    setShowSuggestions(false);
    setLastBriefMode("voter");
    setOpenedBrief(null);
    try {
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: `Build a complete voter brief for: ${addr}`,
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
    setOpenedBrief(null);
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
      setLastBriefMode("journalist");
      setOpenedBrief(null);
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: `Build a complete voter brief for race: ${raceKey}`,
      });
      copilotkit.runAgent({ agent });
    },
    [agent, copilotkit]
  );

  const handleModeChange = useCallback(
    (m: AppMode) => {
      // Switch the lens but preserve state (prev overrides DEFAULT) so each
      // tab's view is kept; lastBriefMode + the render decide what shows.
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

  // Save-to-ballot status, reset whenever the displayed race changes so a prior
  // "Saved ✓" never lingers on a different brief.
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => {
    setSaveStatus("idle");
  }, [agentState.currentRaceKey]);

  // Load the user's saved ballot. 401 (signed out) just leaves the list empty —
  // reads never block on auth.
  const loadBallot = useCallback(async () => {
    try {
      const res = await fetch("/api/saved");
      if (!res.ok) { setSavedItems([]); return; }
      const data = await res.json();
      setSavedItems(data.items ?? []);
    } catch {
      setSavedItems([]);
    }
  }, []);

  useEffect(() => { loadBallot(); }, [loadBallot]);

  // --- Journalist research threads ---
  const loadThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/threads");
      if (!res.ok) { setThreads([]); return; }
      const data = await res.json();
      setThreads(data.threads ?? []);
    } catch {
      setThreads([]);
    }
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  const openThread = useCallback(async (threadId: string) => {
    openThreadIdRef.current = threadId;
    try {
      const res = await fetch(`/api/threads/${threadId}`);
      if (!res.ok) return;
      // Stale-write guard: bail if user switched to a different thread while
      // this fetch was in flight.
      if (openThreadIdRef.current !== threadId) return;
      const data = await res.json();
      setActiveThread({ thread: data.thread, briefs: data.briefs ?? [] });
      setThreadId(threadId);
      // Restore chat synchronously from the already-loaded thread doc — no
      // second round-trip needed.
      setMessages(data.thread?.messages ?? []);
    } catch {
      /* ignore */
    }
  }, [setThreadId, setMessages]);

  // Auto-capture: when a brief completes and a thread is open, silently file
  // it as an artifact. Dedup via autoSavedRef prevents re-saving the same
  // raceKey+threadId pair if stage stays "complete" across renders.
  useEffect(() => {
    if (agentState.stage !== "complete") return;
    if (!agentState.currentRaceKey || !activeThread) return;
    const threadId = activeThread.thread.thread_id;
    const dedupKey = `${agentState.currentRaceKey}:${threadId}`;
    if (autoSavedRef.current === dedupKey) return;
    autoSavedRef.current = dedupKey;
    const state = agentState;
    fetch("/api/saved/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, threadId }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        loadBallot();
        loadThreads();
        // Refresh the active thread's briefs list without disturbing the live chat.
        // Calling openThread here would also reset messages, clobbering the conversation.
        try {
          const refresh = await fetch(`/api/threads/${threadId}`);
          if (refresh.ok) {
            const { briefs } = await refresh.json();
            setActiveThread((prev) =>
              prev && prev.thread.thread_id === threadId
                ? { ...prev, briefs: briefs ?? [] }
                : prev,
            );
          }
        } catch { /* ignore */ }
      })
      .catch(() => {});
    // agentState used in body but only stage/raceKey are reactive triggers;
    // dedup key prevents stale captures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentState.stage, agentState.currentRaceKey, activeThread?.thread.thread_id, loadBallot, loadThreads]);

  const createThread = useCallback(async () => {
    try {
      const seed = agentState.currentRaceKey ? { raceKey: agentState.currentRaceKey } : {};
      const res = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(seed),
      });
      if (!res.ok) return;
      const data = await res.json();
      await loadThreads();
      // Open via the GET path so the active thread has the same clean shape as
      // every other opened thread (projected, defaults applied).
      if (data.thread?.thread_id) await openThread(data.thread.thread_id);
    } catch {
      /* ignore */
    }
  }, [agentState.currentRaceKey, loadThreads, openThread]);

  const renameThread = useCallback(async (threadId: string, title: string) => {
    await fetch(`/api/threads/${threadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    await loadThreads();
    setActiveThread((prev) =>
      prev && prev.thread.thread_id === threadId
        ? { ...prev, thread: { ...prev.thread, title } }
        : prev,
    );
  }, [loadThreads]);

  const saveThreadNotes = useCallback(async (threadId: string, notes: string) => {
    await fetch(`/api/threads/${threadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    setActiveThread((prev) =>
      prev && prev.thread.thread_id === threadId
        ? { ...prev, thread: { ...prev.thread, notes } }
        : prev,
    );
  }, []);

  const deleteThread = useCallback(async (threadId: string) => {
    await fetch(`/api/threads/${threadId}`, { method: "DELETE" });
    setActiveThread((prev) => (prev && prev.thread.thread_id === threadId ? null : prev));
    await loadThreads();
  }, [loadThreads]);

  // While a thread is open, capture the chat conversation onto it as a read-only
  // transcript (debounced). Stored so reopening the thread shows what was asked.
  const activeThreadId = activeThread?.thread.thread_id ?? null;
  useEffect(() => {
    if (!activeThreadId) return;
    const transcript = (visibleMessages ?? []).flatMap((m) => {
      const role = (m as { role?: unknown }).role;
      const content = (m as { content?: unknown }).content;
      return typeof content === "string" && (role === "user" || role === "assistant")
        ? [{ role, content }]
        : [];
    });
    if (transcript.length === 0) return;
    const sig = activeThreadId + JSON.stringify(transcript);
    if (sig === lastSavedTranscriptRef.current) return;
    const timer = setTimeout(() => {
      lastSavedTranscriptRef.current = sig;
      fetch(`/api/threads/${activeThreadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: transcript }),
      })
        .then(() =>
          setActiveThread((prev) =>
            prev && prev.thread.thread_id === activeThreadId
              ? { ...prev, thread: { ...prev.thread, messages: transcript } }
              : prev,
          ),
        )
        .catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [visibleMessages, activeThreadId]);

  const saveBrief = useCallback(async (state: DistrictLensState, threadId?: string) => {
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/saved/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, threadId }),
      });
      setSaveStatus(res.ok ? "saved" : "error");
      if (res.ok) {
        loadBallot();
        if (threadId) { loadThreads(); openThread(threadId); }
      }
    } catch {
      setSaveStatus("error");
    }
  }, [loadBallot, loadThreads, openThread]);

  // Reopen a saved snapshot: fetch it, show it (openedBrief wins over live), and
  // switch to the tab that loaded it so the canvas renders it.
  const openSavedBrief = useCallback(
    async (briefId: string) => {
      try {
        const res = await fetch(`/api/saved/brief/${briefId}`);
        if (!res.ok) return;
        const { brief } = await res.json();
        const snapshot = brief.answer_snapshot as DistrictLensState;
        const mode: AppMode = snapshot.mode ?? "voter";
        setOpenedBrief({ mode, state: snapshot });
        setAgentState((prev) => ({ ...DEFAULT_STATE, ...prev, mode }));
      } catch {
        /* ignore — reopening is best-effort */
      }
    },
    [setAgentState]
  );

  // On thread switch: wipe ALL state that feeds the center canvas and chat, then
  // restore the new thread's brief if it has one. Three things feed the canvas:
  // openedBrief, agentState.currentRaceKey, and briefSnapshot — all must reset.
  useEffect(() => {
    setMessages([]);
    setOpenedBrief(null);
    setAgentState(DEFAULT_STATE);
    setBriefSnapshot(null);
    setLastBriefMode(null);
    autoSavedRef.current = null; // reset dedup so new thread can auto-capture
    if (activeThread && activeThread.briefs.length > 0) {
      openSavedBrief(activeThread.briefs[0].brief_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.thread.thread_id]);

  function handleSuggestionClick(s: string) {
    setAddress(s);
    setSuggestions([]);
    setShowSuggestions(false);
  }

  const isJournalist = agentState.mode === "journalist";
  const steps = annotateSteps(stepsFromStage(agentState.stage), agentState);
  const isComplete = agentState.stage === "complete";
  // A reopened saved brief wins; otherwise prefer the live brief and fall back
  // to the snapshot if agentState was cleared.
  const displayed = openedBrief ?? pickDisplayedBrief(agentState, briefSnapshot, lastBriefMode);
  // A loaded brief shows only in the tab that loaded it; otherwise each tab
  // shows its own home (voter → address entry, journalist → map).
  const showVoterBrief = !isJournalist && displayed?.mode === "voter";
  const showJournalistRace = isJournalist && displayed?.mode === "journalist";

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Renders agent tool calls (incl. MongoDB MCP) inline in the chat */}
      <AgentToolTrace />
      {/* Header */}
      <header className="border-b-2 border-slate-900 bg-white px-4 py-3 shrink-0 lg:px-6">
        <div className="mx-auto flex max-w-7xl items-center gap-3 lg:gap-6">
          <span className="shrink-0 text-lg font-bold tracking-tight text-slate-900">DistrictLens</span>

          {/* Address bar — min-w-0 lets the input shrink below its placeholder so the Find button stays on-screen at narrow widths */}
          <div ref={wrapperRef} className="relative min-w-0 flex-1 max-w-md">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); handleAddressSubmit(); }}>
              <input
                type="text"
                placeholder="Street address or ZIP code"
                aria-label="Street address or ZIP code"
                value={address}
                onChange={(e) => { setAddress(e.target.value); setError(null); }}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                className="min-w-0 flex-1 rounded-[2px] border-2 border-slate-900 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700"
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

          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-widest text-slate-400 hidden lg:block">
              Nonpartisan &middot; Evidence-first
            </span>
            <Show
              when="signed-in"
              fallback={
                <SignInButton mode="modal">
                  <button className="rounded-[2px] border-2 border-slate-900 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 transition-colors hover:bg-slate-100">
                    Sign in
                  </button>
                </SignInButton>
              }
            >
              <UserButton />
            </Show>
          </div>
        </div>
      </header>

      {/* Three-column body */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* Col 1 — Agent activity sidebar (192px) — desktop only */}
        <div className="hidden lg:flex w-48 shrink-0 border-r-2 border-slate-900 flex-col bg-white">
          {/* Mode switcher */}
          <div className="p-3 border-b border-slate-200">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Mode</p>
            {(["voter", "journalist"] as AppMode[]).map((m) => (
              <button
                key={m}
                onClick={() => handleModeChange(m)}
                className={[
                  "block w-full text-left rounded-[2px] border-2 px-2.5 py-1.5 text-xs font-semibold mb-1 transition-colors",
                  agentState.mode === m
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-400",
                ].join(" ")}
              >
                {m === "voter" ? "📋 Voter Brief" : "📰 Journalist"}
              </button>
            ))}
          </div>

          {/* Journalist research threads — signed-in, journalist mode */}
          {isJournalist && (
            <Show when="signed-in">
              <ThreadsPanel
                threads={threads}
                active={activeThread}
                onNew={createThread}
                onOpen={openThread}
                onClose={() => { setActiveThread(null); setThreadId("voter-global"); }}
                onRename={renameThread}
                onSaveNotes={saveThreadNotes}
                onDelete={deleteThread}
                onReopenBrief={openSavedBrief}
              />
            </Show>
          )}

          {/* My Ballot — saved briefs, signed-in + voter mode */}
          <Show when="signed-in">
            {!isJournalist && savedItems.length > 0 && (
              <div className="p-3 border-b border-slate-200">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                  My Ballot
                </p>
                <ul className="space-y-1">
                  {savedItems.map((item) => (
                    <li key={item.raceKey}>
                      <button
                        onClick={() => item.briefId && openSavedBrief(item.briefId)}
                        disabled={!item.briefId}
                        className={[
                          "block w-full text-left rounded-[2px] border px-2 py-1.5 transition-colors",
                          openedBrief?.state.currentRaceKey === item.raceKey
                            ? "border-slate-900 bg-slate-100"
                            : "border-slate-200 bg-white hover:border-slate-400",
                        ].join(" ")}
                      >
                        <span className="block text-xs font-semibold text-slate-900 truncate">
                          {item.label}
                        </span>
                        <span className="block text-[9px] text-slate-400">
                          saved {new Date(item.savedAt).toLocaleDateString()}
                        </span>
                        {item.changes.length > 0 && (
                          <span className="mt-1 block border-t border-amber-200 pt-1">
                            {item.changes.map((c) => (
                              <span key={c} className="block text-[9px] font-medium text-amber-700">
                                ● {c}
                              </span>
                            ))}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Show>

          {/* Brief progress */}
          <div className="p-3 flex-1 overflow-y-auto">
            {steps.length > 0 ? (
              <>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Brief progress</p>
                  <span className="text-[10px] font-medium text-green-600">● MongoDB</span>
                </div>
                <ReceiptProgress
                  steps={steps}
                  briefStartedAt={agentState.briefStartedAt}
                  statusMessage={agentState.status_message}
                  compact
                />
              </>
            ) : (
              <>
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Brief progress</p>
                <p className="text-[10px] text-slate-400">Enter an address to begin</p>
              </>
            )}
          </div>

          {/* Active race + share brief */}
          {agentState.currentRaceKey && (
            <div className="p-3 border-t border-slate-200 space-y-2">
              <div>
                <p className="text-[9px] uppercase tracking-widest text-slate-400">Active race</p>
                <p className="text-xs font-bold text-slate-900 truncate">{agentState.currentRaceKey}</p>
                <p className="text-[10px] text-slate-400 capitalize">
                  {isComplete ? "complete" : "running…"}
                </p>
              </div>
              {isComplete && (
                <button
                  onClick={handleShareBrief}
                  className="w-full rounded-[2px] border-2 border-slate-900 bg-slate-900 px-2 py-1.5 text-[10px] font-semibold text-white transition-colors hover:bg-slate-700"
                >
                  Share brief
                </button>
              )}
              {isComplete && (
                <Show
                  when="signed-in"
                  fallback={
                    <SignInButton mode="modal">
                      <button className="w-full rounded-[2px] border-2 border-slate-900 bg-white px-2 py-1.5 text-[10px] font-semibold text-slate-900 transition-colors hover:bg-slate-100">
                        Sign in to save
                      </button>
                    </SignInButton>
                  }
                >
                  <button
                    onClick={() =>
                      saveBrief(
                        displayed?.state ?? agentState,
                        isJournalist && activeThread ? activeThread.thread.thread_id : undefined,
                      )
                    }
                    disabled={saveStatus === "saving" || saveStatus === "saved"}
                    className="w-full rounded-[2px] border-2 border-slate-900 bg-white px-2 py-1.5 text-[10px] font-semibold text-slate-900 transition-colors hover:bg-slate-100 disabled:opacity-60"
                  >
                    {saveStatus === "saving"
                      ? "Saving…"
                      : saveStatus === "saved"
                        ? isJournalist && activeThread
                          ? "Saved to thread ✓"
                          : "Saved to ballot ✓"
                        : saveStatus === "error"
                          ? "Save failed — retry"
                          : isJournalist && activeThread
                            ? `Save to “${activeThread.thread.title}”`
                            : "Save to my ballot"}
                  </button>
                </Show>
              )}
            </div>
          )}
        </div>

        {/* Col 2 — Center canvas (flex-1) */}
        <div className="flex flex-1 flex-col overflow-hidden min-h-0">
          {/* Mobile-only slim progress strip (sidebar is hidden below lg) */}
          {steps.length > 0 && (
            <div className="lg:hidden shrink-0 border-b-2 border-slate-900 bg-white px-3 py-2">
              <ReceiptProgress
                steps={steps}
                briefStartedAt={agentState.briefStartedAt}
                statusMessage={agentState.status_message}
                horizontal
              />
            </div>
          )}
          {isJournalist ? (
            showJournalistRace ? (
              <RaceCanvas state={displayed!.state} />
            ) : (
              <div className="flex flex-1 flex-col overflow-y-auto min-h-0">
                <div className="p-4 shrink-0">
                  <USMap
                    focusedState={agentState.mapFocus}
                    onStateClick={handleStateClick}
                    mode={agentState.mode}
                    heatmapData={agentState.stateRaces}
                  />
                  {agentState.mapFocus && (
                    <p className="mt-3 text-sm text-slate-600">
                      <span className="font-semibold">{agentState.mapFocus}</span> selected &mdash; loading races…
                    </p>
                  )}
                </div>
                {agentState.stateRaces.length > 0 ? (
                  <RaceTable races={agentState.stateRaces} onRaceClick={handleRaceTableClick} />
                ) : (
                  <p className="px-4 text-sm text-slate-400">Click a state on the map to explore its 2026 races.</p>
                )}
              </div>
            )
          ) : showVoterBrief ? (
            <RaceCanvas state={displayed!.state} />
          ) : (
            <CanvasEmptyState onSubmit={handleAddressSubmit} />
          )}
        </div>

        {/* Col 3 — Chat sidebar (320px) — desktop only */}
        <div className="hidden lg:flex w-80 shrink-0 border-l-2 border-slate-900 flex-col">
          <CopilotChat instructions={SYSTEM_PROMPT} labels={CHAT_LABELS} className="h-full" />
        </div>

      </div>

      {/* Mobile chat: floating trigger + slide-up bottom sheet (below lg) */}
      <button
        onClick={() => setChatOpen(true)}
        className="lg:hidden fixed bottom-4 right-4 z-30 rounded-full border-2 border-slate-900 bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-lg"
      >
        Ask
      </button>

      {chatOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setChatOpen(false)}
            aria-hidden
          />
          <div className="relative flex h-[80vh] flex-col rounded-t-xl border-t-2 border-slate-900 bg-white">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
              <span className="text-sm font-bold text-slate-900">DistrictLens</span>
              <button
                onClick={() => setChatOpen(false)}
                aria-label="Close chat"
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <CopilotChat instructions={SYSTEM_PROMPT} labels={CHAT_LABELS} className="h-full" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
