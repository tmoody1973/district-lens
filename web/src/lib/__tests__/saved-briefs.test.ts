import { test, expect } from "vitest";

import {
  buildSavedDocs,
  deriveDistrictKey,
  deriveLabel,
  saveBriefRequestSchema,
} from "@/lib/saved-briefs/schema";
import { DEFAULT_STATE, type DistrictLensState } from "@/types/agent-state";

const IDS = { briefId: "brief-1", savedDistrictId: "sd-1" };
const NOW = new Date("2026-05-27T19:00:00.000Z");

test("deriveDistrictKey strips year+office", () => {
  expect(deriveDistrictKey("2026-H-WI-04")).toBe("WI-04");
  expect(deriveDistrictKey("2026-S-WI")).toBe("WI");
});

test("deriveLabel names the office", () => {
  expect(deriveLabel("2026-H-WI-04")).toBe("U.S. House · WI-04");
  expect(deriveLabel("2026-S-WI")).toBe("U.S. Senate · WI");
});

test("buildSavedDocs produces both docs keyed to the user and race", () => {
  const state: DistrictLensState = { ...DEFAULT_STATE, currentRaceKey: "2026-H-WI-04" };
  const { savedBrief, savedDistrict } = buildSavedDocs("user_abc", state, IDS, NOW);

  expect(savedBrief.clerk_user_id).toBe("user_abc");
  expect(savedBrief.race_key).toBe("2026-H-WI-04");
  expect(savedBrief.answer_snapshot).toBe(state); // full snapshot preserved
  expect(savedBrief.freshness.raceKey).toBe("2026-H-WI-04"); // fingerprint embedded
  expect(savedBrief.created_at).toBe("2026-05-27T19:00:00.000Z");

  expect(savedDistrict.district_key).toBe("WI-04");
  expect(savedDistrict.label).toBe("U.S. House · WI-04");
  expect(savedDistrict.clerk_user_id).toBe("user_abc");
});

test("buildSavedDocs preserves and de-dupes citations from positions + voting record", () => {
  const state: DistrictLensState = {
    ...DEFAULT_STATE,
    currentRaceKey: "2026-H-WI-04",
    positions: [
      {
        candidateName: "Moore",
        issue: "healthcare",
        answer: "a",
        sources: [
          { title: "S1", url: "https://x.com/1", date: "2026-01-01", snippet: "" },
          { title: "S1 dup", url: "https://x.com/1", date: "2026-01-01", snippet: "" },
        ],
      },
    ],
    votingRecord: {
      memberName: "Moore",
      congress: "119",
      attendancePct: 80,
      partyLinePct: 98,
      votesCast: 1,
      votesMissed: 0,
      totalRollCalls: 1,
      asOfDate: "2026-05-20",
      sourceUrl: "https://clerk.house.gov/votes",
    },
  };
  const { savedBrief } = buildSavedDocs("u", state, IDS, NOW);
  const urls = savedBrief.source_refs.map((r) => r.url).sort();
  expect(urls).toEqual(["https://clerk.house.gov/votes", "https://x.com/1"]);
});

test("save request rejects a brief with no race pinned", () => {
  const bad = saveBriefRequestSchema.safeParse({ state: { ...DEFAULT_STATE, currentRaceKey: null } });
  expect(bad.success).toBe(false);
});

test("save request accepts a race-pinned brief", () => {
  const ok = saveBriefRequestSchema.safeParse({
    state: { ...DEFAULT_STATE, currentRaceKey: "2026-H-WI-04" },
  });
  expect(ok.success).toBe(true);
});
