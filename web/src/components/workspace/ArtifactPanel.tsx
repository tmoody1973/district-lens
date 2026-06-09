"use client";

import type { ReactNode } from "react";
import { RaceCanvas } from "@/components/canvas/RaceCanvas";
import { ReceiptProgress } from "@/components/canvas/ReceiptProgress";
import { annotateSteps, stepsFromStage } from "@/lib/steps";
import type { DistrictLensState } from "@/types/agent-state";

interface ArtifactPanelProps {
  /** Brief being displayed — live draft or reopened snapshot. Null = nothing open. */
  state: DistrictLensState | null;
  title: string | null;
  isDrafting: boolean;
  /** What to show when no artifact is open (persona-specific, supplied by the page). */
  emptyState: ReactNode;
  /** Extra header actions (history ▾, share — arrive in later phases). */
  headerActions?: ReactNode;
}

export function ArtifactPanel({ state, title, isDrafting, emptyState, headerActions }: ArtifactPanelProps) {
  const steps = state ? annotateSteps(stepsFromStage(state.stage), state) : [];
  const hasBrief = Boolean(state?.currentRaceKey);

  return (
    <section aria-label="Artifact" className="flex h-full min-w-0 flex-col bg-zinc-900">
      <header className="shrink-0 border-b border-zinc-800 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" aria-hidden />
          <span className="truncate text-sm font-medium text-zinc-200">
            {title ?? "No artifact open"}
          </span>
          {isDrafting && (
            <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
              building…
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">{headerActions}</span>
        </div>
        {isDrafting && steps.length > 0 && state && (
          // Receipt strip across the artifact top while drafting (spec §Artifact state).
          // ReceiptProgress is still light-styled — white plate is the Phase-1 waypoint.
          <div className="mt-2 rounded-md bg-white px-3 py-2">
            <ReceiptProgress
              steps={steps}
              briefStartedAt={state.briefStartedAt}
              statusMessage={state.status_message}
              horizontal
            />
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {hasBrief && state ? (
          // "Paper on dark desk": RaceCanvas stays light until the dark token pass.
          <div className="min-h-full bg-white">
            <RaceCanvas state={state} />
          </div>
        ) : (
          emptyState
        )}
      </div>
    </section>
  );
}
