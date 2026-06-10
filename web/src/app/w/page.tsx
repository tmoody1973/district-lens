"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CopilotChat } from "@copilotkit/react-ui";
import { Show, useUser } from "@clerk/nextjs";
import { AgentToolTrace } from "@/components/canvas/AgentToolTrace";
import { ArtifactPanel } from "@/components/workspace/ArtifactPanel";
import { ArtifactListPanel } from "@/components/workspace/ArtifactListPanel";
import { ExploreSurface } from "@/components/workspace/ExploreSurface";
import { ThreadSection } from "@/components/workspace/ThreadSection";
import { ArtifactProvider, useArtifacts } from "@/components/workspace/ArtifactProvider";
import { ChatPane } from "@/components/workspace/ChatPane";
import { DeadLinkState } from "@/components/workspace/DeadLinkState";
import { LibrarySidebar } from "@/components/workspace/LibrarySidebar";
import { MyBallotSection } from "@/components/workspace/MyBallotSection";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { WorkspaceLayoutProvider } from "@/components/workspace/WorkspaceLayoutContext";
import { CHAT_LABELS, SYSTEM_PROMPT } from "@/lib/workspace/chat-config";
import {
  applyFocusIntent,
  derivePanelView,
  shouldAutoFocus,
  type FocusIntent,
} from "@/lib/workspace/derivePanelView";
import { useAutoSnapshot } from "@/lib/workspace/useAutoSnapshot";
import { useBuildStart } from "@/lib/workspace/useBuildStart";
import { useMyBallot } from "@/lib/workspace/useMyBallot";
import { useWorkspaceAgent } from "@/lib/workspace/useWorkspaceAgent";
import { useThreads } from "@/lib/workspace/useThreads";
import { deriveLabel } from "@/lib/saved-briefs/schema";
import { saveBriefSnapshot } from "@/lib/artifacts/sync";
import { fmtDate } from "@/lib/format";
import type { DistrictLensState } from "@/types/agent-state";

function WorkspaceInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { isSignedIn } = useUser();

  // beginNewBriefRef holds the panel-clear callback. Declared before the
  // agent hook so we can pass onRunStart; assigned after useArtifacts is
  // available (ordering constraint: closeArtifact defined after agent hook).
  const beginNewBriefRef = useRef<() => void>(() => {});
  // Polite auto-focus (D2/C4): set on any manual focus/navigation, re-armed
  // at every run start. While true, a completing build must not steal the panel.
  const userNavigatedRef = useRef(false);

  const {
    agent,
    agentState,
    isAgentReady,
    submitAddress,
    exploreState,
    openRace,
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

  // Reopened-saved-brief focus slot (Mongo snapshots restored via threads/ballot).
  const [reopenedSaved, setReopenedSaved] = useState<DistrictLensState | null>(null);

  // One focus concept (C3): every focus change goes through the pure intent
  // helper, so a focused saved brief and a focused local artifact can never coexist.
  const enactFocus = useCallback(
    (intent: FocusIntent<DistrictLensState>) => {
      const slots = applyFocusIntent(intent);
      setReopenedSaved(slots.savedBrief);
      if (slots.localArtifactId) openArtifact(slots.localArtifactId);
      else closeArtifact();
    },
    [openArtifact, closeArtifact],
  );

  // Assign the callback now that closeArtifact is available.
  beginNewBriefRef.current = () => {
    setReopenedSaved(null);
    closeArtifact();
    userNavigatedRef.current = false; // new run → polite auto-focus re-armed
  };

  // DRAFT source of truth (C2): the coagent stage transition covers typed-chat
  // builds that never call onRunStart; onRunStart stays as an immediate-clear
  // nicety for programmatic runs.
  useBuildStart(agentState.stage, () => beginNewBriefRef.current());

  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const kickedOff = useRef(false);

  // Landing handoff: /w?addr=… starts a brief; /w?state=XX explores that
  // state's races (stage stays idle — the list + race table update in place).
  // Waits for the CopilotKit runtime to signal Connected before submitting —
  // the runtime must be established or the agent run is silently dropped with
  // "Running an agent requires either a new_message or an invocation_id" at
  // the backend. kickedOff prevents double-fire on re-renders once
  // isAgentReady flips.
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
      exploreState(stateCode);
    }
  }, [isAgentReady, agentState.stage, params, submitAddress, exploreState]);

  const { savedItems, loadBallot } = useMyBallot(isSignedIn, store);

  const threadsApi = useThreads({
    agentState,
    agent,
    isSignedIn,
    onRestoreBrief: (state) => enactFocus({ kind: "saved", state }),
    onClearBrief: () => {
      enactFocus({ kind: "clear" });
      clearBrief(); // resets snapshot + coagent state
    },
    onBallotChanged: loadBallot,
  });

  // Auto-snapshot completed drafts into the library, then mark "Saved ✓" and
  // auto-focus the new artifact unless the user navigated mid-run (D2/C4).
  // Signed-in users also mirror the snapshot to Mongo so My Ballot stays the
  // cross-device source of truth — skipped when a thread is open: useThreads'
  // auto-capture already posts that brief with its threadId.
  const [justSaved, setJustSaved] = useState(false);
  useAutoSnapshot(agentState, (state) => {
    const record = recordSnapshot(state);
    if (record) setJustSaved(true);
    if (
      record &&
      shouldAutoFocus({
        snapshotRecorded: true,
        userNavigatedSinceRunStart: userNavigatedRef.current,
      })
    ) {
      enactFocus({ kind: "local", artifactId: record.artifactId });
    }
    // Known narrow race: if a thread opens in the same frame a build completes,
    // both this mirror and useThreads' auto-capture may POST. /api/saved/brief
    // appends a new snapshot doc each time (append-only by design) but upserts
    // the one-per-race saved_districts bookmark, so My Ballot never duplicates.
    if (isSignedIn && !threadsApi.activeThread) {
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
    if (requestedArtifactId) enactFocus({ kind: "local", artifactId: requestedArtifactId });
  }, [requestedArtifactId, enactFocus]);
  const deadLink = Boolean(
    requestedArtifactId && !library.some((r) => r.artifactId === requestedArtifactId),
  );

  // Manual focus paths — mark navigation so a completing build stays polite.
  const openListItem = useCallback(
    (id: string) => {
      userNavigatedRef.current = true;
      if (threadsApi.activeThread) threadsApi.openSavedBrief(id);
      else enactFocus({ kind: "local", artifactId: id });
    },
    [threadsApi, enactFocus],
  );
  const openBallotBrief = useCallback(
    (briefId: string) => {
      userNavigatedRef.current = true;
      threadsApi.openSavedBrief(briefId);
    },
    [threadsApi],
  );
  const backToList = useCallback(() => {
    userNavigatedRef.current = true;
    enactFocus({ kind: "clear" });
    // Drop the deep link so it doesn't immediately re-focus what we just closed.
    if (params.get("a")) router.replace("/w");
  }, [enactFocus, params, router]);

  // Panel state machine (U2): focused > draft > list. The live coagent brief
  // renders ONLY during DRAFT — at rest the panel is the artifact list, which
  // makes a stale live brief structurally unable to squat in the panel (D1).
  const { view, showBuildPill } = derivePanelView({
    hasFocusedSavedBrief: reopenedSaved != null,
    hasFocusedLocalArtifact: active != null,
    stage: agentState.stage,
  });
  const activeSnapshot = active
    ? active.versions[activeVersionIndex]?.snapshot ?? null
    : null;
  const panelState =
    view === "focused"
      ? reopenedSaved ?? activeSnapshot
      : view === "draft"
        ? agentState
        : null;
  const title = active
    ? active.name
    : panelState?.currentRaceKey
      ? deriveLabel(panelState.currentRaceKey)
      : null;

  // Rest state: the artifact LIST — active thread's briefs, else the local
  // library — with the explore surface always beneath (U1/U2).
  const listItems = threadsApi.activeThread
    ? threadsApi.activeThread.briefs.map((b) => ({
        id: b.brief_id,
        name: deriveLabel(b.race_key),
        savedAt: b.created_at,
      }))
    : library.map((r) => ({
        id: r.artifactId,
        name: r.name,
        savedAt: r.updatedAt,
      }));

  const restState = deadLink ? (
    <DeadLinkState onReset={() => router.replace("/w")} />
  ) : (
    <ArtifactListPanel items={listItems} onOpen={openListItem}>
      <ExploreSurface
        onSubmitAddress={submitAddress}
        onStateClick={exploreState}
        onRaceClick={openRace}
        mapFocus={agentState.mapFocus}
        stateRaces={agentState.stateRaces}
      />
    </ArtifactListPanel>
  );

  return (
    <>
      {/* Renders agent tool calls (incl. MongoDB MCP) inline in the chat */}
      <AgentToolTrace />
      <WorkspaceShell
        library={
          <LibrarySidebar>
            {/* One workspace (U1): My Ballot + Threads for the signed-in. */}
            <Show when="signed-in">
              {savedItems.length > 0 && (
                <MyBallotSection items={savedItems} onOpen={openBallotBrief} />
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
            </Show>
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
            isDrafting={showBuildPill}
            emptyState={restState}
            onBack={view === "focused" ? backToList : undefined}
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
  return (
    <WorkspaceLayoutProvider>
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
