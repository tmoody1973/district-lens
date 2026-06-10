"use client";

/**
 * FinanceToolCard — inline generative-UI card for the `get_race_finance_brief`
 * backend tool. Rendered in the CopilotKit chat via useRenderToolCall when the
 * agent pulls FEC finance for a race during a conversation (journalist
 * follow-ups), upgrading the generic TraceCard to a comparative money view.
 *
 * Consumes the tool RESULT shape (snake_case + pre-formatted _fmt strings),
 * which differs from the coagent-state FinanceSummary the center-canvas
 * FinanceChart uses. Visual language matches FinanceChart on purpose.
 */

export interface FinanceToolCandidate {
  name: string;
  party: string;
  status: string;
  candidate_id: string;
  raised?: number | null;
  raised_fmt?: string;
  spent_fmt?: string;
  cash_on_hand_fmt?: string;
  individual_contributions?: number | null;
  individual_contributions_fmt?: string;
  pac_contributions?: number | null;
  pac_contributions_fmt?: string;
  coverage_end_date?: string | null;
  has_finance: boolean;
}

const PARTY_DOT: Record<string, string> = {
  DEM: "bg-party-dem",
  REP: "bg-party-rep",
  IND: "bg-zinc-500",
};

function partyDot(party: string): string {
  return PARTY_DOT[party?.toUpperCase()] ?? "bg-zinc-500";
}

interface FinanceToolCardProps {
  raceKey?: string;
  candidates: FinanceToolCandidate[];
  source?: string;
  loading?: boolean;
}

export function FinanceToolCard({ raceKey, candidates, source, loading }: FinanceToolCardProps) {
  if (loading) {
    return (
      <div className="my-2 rounded-[2px] border-2 border-edge-strong bg-surface-raised p-3">
        <p className="text-xs font-medium uppercase tracking-widest text-ink-muted">
          Campaign Finance · FEC
        </p>
        <p className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
          <span className="animate-spin">⟳</span> Pulling FEC finance data…
        </p>
      </div>
    );
  }

  const funded = candidates.filter((c) => c.has_finance);
  const maxRaised = Math.max(...funded.map((c) => c.raised ?? 0), 1);

  // "outraises Nx" gap line — only when the leader at least doubles the runner-up.
  const sorted = [...funded].sort((a, b) => (b.raised ?? 0) - (a.raised ?? 0));
  const gap =
    sorted.length >= 2 && (sorted[1].raised ?? 0) > 0 && (sorted[0].raised ?? 0) / (sorted[1].raised ?? 1) >= 2
      ? {
          leader: sorted[0].name.split(" ").pop(),
          trailer: sorted[1].name.split(" ").pop(),
          x: Math.round((sorted[0].raised ?? 0) / (sorted[1].raised ?? 1)),
        }
      : null;

  const coverage = funded.find((c) => c.coverage_end_date)?.coverage_end_date;

  return (
    <div className="my-2 space-y-3 rounded-[2px] border-2 border-edge-strong bg-surface-raised p-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-widest text-ink-muted">
          Campaign Finance · FEC
        </p>
        {raceKey && <span className="font-mono text-[10px] text-ink-faint">{raceKey}</span>}
      </div>

      {candidates.map((c) => {
        if (!c.has_finance) {
          return (
            <div key={c.candidate_id} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-ink">
                <span className={`inline-block h-2 w-2 rounded-full ${partyDot(c.party)}`} />
                {c.name}
              </span>
              <span className="italic text-ink-faint">No FEC filing</span>
            </div>
          );
        }

        const raised = c.raised ?? 0;
        const ind = c.individual_contributions ?? 0;
        const pac = c.pac_contributions ?? 0;
        const barWidth = (raised / maxRaised) * 100;
        const indPct = raised > 0 ? (ind / raised) * 100 : 0;
        const pacPct = raised > 0 ? (pac / raised) * 100 : 0;
        const isIncumbent = c.status?.includes("incumbent");

        return (
          <div key={c.candidate_id} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-1.5 truncate text-sm text-ink">
                <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${partyDot(c.party)}`} />
                <span className="truncate font-medium">{c.name}</span>
                {isIncumbent && (
                  <span className="shrink-0 rounded-[2px] bg-zinc-100 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-zinc-900">
                    inc
                  </span>
                )}
              </span>
              <span className="shrink-0 font-mono text-sm font-bold text-ink">
                {c.raised_fmt ?? "—"}
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-sm border border-edge bg-surface-hover">
              <div className="flex h-full">
                <div
                  className="bg-blue-500 transition-all duration-700"
                  style={{ width: `${(indPct / 100) * barWidth}%` }}
                  title={`Individuals: ${c.individual_contributions_fmt ?? "—"}`}
                />
                <div
                  className="bg-amber-400 transition-all duration-700"
                  style={{ width: `${(pacPct / 100) * barWidth}%` }}
                  title={`PACs: ${c.pac_contributions_fmt ?? "—"}`}
                />
              </div>
            </div>
            <div className="flex gap-3 text-[10px] text-ink-faint">
              <span>
                <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-blue-500" />
                Ind {c.individual_contributions_fmt ?? "—"}
              </span>
              <span>
                <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-400" />
                PAC {c.pac_contributions_fmt ?? "—"}
              </span>
              <span className="ml-auto">Cash {c.cash_on_hand_fmt ?? "—"}</span>
            </div>
          </div>
        );
      })}

      {gap && (
        <p className="border-t border-edge pt-2 text-xs text-ink-muted">
          ⚡ <strong>{gap.leader}</strong> outraises <strong>{gap.trailer}</strong> {gap.x}×
        </p>
      )}

      <p className="text-[10px] italic text-ink-faint">
        {source ?? "Source: FEC"}
        {coverage ? ` · through ${coverage}` : ""} · Finance is context, not proof of positions.
      </p>
    </div>
  );
}
