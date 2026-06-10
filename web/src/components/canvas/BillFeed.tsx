"use client";
import type { BillRecord } from "@/types/agent-state";

interface Props { legislation: BillRecord[]; memberName?: string; }

export function BillFeed({ legislation, memberName }: Props) {
  if (!legislation.length) return null;
  const name = memberName ?? legislation[0]?.memberName ?? "The incumbent";

  return (
    <div className="rounded-[2px] border-2 border-edge-strong bg-surface-raised p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-widest text-ink-muted">
          119th Congress · Sponsored Bills
        </p>
        <span className="text-xs text-ink-faint">Source: Congress.gov</span>
      </div>
      <p className="text-sm font-semibold text-ink">{name}</p>
      <div className="space-y-2">
        {legislation.map((bill) => (
          <div key={bill.billId} className="border-l-2 border-evidence-voting pl-3">
            <div className="flex items-start gap-2">
              <span className="font-mono text-xs font-bold text-evidence-questionnaire shrink-0 mt-0.5">
                {bill.billId}
              </span>
              <p className="text-sm text-ink-muted leading-snug">{bill.title}</p>
            </div>
            {bill.introducedDate && (
              <p className="text-xs text-ink-faint mt-0.5">Introduced {bill.introducedDate}</p>
            )}
            {bill.latestAction && (
              <p className="text-xs text-ink-muted mt-0.5 truncate">{bill.latestAction}</p>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-faint border-t border-edge pt-2">
        Sponsorship shows legislative priorities, not definitive policy positions.
      </p>
    </div>
  );
}
