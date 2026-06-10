"use client";
import type { VotingRecordSummary } from "@/types/agent-state";

interface Props { record: VotingRecordSummary | null; }

export function VotingRecordCard({ record }: Props) {
  if (!record) return null;

  return (
    <div className="rounded-[2px] border-2 border-edge-strong bg-surface-raised p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-widest text-ink-muted">
          {record.congress} Congress · Voting Record
        </p>
        <span className="text-xs text-ink-faint">Source: Congress.gov</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="border-l-2 border-evidence-voting pl-3">
          <p className="text-2xl font-bold text-ink">{record.attendancePct}%</p>
          <p className="text-xs text-ink-muted">
            Vote attendance · {record.votesMissed} missed of {record.totalRollCalls}
          </p>
        </div>
        <div className="border-l-2 border-evidence-voting pl-3">
          {record.partyLinePct === null ? (
            <p className="text-sm text-ink-muted">
              Party-line: not enough party-split votes yet
            </p>
          ) : (
            <>
              <p className="text-2xl font-bold text-ink">{record.partyLinePct}%</p>
              <p className="text-xs text-ink-muted">Voted with their party</p>
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-ink-faint border-t border-edge pt-2">
        Voting behavior, not policy positions
        {record.asOfDate ? ` · as of ${record.asOfDate}` : ""}.
      </p>
    </div>
  );
}
