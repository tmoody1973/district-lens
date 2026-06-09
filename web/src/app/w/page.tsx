"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CopilotChat } from "@copilotkit/react-ui";
import { AgentToolTrace } from "@/components/canvas/AgentToolTrace";
import { CanvasEmptyState } from "@/components/canvas/CanvasEmptyState";
import { RaceTable } from "@/components/canvas/RaceTable";
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
import { deriveLabel } from "@/lib/saved-briefs/schema";
import type { Persona } from "@/lib/workspace/layout";

function WorkspaceInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { setPersona } = useWorkspaceLayout();
  const { agentState, displayed, submitAddress, exploreState, openRace, setMode } =
    useWorkspaceAgent();
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

  // Auto-snapshot completed drafts into the library, then mark "Saved ✓".
  // (A later task REPLACES this callback with a version that adds the
  // signed-in Mongo mirror write — do not end up with two useAutoSnapshot calls.)
  const [justSaved, setJustSaved] = useState(false);
  useAutoSnapshot(agentState, (state) => {
    const record = recordSnapshot(state);
    if (record) {
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 4000);
    }
  });

  // Deep link: /w?a=<artifactId>. Unknown id → "not in your library" (spec §Error handling).
  const requestedArtifactId = params.get("a");
  useEffect(() => {
    if (requestedArtifactId) openArtifact(requestedArtifactId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedArtifactId]);
  const deadLink = Boolean(
    requestedArtifactId && !library.some((r) => r.artifactId === requestedArtifactId),
  );

  const handlePersonaChange = (persona: Persona) => setMode(persona);

  const isJournalist = agentState.mode === "journalist";
  const showBrief = displayed
    ? isJournalist
      ? displayed.mode === "journalist"
      : displayed.mode === "voter"
    : false;
  const briefState = showBrief && displayed ? displayed.state : null;
  const isDrafting = agentState.stage !== "idle" && agentState.stage !== "complete";

  // Display priority — a reopened artifact wins over the live brief.
  const reopenedState = active ? active.versions[activeVersionIndex]?.snapshot ?? null : null;
  const panelState = reopenedState ?? briefState ?? (isDrafting ? agentState : null);
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
            <LibrarySections />
          </LibrarySidebar>
        }
        chat={<ChatPane statusMessage={agentState.status_message} />}
        artifact={
          <ArtifactPanel
            state={panelState}
            title={title}
            isDrafting={isDrafting && !reopenedState}
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
