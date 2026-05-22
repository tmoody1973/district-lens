"use client";
import { useEffect, useState } from "react";
import type { BriefStep } from "@/types/agent-state";

const ESTIMATED_TOTAL_MS = 70_000;

interface Props {
  steps: BriefStep[];
  briefStartedAt: number | null;
  statusMessage?: string | null;
}

export function ReceiptProgress({ steps, briefStartedAt, statusMessage }: Props) {
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

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isComplete ? (
            <>
              <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs font-semibold text-green-700 uppercase tracking-widest">
                Brief complete
              </span>
            </>
          ) : (
            <>
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-xs font-semibold text-blue-700 uppercase tracking-widest">
                Building brief
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {secsLeft !== null && secsLeft > 0 && (
            <span className="text-xs text-slate-400">~{secsLeft} sec left</span>
          )}
          {secsLeft === 0 && !isComplete && (
            <span className="text-xs text-slate-400">still working…</span>
          )}
          <span className="text-xs font-medium text-green-600">● MongoDB</span>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-1">
        {steps.map((step) => (
          <div key={step.label} className="flex items-center gap-2">
            {step.status === "done" && (
              <span className="text-green-600 text-xs w-4 shrink-0">✓</span>
            )}
            {step.status === "running" && (
              <span className="text-amber-500 text-xs w-4 shrink-0 animate-spin">⟳</span>
            )}
            {step.status === "pending" && (
              <span className="text-slate-300 text-xs w-4 shrink-0">○</span>
            )}
            <span
              className={[
                "text-xs",
                step.status === "done" && "text-slate-400 line-through",
                step.status === "running" && "text-amber-600 font-medium",
                step.status === "pending" && "text-slate-400",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>

      {/* Agent status voice */}
      {statusMessage && (
        <p
          data-testid="status-message"
          className="text-xs text-slate-500 italic pt-1"
        >
          {statusMessage}
        </p>
      )}
    </div>
  );
}
