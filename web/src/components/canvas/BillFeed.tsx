"use client";
import type { BillRecord } from "@/types/agent-state";

interface Props { legislation: BillRecord[]; memberName?: string; }

export function BillFeed({ legislation, memberName }: Props) {
  if (!legislation.length) return null;
  const name = memberName ?? legislation[0]?.memberName ?? "The incumbent";

  return (
    <div className="rounded-[2px] border-2 border-slate-900 bg-white p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
          119th Congress · Sponsored Bills
        </p>
        <span className="text-xs text-slate-400">Source: Congress.gov</span>
      </div>
      <p className="text-sm font-semibold text-slate-900">{name}</p>
      <div className="space-y-2">
        {legislation.map((bill) => (
          <div key={bill.billId} className="border-l-2 border-blue-300 pl-3">
            <div className="flex items-start gap-2">
              <span className="font-mono text-xs font-bold text-blue-700 shrink-0 mt-0.5">
                {bill.billId}
              </span>
              <p className="text-sm text-slate-800 leading-snug">{bill.title}</p>
            </div>
            {bill.introducedDate && (
              <p className="text-xs text-slate-400 mt-0.5">Introduced {bill.introducedDate}</p>
            )}
            {bill.latestAction && (
              <p className="text-xs text-slate-500 mt-0.5 truncate">{bill.latestAction}</p>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-400 border-t border-slate-100 pt-2">
        Sponsorship shows legislative priorities, not definitive policy positions.
      </p>
    </div>
  );
}
