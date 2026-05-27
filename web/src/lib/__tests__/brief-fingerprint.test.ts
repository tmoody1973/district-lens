import { test, expect } from "vitest";

import { computeFingerprint } from "@/lib/brief-fingerprint";
import {
  DEFAULT_STATE,
  type CandidateCard,
  type DistrictLensState,
  type FinanceSummary,
} from "@/types/agent-state";

function candidate(id: string): CandidateCard {
  return {
    candidateId: id,
    name: id,
    party: "DEM",
    status: "challenger",
    photoUrl: "",
    photoSource: "placeholder",
    raceKey: "2026-H-WI-04",
  };
}

function finance(id: string, coverageEndDate: string | null): FinanceSummary {
  return {
    candidateId: id,
    name: id,
    party: "DEM",
    receipts: null,
    disbursements: null,
    cashOnHand: null,
    individualContributions: null,
    pacContributions: null,
    coverageEndDate,
  };
}

test("default state produces an empty fingerprint", () => {
  const fp = computeFingerprint(DEFAULT_STATE);
  expect(fp.raceKey).toBeNull();
  expect(fp.candidateIds).toEqual([]);
  expect(fp.financeCoverageEndMax).toBeNull();
  expect(fp.votingAsOfDate).toBeNull();
  expect(fp.votingTotalRollCalls).toBeNull();
  expect(fp.legislationCount).toBe(0);
  expect(fp.positionsCount).toBe(0);
});

test("candidate ids are captured sorted, so order can't cause a false diff", () => {
  const state: DistrictLensState = {
    ...DEFAULT_STATE,
    currentRaceKey: "2026-H-WI-04",
    candidates: [candidate("c3"), candidate("c1"), candidate("c2")],
  };
  const fp = computeFingerprint(state);
  expect(fp.raceKey).toBe("2026-H-WI-04");
  expect(fp.candidateIds).toEqual(["c1", "c2", "c3"]);
});

test("finance coverage uses the latest coverage-end date and ignores nulls", () => {
  const state: DistrictLensState = {
    ...DEFAULT_STATE,
    finance: [finance("c1", "2026-03-31"), finance("c2", null), finance("c3", "2026-06-30")],
  };
  expect(computeFingerprint(state).financeCoverageEndMax).toBe("2026-06-30");
});

test("voting and count signals are captured from state", () => {
  const state: DistrictLensState = {
    ...DEFAULT_STATE,
    votingRecord: {
      memberName: "Gwen Moore",
      congress: "119",
      attendancePct: 80.1,
      partyLinePct: 98.1,
      votesCast: 180,
      votesMissed: 11,
      totalRollCalls: 191,
      asOfDate: "2026-05-20",
      sourceUrl: "https://example.com",
    },
    legislation: [
      { billId: "b1", title: "x", introducedDate: null, latestAction: null, memberName: "m" },
    ],
    positions: [
      { candidateName: "c1", issue: "healthcare", answer: "a", sources: [] },
      { candidateName: "c1", issue: "economy", answer: "a", sources: [] },
    ],
  };
  const fp = computeFingerprint(state);
  expect(fp.votingAsOfDate).toBe("2026-05-20");
  expect(fp.votingTotalRollCalls).toBe(191);
  expect(fp.legislationCount).toBe(1);
  expect(fp.positionsCount).toBe(2);
});
