import { test, expect } from "vitest";
import {
  deriveArtifactName,
  shouldSnapshot,
  snapshotBrief,
} from "@/lib/artifacts/lifecycle";
import { DEFAULT_STATE, type DistrictLensState } from "@/types/agent-state";

const complete = (over: Partial<DistrictLensState> = {}): DistrictLensState => ({
  ...DEFAULT_STATE,
  stage: "complete",
  currentRaceKey: "2026-H-WI-04",
  candidates: [
    {
      candidateId: "C1",
      name: "A. Person",
      party: "DEM",
      status: "challenger",
      photoUrl: "",
      photoSource: "placeholder",
      raceKey: "2026-H-WI-04",
    },
  ],
  ...over,
});

const ids = { artifactId: "art-1", versionId: "v-1" };
const NOW = new Date("2026-06-09T12:00:00Z");

// --- shouldSnapshot: snapshot ONLY on the transition into complete ---

test("snapshots on the transition into complete", () => {
  expect(shouldSnapshot("positions", "complete", "2026-H-WI-04")).toBe(true);
});

test("does not snapshot while still drafting", () => {
  expect(shouldSnapshot("finance", "positions", "2026-H-WI-04")).toBe(false);
});

test("does not re-snapshot when stage stays complete across renders", () => {
  expect(shouldSnapshot("complete", "complete", "2026-H-WI-04")).toBe(false);
});

test("failed/incomplete builds never save: no race key means no snapshot", () => {
  expect(shouldSnapshot("district", "complete", null)).toBe(false);
});

// --- snapshotBrief ---

test("first snapshot creates a named single-version record", () => {
  const record = snapshotBrief(complete(), null, ids, NOW);
  expect(record.type).toBe("brief");
  expect(record.name).toBe("U.S. House · WI-04 · 2026");
  expect(record.raceKey).toBe("2026-H-WI-04");
  expect(record.versions).toHaveLength(1);
  expect(record.versions[0].savedAt).toBe(NOW.toISOString());
});

test("identical fingerprint dedupes: returns the existing record unchanged", () => {
  const first = snapshotBrief(complete(), null, ids, NOW);
  const again = snapshotBrief(complete(), first, { artifactId: "x", versionId: "v-2" }, NOW);
  expect(again).toBe(first);
  expect(again.versions).toHaveLength(1);
});

test("changed evidence appends a new version, old version untouched", () => {
  const first = snapshotBrief(complete(), null, ids, NOW);
  const refreshed = complete({
    positions: [
      {
        candidateName: "A. Person",
        issue: "housing",
        answer: "Supports zoning reform.",
        sources: [],
      },
    ],
  });
  const second = snapshotBrief(refreshed, first, { artifactId: "x", versionId: "v-2" }, NOW);
  expect(second.versions).toHaveLength(2);
  expect(second.versions[0]).toBe(first.versions[0]); // immutable old version
  expect(second.versions[1].versionId).toBe("v-2");
});

test("snapshotBrief refuses a state without a race key", () => {
  expect(() => snapshotBrief({ ...DEFAULT_STATE, stage: "complete" }, null, ids, NOW)).toThrow();
});

test("deriveArtifactName formats race key with year", () => {
  expect(deriveArtifactName("2026-H-WI-04")).toBe("U.S. House · WI-04 · 2026");
});
