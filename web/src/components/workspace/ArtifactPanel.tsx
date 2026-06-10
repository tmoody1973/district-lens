"use client";

import type { ReactNode } from "react";
import { RaceCanvas } from "@/components/canvas/RaceCanvas";
import { ReceiptProgress } from "@/components/canvas/ReceiptProgress";
import { isDraftingStage } from "@/lib/workspace/derivePanelView";
import { annotateSteps, stepsFromStage } from "@/lib/steps";
import type { DistrictLensState } from "@/types/agent-state";

// Builds normally complete in 1-4 min even on cold races; past this the SSE
// stream is dead and the receipt would otherwise spin forever.
const STALE_DRAFT_MS = 10 * 60_000;

interface ArtifactPanelProps {
  /** Brief being displayed — live draft or reopened snapshot. Null = nothing open. */
  state: DistrictLensState | null;
  title: string | null;
  /** A build is running somewhere — shows the slim header pill (D2/C4). */
  isDrafting: boolean;
  /** What to show when no artifact is open (the artifact list + explore surface). */
  emptyState: ReactNode;
  /** Extra header actions (history ▾, share — arrive in later phases). */
  headerActions?: ReactNode;
  /** Back to the artifact list — rendered when a focused artifact can be dismissed. */
  onBack?: () => void;
}

export function ArtifactPanel({
  state,
  title,
  isDrafting,
  emptyState,
  headerActions,
  onBack,
}: ArtifactPanelProps) {
  // The receipt strip annotates LIVE build steps — it renders only when the
  // displayed state is itself mid-draft, never over a focused snapshot whose
  // stage is already "complete" (the pill alone signals the background build).
  // A draft whose stream died (no completion after 10 min) reads as stale —
  // hide the building chrome instead of spinning forever.
  const staleDraft =
    state?.briefStartedAt != null && Date.now() - state.briefStartedAt > STALE_DRAFT_MS;
  const drafting = isDrafting && !staleDraft;
  const draftState = drafting && state && isDraftingStage(state.stage) ? state : null;
  const steps = draftState ? annotateSteps(stepsFromStage(draftState.stage), draftState) : [];
  const hasBrief = Boolean(state?.currentRaceKey);

  return (
    <section aria-label="Artifact" className="flex h-full min-w-0 flex-col bg-zinc-900">
      <header className="shrink-0 border-b border-zinc-800 px-4 py-2.5">
        <div className="flex items-center gap-2">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <span aria-hidden>←</span> Artifacts
            </button>
          ) : (
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" aria-hidden />
          )}
          <span className="truncate text-sm font-medium text-zinc-200">
            {title ?? "No artifact open"}
          </span>
          {drafting && (
            <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
              building…
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">{headerActions}</span>
        </div>
        {draftState && steps.length > 0 && (
          // Receipt strip across the artifact top while drafting (spec §Artifact state).
          <div className="mt-2 rounded-md bg-surface-raised px-3 py-2">
            <ReceiptProgress
              steps={steps}
              briefStartedAt={draftState.briefStartedAt}
              statusMessage={draftState.status_message}
              horizontal
            />
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {hasBrief && state ? (
          <div className="min-h-full">
            <RaceCanvas state={state} />
          </div>
        ) : (
          emptyState
        )}
      </div>
    </section>
  );
}
