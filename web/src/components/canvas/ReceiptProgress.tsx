"use client";
import { useEffect, useState } from "react";
import type { BriefStep, StepStatus } from "@/types/agent-state";

const ESTIMATED_TOTAL_MS = 70_000;

interface Props {
  steps: BriefStep[];
  briefStartedAt: number | null;
  statusMessage?: string | null;
  compact?: boolean;
  horizontal?: boolean;
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") return <span className="text-evidence-direct text-xs w-4 shrink-0">✓</span>;
  if (status === "running")
    return <span className="text-evidence-reported text-xs w-4 shrink-0 animate-spin">⟳</span>;
  return <span className="text-ink-faint text-xs w-4 shrink-0">○</span>;
}

export function ReceiptProgress({ steps, briefStartedAt, statusMessage, compact, horizontal }: Props) {
  const [secsLeft, setSecsLeft] = useState<number | null>(null);
  const isComplete = steps.length > 0 && steps.every((s) => s.status === "done");

  useEffect(() => {
    if (!briefStartedAt || isComplete) {
      return () => setSecsLeft(null);
    }
    const tick = () => {
      const elapsed = Date.now() - briefStartedAt;
      const remaining = Math.max(0, Math.ceil((ESTIMATED_TOTAL_MS - elapsed) / 1000));
      setSecsLeft(remaining);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      clearInterval(id);
      setSecsLeft(null);
    };
  }, [briefStartedAt, isComplete]);

  if (steps.length === 0) return null;

  // Slim single-line strip for the mobile shell: status + steps scroll horizontally
  // so nothing wraps or overflows at narrow widths.
  if (horizontal) {
    return (
      <div className="flex items-center gap-3 overflow-x-auto whitespace-nowrap">
        <span className="flex shrink-0 items-center gap-1.5">
          <span
            className={[
              "inline-block h-2 w-2 rounded-full",
              isComplete ? "bg-evidence-direct" : "bg-blue-500 animate-pulse",
            ].join(" ")}
          />
          <span
            className={[
              "text-xs font-semibold uppercase tracking-widest",
              isComplete ? "text-evidence-direct" : "text-blue-400",
            ].join(" ")}
          >
            {isComplete ? "Complete" : "Building"}
          </span>
        </span>
        {steps.map((step) => (
          <span key={step.label} className="flex shrink-0 items-center gap-1">
            <StepIcon status={step.status} />
            <span
              className={[
                "text-xs",
                step.status === "done" && "text-ink-faint",
                step.status === "running" && "text-evidence-reported font-medium",
                step.status === "pending" && "text-ink-faint",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {step.label}
            </span>
          </span>
        ))}
        {secsLeft !== null && secsLeft > 0 && (
          <span className="shrink-0 text-xs text-ink-faint">~{secsLeft}s</span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header row — hidden in compact (sidebar) mode */}
      {!compact && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isComplete ? (
              <>
                <span className="inline-block w-2 h-2 rounded-full bg-evidence-direct" />
                <span className="text-xs font-semibold text-evidence-direct uppercase tracking-widest">
                  Brief complete
                </span>
              </>
            ) : (
              <>
                <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                <span className="text-xs font-semibold text-blue-400 uppercase tracking-widest">
                  Building brief
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            {secsLeft !== null && secsLeft > 0 && (
              <span className="text-xs text-ink-faint">~{secsLeft} sec left</span>
            )}
            {secsLeft === 0 && !isComplete && (
              <span className="text-xs text-ink-faint">still working…</span>
            )}
            <span className="text-xs font-medium text-evidence-direct">● MongoDB</span>
          </div>
        </div>
      )}

      {/* Steps */}
      <div className="space-y-1">
        {steps.map((step) => (
          <div key={step.label} className="flex items-center gap-2">
            <StepIcon status={step.status} />
            <span
              className={[
                "text-xs",
                step.status === "done" && "text-ink-faint line-through",
                step.status === "running" && "text-evidence-reported font-medium",
                step.status === "pending" && "text-ink-faint",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {step.label}
            </span>
            {step.source && (
              <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-ink-faint">
                {step.detail ? `${step.source} · ${step.detail}` : step.source}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Agent status voice */}
      {statusMessage && (
        <p
          data-testid="status-message"
          className="text-xs text-ink-muted italic pt-1"
        >
          {statusMessage}
        </p>
      )}
    </div>
  );
}
