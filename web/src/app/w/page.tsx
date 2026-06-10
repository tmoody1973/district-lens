"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CopilotChat } from "@copilotkit/react-ui";
import { Show, useUser } from "@clerk/nextjs";
import { AgentToolTrace } from "@/components/canvas/AgentToolTrace";
import { CanvasEmptyState } from "@/components/canvas/CanvasEmptyState";
import { RaceTable } from "@/components/canvas/RaceTable";
import { USMap } from "@/components/map/USMap";
import { ArtifactPanel } from "@/components/workspace/ArtifactPanel";
import { ArtifactSwitcher } from "@/components/workspace/ArtifactSwitcher";
import { ThreadSection } from "@/components/workspace/ThreadSection";
import { ArtifactProvider, useArtifacts } from "@/components/workspace/ArtifactProvider";
import { ChatPane } from "@/components/workspace/ChatPane";
import { DeadLinkState } from "@/components/workspace/DeadLinkState";
import { LibrarySections } from "@/components/workspace/LibrarySections";
import { LibrarySidebar } from "@/components/workspace/LibrarySidebar";
import { MyBallotSection } from "@/components/workspace/MyBallotSection";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import {
  WorkspaceLayoutProvider,
  useWorkspaceLayout,
} from "@/components/workspace/WorkspaceLayoutContext";
import { CHAT_LABELS, SYSTEM_PROMPT } from "@/lib/workspace/chat-config";
import { useAutoSnapshot } from "@/lib/workspace/useAutoSnapshot";
import { useMyBallot } from "@/lib/workspace/useMyBallot";
import { useWorkspaceAgent } from "@/lib/workspace/useWorkspaceAgent";
import { useThreads } from "@/lib/workspace/useThreads";
import { deriveLabel } from "@/lib/saved-briefs/schema";
import { saveBriefSnapshot } from "@/lib/artifacts/sync";
import { fmtDate } from "@/lib/format";
import type { Persona } from "@/lib/workspace/layout";
import type { DistrictLensState } from "@/types/agent-state";

function WorkspaceInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { layout, setPersona } = useWorkspaceLayout();
  const { isSignedIn } = useUser();

  // beginNewBriefRef holds the panel-clear callback. Declared before the
  // agent hook so we can pass onRunStart; assigned after useArtifacts is
  // available (ordering constraint: closeArtifact defined after agent hook).
  const beginNewBriefRef = useRef<() => void>(() => {});

  const {
    agent,
    agentState,
    displayed,
    isAgentReady,
    submitAddress,
    exploreState,
    openRace,
    setMode,
    clearBrief,
  } = useWorkspaceAgent({ onRunStart: () => beginNewBriefRef.current() });

  const {
    library,
    active,
    activeVersionIndex,
    openArtifact,
    closeArtifact,
    selectVersion,
    recordSnapshot,
    store,
  } = useArtifacts();

  // Reopened-saved-brief display slot (mirrors old `openedBrief`).
  const [reopenedSaved, setReopenedSaved] = useState<DistrictLensState | null>(null);

  // Assign the callback now that closeArtifact is available.
  beginNewBriefRef.current = () => { setReopenedSaved(null); closeArtifact(); };

  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const kickedOff = useRef(false);

  // On reload the coagent mode resets to "voter" while the persisted layout
  // persona may say "journalist" — the chip looks selected but the Threads
  // section and map view vanish. Sync mode from the persona once the coagent
  // state has hydrated.
  const personaSyncedRef = useRef(false);
  useEffect(() => {
    if (personaSyncedRef.current || agentState.stage == null) return;
    personaSyncedRef.current = true;
    if (layout.persona !== agentState.mode) setMode(layout.persona);
  }, [agentState.stage, agentState.mode, layout.persona, setMode]);

  const isJournalist = agentState.mode === "journalist";
  const showBrief = displayed
    ? isJournalist
      ? displayed.mode === "journalist"
      : displayed.mode === "voter"
    : false;
  const briefState = showBrief && displayed ? displayed.state : null;
  const isDrafting = agentState.stage !== "idle" && agentState.stage !== "complete";

  // Landing handoff: /w?addr=… starts a voter brief; /w?state=XX opens the
  // journalist state view. Waits for the CopilotKit runtime to signal Connected
  // before submitting — the runtime must be established or the agent run is
  // silently dropped with "Running an agent requires either a new_message or an
  // invocation_id" at the backend. kickedOff prevents double-fire on re-renders
  // once isAgentReady flips.
  useEffect(() => {
    if (!isAgentReady) return;
    // useCoAgent's state hydrates (and its connect cycle settles) slightly
    // after agent registration; running before that point gets the kickoff
    // message wiped by the connect sync. stage is undefined until hydration.
    if (agentState.stage == null) return;
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
  }, [isAgentReady, agentState.stage, params, submitAddress, exploreState, setMode, setPersona]);

  const { savedItems, loadBallot } = useMyBallot(isSignedIn, store);

  const threadsApi = useThreads({
    agentState,
    agent,
    isSignedIn,
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
    // Known narrow race: if a thread opens in the same frame a build completes,
    // both this mirror and useThreads' auto-capture may POST. /api/saved/brief
    // appends a new snapshot doc each time (append-only by design) but upserts
    // the one-per-race saved_districts bookmark, so My Ballot never duplicates.
    if (isSignedIn && !(isJournalist && threadsApi.activeThread)) {
      saveBriefSnapshot(state).then((ok) => { if (ok) loadBallot(); });
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

  // Display priority — a reopened saved brief (Mongo) wins over a local artifact,
  // which wins over the live brief.
  const reopenedState = active ? active.versions[activeVersionIndex]?.snapshot ?? null : null;
  const panelState = reopenedSaved ?? reopenedState ?? briefState ?? (isDrafting ? agentState : null);
  const title = active
    ? active.name
    : panelState?.currentRaceKey
      ? deriveLabel(panelState.currentRaceKey)
      : null;

  // Deep-Cuts switcher source: the active thread's artifacts, else recent
  // local-library artifacts (spec addendum A3).
  const switcherItems = threadsApi.activeThread
    ? threadsApi.activeThread.briefs.map((b) => ({
        id: b.brief_id,
        name: deriveLabel(b.race_key),
        savedAt: b.created_at,
      }))
    : library.slice(0, 5).map((r) => ({
        id: r.artifactId,
        name: r.name,
        savedAt: r.updatedAt,
      }));

  const deadLinkState = deadLink ? (
    <DeadLinkState onReset={() => router.replace("/w")} />
  ) : null;

  const emptyState = isJournalist ? (
    <div className="flex h-full flex-col overflow-y-auto">
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
        <p className="px-4 text-sm text-ink-faint">
          Click a state on the map to explore its 2026 races.
        </p>
      )}
    </div>
  ) : (
    <div className="h-full">
      <CanvasEmptyState onSubmit={submitAddress} />
    </div>
  );

  return (
    <>
      {/* Renders agent tool calls (incl. MongoDB MCP) inline in the chat */}
      <AgentToolTrace />
      <WorkspaceShell
        library={
          <LibrarySidebar onPersonaChange={setMode}>
            {/* Threads are session containers for BOTH personas (signed-in).
                Persona decides section ORDER only: voter leads with My Ballot,
                journalist leads with Threads (spec addendum A1/A6). */}
            <Show when="signed-in">
              {!isJournalist && savedItems.length > 0 && (
                <MyBallotSection items={savedItems} onOpen={threadsApi.openSavedBrief} />
              )}
              <ThreadSection
                threads={threadsApi.threads}
                activeThreadId={threadsApi.activeThread?.thread.thread_id ?? null}
                notes={threadsApi.activeThread?.thread.notes ?? ""}
                onNew={threadsApi.createThread}
                onOpen={threadsApi.openThread}
                onRename={threadsApi.renameThread}
                onDelete={threadsApi.deleteThread}
                onSaveNotes={threadsApi.saveThreadNotes}
              />
              {isJournalist && savedItems.length > 0 && (
                <MyBallotSection items={savedItems} onOpen={threadsApi.openSavedBrief} />
              )}
            </Show>
            <LibrarySections />
          </LibrarySidebar>
        }
        chat={
          <ChatPane
            statusMessage={agentState.status_message}
            contextLabel={threadsApi.activeThread?.thread.title ?? null}
          />
        }
        artifact={
          <ArtifactPanel
            state={panelState}
            title={title}
            titleSlot={
              <ArtifactSwitcher
                title={title ?? "No artifact open"}
                items={switcherItems}
                onSelect={
                  threadsApi.activeThread ? threadsApi.openSavedBrief : openArtifact
                }
              />
            }
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
                        {fmtDate(v.savedAt)}{" "}
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
            <div className="dark min-h-0 flex-1">
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
