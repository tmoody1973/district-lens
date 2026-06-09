"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CopilotChat } from "@copilotkit/react-ui";
import { Show, useUser } from "@clerk/nextjs";
import { AgentToolTrace } from "@/components/canvas/AgentToolTrace";
import { CanvasEmptyState } from "@/components/canvas/CanvasEmptyState";
import { RaceTable } from "@/components/canvas/RaceTable";
import { ThreadsPanel } from "@/components/canvas/ThreadsPanel";
import { USMap } from "@/components/map/USMap";
import { ArtifactPanel } from "@/components/workspace/ArtifactPanel";
import { ArtifactProvider, useArtifacts } from "@/components/workspace/ArtifactProvider";
import { ChatPane } from "@/components/workspace/ChatPane";
import { LibrarySections } from "@/components/workspace/LibrarySections";
import { LibrarySidebar } from "@/components/workspace/LibrarySidebar";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import {
  WorkspaceLayoutProvider,
  useWorkspaceLayout,
} from "@/components/workspace/WorkspaceLayoutContext";
import { CHAT_LABELS, SYSTEM_PROMPT } from "@/lib/workspace/chat-config";
import { useAutoSnapshot } from "@/lib/workspace/useAutoSnapshot";
import { useWorkspaceAgent } from "@/lib/workspace/useWorkspaceAgent";
import { useThreads } from "@/lib/workspace/useThreads";
import { deriveLabel } from "@/lib/saved-briefs/schema";
import type { SavedBallotItem } from "@/lib/saved-briefs/schema";
import type { Persona } from "@/lib/workspace/layout";
import type { DistrictLensState } from "@/types/agent-state";

function WorkspaceInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { setPersona } = useWorkspaceLayout();
  const { isSignedIn } = useUser();
  const {
    agentState,
    displayed,
    submitAddress,
    exploreState,
    openRace,
    setMode,
    clearBrief,
  } = useWorkspaceAgent();
  const {
    library,
    active,
    activeVersionIndex,
    openArtifact,
    closeArtifact,
    selectVersion,
    recordSnapshot,
  } = useArtifacts();
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const kickedOff = useRef(false);

  // Landing handoff: /w?addr=… starts a voter brief; /w?state=XX opens the
  // journalist state view. Runs once.
  useEffect(() => {
    if (kickedOff.current) return;
    const addr = params.get("addr");
    const stateCode = params.get("state");
    if (addr) {
      kickedOff.current = true;
      submitAddress(addr);
    } else if (stateCode) {
      kickedOff.current = true;
      setPersona("journalist");
      setMode("journalist");
      exploreState(stateCode);
    }
  }, [params, submitAddress, exploreState, setMode, setPersona]);

  const isJournalist = agentState.mode === "journalist";
  const showBrief = displayed
    ? isJournalist
      ? displayed.mode === "journalist"
      : displayed.mode === "voter"
    : false;
  const briefState = showBrief && displayed ? displayed.state : null;
  const isDrafting = agentState.stage !== "idle" && agentState.stage !== "complete";

  // Reopened-saved-brief display slot (mirrors old `openedBrief`).
  const [reopenedSaved, setReopenedSaved] = useState<DistrictLensState | null>(null);

  // My Ballot (signed-in voters) — refresh after auto-capture or save.
  const [savedItems, setSavedItems] = useState<SavedBallotItem[]>([]);
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

  const threadsApi = useThreads({
    agentState,
    onRestoreBrief: (state) => setReopenedSaved(state),
    onClearBrief: () => {
      setReopenedSaved(null);
      clearBrief(); // resets snapshot + coagent state, keeps persona
    },
    onBallotChanged: loadBallot,
  });

  // Auto-snapshot completed drafts into the library, then mark "Saved ✓".
  // Signed-in users also mirror the snapshot to Mongo so My Ballot stays the
  // cross-device source of truth (spec §Data flow: "library write — localStorage
  // anon, Mongo signed in"). Skip when a journalist thread is open: useThreads'
  // auto-capture already posts that brief with its threadId.
  const [justSaved, setJustSaved] = useState(false);
  useAutoSnapshot(agentState, (state) => {
    const record = recordSnapshot(state);
    if (record) setJustSaved(true);
    if (isSignedIn && !(isJournalist && threadsApi.activeThread)) {
      fetch("/api/saved/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      })
        .then((res) => { if (res.ok) loadBallot(); })
        .catch(() => {});
    }
  });
  useEffect(() => {
    if (!justSaved) return;
    const id = setTimeout(() => setJustSaved(false), 4000);
    return () => clearTimeout(id);
  }, [justSaved]);

  // Deep link: /w?a=<artifactId>. Unknown id → "not in your library" (spec §Error handling).
  const requestedArtifactId = params.get("a");
  useEffect(() => {
    if (requestedArtifactId) openArtifact(requestedArtifactId);
  }, [requestedArtifactId, openArtifact]);
  const deadLink = Boolean(
    requestedArtifactId && !library.some((r) => r.artifactId === requestedArtifactId),
  );

  const handlePersonaChange = (persona: Persona) => setMode(persona);

  // Display priority — a reopened saved brief (Mongo) wins over a local artifact,
  // which wins over the live brief.
  const reopenedState = active ? active.versions[activeVersionIndex]?.snapshot ?? null : null;
  const panelState = reopenedSaved ?? reopenedState ?? briefState ?? (isDrafting ? agentState : null);
  const title = active
    ? active.name
    : panelState?.currentRaceKey
      ? deriveLabel(panelState.currentRaceKey)
      : null;

  // Dead-link empty state, taking precedence over the persona empty states.
  const deadLinkState = deadLink ? (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-zinc-900 p-8 text-center">
      <p className="text-sm text-zinc-300">That artifact isn't in this browser's library.</p>
      <p className="text-xs text-zinc-500">
        Artifacts live on the device where they were built. Rebuild the brief to recreate it here.
      </p>
      <button
        type="button"
        onClick={() => router.replace("/w")}
        className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
      >
        Start fresh
      </button>
    </div>
  ) : null;

  const emptyState = isJournalist ? (
    <div className="flex h-full flex-col overflow-y-auto bg-white">
      <div className="shrink-0 p-4">
        <USMap
          focusedState={agentState.mapFocus}
          onStateClick={exploreState}
          mode={agentState.mode}
          heatmapData={agentState.stateRaces}
        />
      </div>
      {agentState.stateRaces.length > 0 ? (
        <RaceTable races={agentState.stateRaces} onRaceClick={openRace} />
      ) : (
        <p className="px-4 text-sm text-slate-400">
          Click a state on the map to explore its 2026 races.
        </p>
      )}
    </div>
  ) : (
    <div className="h-full bg-white">
      <CanvasEmptyState onSubmit={submitAddress} />
    </div>
  );

  return (
    <>
      {/* Renders agent tool calls (incl. MongoDB MCP) inline in the chat */}
      <AgentToolTrace />
      <WorkspaceShell
        library={
          <LibrarySidebar onPersonaChange={handlePersonaChange}>
            {isJournalist && (
              <Show when="signed-in">
                <ThreadsPanel
                  threads={threadsApi.threads}
                  active={threadsApi.activeThread}
                  onNew={threadsApi.createThread}
                  onOpen={threadsApi.openThread}
                  onClose={threadsApi.closeThread}
                  onRename={threadsApi.renameThread}
                  onSaveNotes={threadsApi.saveThreadNotes}
                  onDelete={threadsApi.deleteThread}
                  onReopenBrief={threadsApi.openSavedBrief}
                />
              </Show>
            )}
            {!isJournalist && savedItems.length > 0 && (
              <Show when="signed-in">
                <div className="px-3 py-2">
                  <p className="text-xs font-semibold uppercase text-zinc-500">My Ballot</p>
                  <ul className="mt-1 space-y-0.5">
                    {savedItems.map((item) => (
                      <li key={item.raceKey}>
                        <button
                          type="button"
                          onClick={() => item.briefId && threadsApi.openSavedBrief(item.briefId)}
                          disabled={!item.briefId}
                          className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
                        >
                          <span className="block truncate text-xs font-semibold">{item.label}</span>
                          <span className="block text-[10px] text-zinc-600">
                            saved {new Date(item.savedAt).toLocaleDateString()}
                          </span>
                          {item.changes.length > 0 &&
                            item.changes.map((c) => (
                              <span key={c} className="block text-[10px] font-medium text-amber-500">● {c}</span>
                            ))}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </Show>
            )}
            <LibrarySections />
          </LibrarySidebar>
        }
        chat={<ChatPane statusMessage={agentState.status_message} />}
        artifact={
          <ArtifactPanel
            state={panelState}
            title={title}
            isDrafting={isDrafting && !reopenedState && !reopenedSaved}
            emptyState={deadLinkState ?? emptyState}
            headerActions={
              <>
                {justSaved && (
                  <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-400">
                    Saved ✓
                  </span>
                )}
                {active && active.versions.length > 1 && (
                  <select
                    aria-label="Version history"
                    value={activeVersionIndex}
                    onChange={(e) => selectVersion(Number(e.target.value))}
                    className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-300"
                  >
                    {active.versions.map((v, i) => (
                      <option key={v.versionId} value={i}>
                        {new Date(v.savedAt).toLocaleDateString()}{" "}
                        {i === active.versions.length - 1 ? "(latest)" : ""}
                      </option>
                    ))}
                  </select>
                )}
                {active && (
                  <button
                    type="button"
                    onClick={closeArtifact}
                    aria-label="Close artifact"
                    className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
                  >
                    ✕
                  </button>
                )}
              </>
            }
          />
        }
      />

      {/* Mobile chat: floating trigger + bottom sheet (full mobile swap is a later phase) */}
      <button
        type="button"
        onClick={() => setMobileChatOpen(true)}
        className="fixed bottom-4 right-4 z-30 rounded-full border border-zinc-700 bg-zinc-800 px-5 py-3 text-sm font-semibold text-white shadow-lg lg:hidden"
      >
        Ask
      </button>
      {mobileChatOpen && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileChatOpen(false)}
            aria-hidden
          />
          <div className="relative flex h-[80vh] flex-col rounded-t-xl border-t border-zinc-700 bg-zinc-950">
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
              <span className="text-sm font-bold text-zinc-100">DistrictLens</span>
              <button
                type="button"
                onClick={() => setMobileChatOpen(false)}
                aria-label="Close chat"
                className="text-zinc-500 hover:text-zinc-200"
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
    </>
  );
}

function WorkspacePage() {
  const params = useSearchParams();
  const initialPersona: Persona = params.get("state") ? "journalist" : "voter";
  return (
    <WorkspaceLayoutProvider initialPersona={initialPersona}>
      <ArtifactProvider>
        <WorkspaceInner />
      </ArtifactProvider>
    </WorkspaceLayoutProvider>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <WorkspacePage />
    </Suspense>
  );
}
