import { toTime, type BriefFingerprint } from "@/lib/brief-fingerprint";

// The subset of fingerprint signals we can cheaply recompute from stored data
// (candidates + finance) to compare a saved brief against the race today.
export interface CurrentRaceFingerprint {
  candidateIds: string[];
  financeCoverageEndMax: string | null;
}

// Human-readable "what changed since you saved this". Compares only the
// reliably-recomputable signals, so we never emit a false change for data we
// didn't re-fetch. Pure.
export function diffFingerprints(
  saved: BriefFingerprint,
  current: CurrentRaceFingerprint,
): string[] {
  const changes: string[] = [];

  const savedIds = new Set(saved.candidateIds);
  const currentIds = new Set(current.candidateIds);
  const added = current.candidateIds.filter((id) => !savedIds.has(id)).length;
  const removed = saved.candidateIds.filter((id) => !currentIds.has(id)).length;
  if (added > 0) changes.push(`${added} new candidate${added > 1 ? "s" : ""} filed`);
  if (removed > 0) {
    changes.push(`${removed} candidate${removed > 1 ? "s" : ""} no longer listed`);
  }

  // Real FEC dates are MM/DD/YYYY — compare parsed timestamps, not strings.
  if (
    current.financeCoverageEndMax &&
    toTime(current.financeCoverageEndMax) > toTime(saved.financeCoverageEndMax)
  ) {
    changes.push(`Fundraising updated through ${current.financeCoverageEndMax}`);
  }

  return changes;
}
