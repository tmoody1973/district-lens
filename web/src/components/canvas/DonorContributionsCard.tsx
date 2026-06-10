"use client";

/**
 * DonorContributionsCard — inline generative-UI card for the
 * `get_individual_donors` backend tool. Shows the largest itemized individual
 * contributions for one candidate, FEC live data. Visual language clones
 * FinanceToolCard (dark tokens, 2px borders, mono amounts).
 *
 * Civic guardrail: the footer disclaimer is unconditional — donor data is
 * context, never proof of positions (.claude/rules/civic_safety.md).
 */

export interface DonorRow {
  name: string;
  employer?: string | null;
  occupation?: string | null;
  city_state?: string;
  total: number;
  total_fmt?: string;
  transactions: number;
  latest_date?: string;
}

interface DonorContributionsCardProps {
  candidate?: string;
  donors: DonorRow[];
  coverageNote?: string;
  retrievedAt?: string;
  loading?: boolean;
}

const GUARDRAIL =
  "Public FEC record. Contributions provide context — they do not establish a candidate's policy positions.";

// FEC raw data uses literal placeholders for unreported employer/occupation.
const FEC_PLACEHOLDERS = new Set(["N/A", "NA", "NONE", "NOT EMPLOYED"]);

function meaningfulFacts(donor: DonorRow): string[] {
  return [donor.employer, donor.occupation].filter(
    (fact): fact is string => Boolean(fact) && !FEC_PLACEHOLDERS.has(fact!.trim().toUpperCase()),
  );
}

export function DonorContributionsCard({
  candidate,
  donors,
  coverageNote,
  retrievedAt,
  loading,
}: DonorContributionsCardProps) {
  if (loading) {
    return (
      <div className="my-2 rounded-[2px] border-2 border-edge-strong bg-surface-raised p-3">
        <p className="text-xs font-medium uppercase tracking-widest text-ink-muted">
          Largest Individual Contributions · FEC
        </p>
        <p className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
          <span className="animate-spin">⟳</span> Pulling FEC contribution records…
        </p>
      </div>
    );
  }

  const maxTotal = Math.max(...donors.map((donor) => donor.total), 1);
  const retrievedDate = retrievedAt?.slice(0, 10);

  return (
    <div className="my-2 space-y-3 rounded-[2px] border-2 border-edge-strong bg-surface-raised p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-widest text-ink-muted">
          Largest Individual Contributions · FEC
        </p>
        {candidate && (
          <span className="truncate text-xs font-medium text-ink">{candidate}</span>
        )}
      </div>

      {donors.length === 0 ? (
        <p className="text-xs italic text-ink-muted">
          {coverageNote ?? "No itemized individual contributions found."}
        </p>
      ) : (
        donors.map((donor) => {
          const facts = meaningfulFacts(donor);
          return (
          <div key={donor.name} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium text-ink">{donor.name}</span>
              <span className="shrink-0 font-mono text-sm font-bold text-ink">
                {donor.total_fmt ?? `$${donor.total.toLocaleString()}`}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-sm border border-edge bg-surface-hover">
              <div
                className="h-full bg-blue-500 transition-all duration-700"
                style={{ width: `${(donor.total / maxTotal) * 100}%` }}
              />
            </div>
            <div className="flex flex-wrap gap-x-3 text-[10px] text-ink-faint">
              {facts.length > 0 && <span>{facts.join(" · ")}</span>}
              {donor.city_state && <span>{donor.city_state}</span>}
              {donor.transactions > 1 && <span>{donor.transactions} contributions</span>}
              {donor.latest_date && <span className="ml-auto">{donor.latest_date}</span>}
            </div>
          </div>
          );
        })
      )}

      <div className="space-y-1 border-t border-edge pt-2">
        <p className="text-[10px] text-ink-faint">
          Source: FEC API{retrievedDate ? ` · retrieved ${retrievedDate}` : ""}
        </p>
        <p className="text-[10px] italic text-ink-faint">{GUARDRAIL}</p>
      </div>
    </div>
  );
}
