import type { HeaderFacts } from "@/lib/brief-layout";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-widest text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink">{value}</p>
    </div>
  );
}

export function DecisionHeader({ facts }: { facts: HeaderFacts }) {
  return (
    <div className="rounded-[2px] border border-edge bg-surface-raised p-4">
      <h2 className="text-base font-semibold text-ink">{facts.title}</h2>
      <p className="mt-0.5 text-xs text-ink-muted">{facts.phaseLabel}</p>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Fact label="Seat" value={facts.seatLabel} />
        <Fact label="Field" value={facts.fieldSummary} />
        <Fact label="Money" value={facts.moneySummary} />
        <Fact label="At stake" value={facts.stakesLabel} />
      </div>

      <p className="mt-3 border-t border-edge pt-2 text-xs text-ink-faint">
        Competitiveness rating — not yet available
      </p>
    </div>
  );
}
