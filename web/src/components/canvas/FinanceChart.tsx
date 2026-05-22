"use client";
import type { FinanceSummary } from "@/types/agent-state";

function fmtMoney(val: number | null): string {
  if (val == null) return "—";
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

interface Props { finance: FinanceSummary[]; }

export function FinanceChart({ finance }: Props) {
  const maxReceipts = Math.max(...finance.map((f) => f.receipts ?? 0), 1);

  return (
    <div className="rounded-[2px] border-2 border-slate-900 bg-white p-4 space-y-4">
      <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
        Campaign Finance · FEC
      </p>
      {finance.map((f) => {
        const individual = f.individualContributions ?? 0;
        const pac = f.pacContributions ?? 0;
        const total = f.receipts ?? 0;
        const indPct = total > 0 ? (individual / total) * 100 : 0;
        const pacPct = total > 0 ? (pac / total) * 100 : 0;
        const barWidth = total > 0 ? (total / maxReceipts) * 100 : 0;

        return (
          <div key={f.candidateId} className="space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="font-medium text-sm text-slate-900 truncate">{f.name}</span>
              <span className="font-mono text-sm font-bold text-slate-900 ml-2 shrink-0">
                {fmtMoney(total)}
              </span>
            </div>
            <div className="h-4 w-full bg-slate-100 rounded-sm overflow-hidden border border-slate-200">
              <div className="h-full flex">
                <div
                  className="bg-blue-600 transition-all duration-700"
                  style={{ width: `${(indPct / 100) * barWidth}%` }}
                  title={`Individuals: ${fmtMoney(individual)}`}
                />
                <div
                  className="bg-amber-500 transition-all duration-700"
                  style={{ width: `${(pacPct / 100) * barWidth}%` }}
                  title={`PACs: ${fmtMoney(pac)}`}
                />
              </div>
            </div>
            <div className="flex gap-3 text-xs text-slate-500">
              <span><span className="inline-block w-2 h-2 bg-blue-600 rounded-sm mr-1" />Ind {fmtMoney(individual)}</span>
              <span><span className="inline-block w-2 h-2 bg-amber-500 rounded-sm mr-1" />PAC {fmtMoney(pac)}</span>
              {f.coverageEndDate && <span className="ml-auto">through {f.coverageEndDate}</span>}
            </div>
          </div>
        );
      })}
      {/* Gap multiplier label */}
      {(() => {
        if (finance.length < 2) return null;
        const sorted = [...finance].sort((a, b) => (b.receipts ?? 0) - (a.receipts ?? 0));
        const top = sorted[0].receipts ?? 0;
        const second = sorted[1].receipts ?? 0;
        if (second === 0 || top / second < 2) return null;
        const multiplier = Math.round(top / second);
        return (
          <p className="text-xs text-slate-500 border-t border-slate-100 pt-3 mt-1">
            ⚡ <strong>{sorted[0].name.split(" ").pop()}</strong> outraises{" "}
            <strong>{sorted[1].name.split(" ").pop()}</strong> {multiplier}×
          </p>
        );
      })()}
    </div>
  );
}
