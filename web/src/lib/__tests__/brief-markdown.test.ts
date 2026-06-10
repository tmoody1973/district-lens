import { test, expect } from "vitest";
import { briefToMarkdown } from "../brief-markdown";
import { DEFAULT_STATE, type DistrictLensState } from "@/types/agent-state";

const state: DistrictLensState = {
  ...DEFAULT_STATE,
  currentRaceKey: "2026-H-WI-04",
  candidates: [
    { candidateId: "1", name: "Moore, Gwen S", party: "DEM", status: "incumbent",
      photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-04" },
  ],
  finance: [
    { candidateId: "1", name: "Moore, Gwen S", party: "DEM", receipts: 844300,
      disbursements: 795000, cashOnHand: 71600, individualContributions: 327400,
      pacContributions: 512000, coverageEndDate: "03/31/2026" },
  ],
  positions: [
    { candidateName: "Gwen S Moore", issue: "HEALTH CARE",
      answer: "Supports protecting the ACA.",
      evidenceType: "voting_record",
      sources: [{ title: "Issues", url: "https://gwenmoore.house.gov/issues",
                  date: null, snippet: "", archived: true, archivedAt: "2026-06-08" }] },
  ],
};

test("includes race key and candidate roster", () => {
  const md = briefToMarkdown(state);
  expect(md).toContain("2026-H-WI-04");
  expect(md).toContain("Moore, Gwen S");
});

test("includes finance with coverage date", () => {
  const md = briefToMarkdown(state);
  expect(md).toContain("$844,300");
  expect(md).toContain("03/31/2026");
});

test("includes positions with cited source urls", () => {
  const md = briefToMarkdown(state);
  expect(md).toContain("Supports protecting the ACA.");
  expect(md).toContain("https://gwenmoore.house.gov/issues");
});

test("includes the nonpartisan disclaimer", () => {
  expect(briefToMarkdown(state)).toMatch(/never recommends how to vote/i);
});

test("omits empty sections instead of rendering placeholders", () => {
  const sparse = { ...DEFAULT_STATE, currentRaceKey: "2026-H-WY-00" };
  const md = briefToMarkdown(sparse);
  expect(md).not.toContain("undefined");
  expect(md).not.toMatch(/## Issue positions/i);
});
