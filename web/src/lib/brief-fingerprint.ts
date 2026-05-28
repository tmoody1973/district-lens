import type { DistrictLensState } from "@/types/agent-state";

// A compact, comparable summary of the evidence behind a brief at save time.
// We store it alongside a saved brief so that on revisit we can answer
// "what changed since you saved this" by recomputing it against live data and
// diffing — without re-reading the whole snapshot. Pure: derived only from state.
export interface BriefFingerprint {
  raceKey: string | null;
  candidateIds: string[]; // sorted, so candidate order never reads as a change
  financeCoverageEndMax: string | null; // latest FEC coverage-end date seen
  votingAsOfDate: string | null;
  votingTotalRollCalls: number | null;
  legislationCount: number;
  positionsCount: number;
  newsLatestDate: string | null;
}

// Parse a date string to a comparable timestamp. Real FEC dates are MM/DD/YYYY,
// not ISO, so a lexicographic string compare is wrong — parse to time instead.
// Unparseable/missing dates sort to the bottom.
export function toTime(d: string | null): number {
  if (!d) return -Infinity;
  const t = Date.parse(d);
  return Number.isNaN(t) ? -Infinity : t;
}

// Chronologically latest non-null date string in a list, or null.
function latestDate(dates: Array<string | null>): string | null {
  const present = dates.filter((d): d is string => !!d);
  if (present.length === 0) return null;
  return present.reduce((max, d) => (toTime(d) > toTime(max) ? d : max));
}

export function computeFingerprint(state: DistrictLensState): BriefFingerprint {
  return {
    raceKey: state.currentRaceKey,
    candidateIds: state.candidates.map((c) => c.candidateId).sort(),
    financeCoverageEndMax: latestDate(state.finance.map((f) => f.coverageEndDate)),
    votingAsOfDate: state.votingRecord?.asOfDate ?? null,
    votingTotalRollCalls: state.votingRecord?.totalRollCalls ?? null,
    legislationCount: state.legislation.length,
    positionsCount: state.positions.length,
    newsLatestDate: latestDate(state.news.map((n) => n.date)),
  };
}
