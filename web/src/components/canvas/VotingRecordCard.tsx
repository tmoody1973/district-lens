"use client";
import type { VotingRecordSummary } from "@/types/agent-state";

interface Props { record: VotingRecordSummary | null; }

export function VotingRecordCard({ record }: Props) {
  if (!record) return null;

  return (
    <div className="rounded-[2px] border-2 border-slate-900 bg-white p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
          {record.congress} Congress · Voting Record
        </p>
        <span className="text-xs text-slate-400">Source: Congress.gov</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="border-l-2 border-blue-300 pl-3">
          <p className="text-2xl font-bold text-slate-900">{record.attendancePct}%</p>
          <p className="text-xs text-slate-500">
            Vote attendance · {record.votesMissed} missed of {record.totalRollCalls}
          </p>
        </div>
        <div className="border-l-2 border-blue-300 pl-3">
          {record.partyLinePct === null ? (
            <p className="text-sm text-slate-500">
              Party-line: not enough party-split votes yet
            </p>
          ) : (
            <>
              <p className="text-2xl font-bold text-slate-900">{record.partyLinePct}%</p>
              <p className="text-xs text-slate-500">Voted with their party</p>
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-400 border-t border-slate-100 pt-2">
        Voting behavior, not policy positions
        {record.asOfDate ? ` · as of ${record.asOfDate}` : ""}.
      </p>
    </div>
  );
}
