import { test, expect } from "vitest";

import { diffFingerprints } from "@/lib/saved-briefs/diff";
import type { BriefFingerprint } from "@/lib/brief-fingerprint";

function saved(over: Partial<BriefFingerprint> = {}): BriefFingerprint {
  return {
    raceKey: "2026-H-GA-07",
    candidateIds: ["c1", "c2"],
    financeCoverageEndMax: "2026-03-31",
    votingAsOfDate: null,
    votingTotalRollCalls: null,
    legislationCount: 0,
    positionsCount: 0,
    newsLatestDate: null,
    ...over,
  };
}

test("identical signals produce no changes", () => {
  expect(
    diffFingerprints(saved(), { candidateIds: ["c1", "c2"], financeCoverageEndMax: "2026-03-31" }),
  ).toEqual([]);
});

test("a newly filed candidate is reported", () => {
  const changes = diffFingerprints(saved(), {
    candidateIds: ["c1", "c2", "c3"],
    financeCoverageEndMax: "2026-03-31",
  });
  expect(changes).toContain("1 new candidate filed");
});

test("multiple new candidates pluralize", () => {
  const changes = diffFingerprints(saved(), {
    candidateIds: ["c1", "c2", "c3", "c4"],
    financeCoverageEndMax: "2026-03-31",
  });
  expect(changes).toContain("2 new candidates filed");
});

test("a dropped candidate is reported", () => {
  const changes = diffFingerprints(saved(), {
    candidateIds: ["c1"],
    financeCoverageEndMax: "2026-03-31",
  });
  expect(changes).toContain("1 candidate no longer listed");
});

test("newer fundraising coverage is reported", () => {
  const changes = diffFingerprints(saved(), {
    candidateIds: ["c1", "c2"],
    financeCoverageEndMax: "2026-06-30",
  });
  expect(changes).toContain("Fundraising updated through 2026-06-30");
});

test("equal or older fundraising coverage is not reported", () => {
  expect(
    diffFingerprints(saved(), { candidateIds: ["c1", "c2"], financeCoverageEndMax: "2026-03-31" }),
  ).toEqual([]);
  expect(
    diffFingerprints(saved(), { candidateIds: ["c1", "c2"], financeCoverageEndMax: "2026-01-01" }),
  ).toEqual([]);
});
