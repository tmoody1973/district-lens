import { test, expect } from "vitest";
import { getVoterLinks, stateCodeFromRaceKey } from "../states";

test("derives the state code from a House race key", () => {
  expect(stateCodeFromRaceKey("2026-H-WI-04")).toBe("WI");
});

test("derives the state code from a Senate race key", () => {
  expect(stateCodeFromRaceKey("2026-S-TX")).toBe("TX");
});

test("returns null for missing or malformed race keys", () => {
  expect(stateCodeFromRaceKey(null)).toBeNull();
  expect(stateCodeFromRaceKey("garbage")).toBeNull();
});

test("resolves the full state name and official links", () => {
  const links = getVoterLinks("wi");
  expect(links.stateName).toBe("Wisconsin");
  expect(links.registration).toContain("vote.gov");
  expect(links.pollingAndDeadlines).toContain("canivote.org");
  expect(links.fullBallot).toContain("vote411.org");
});

test("falls back to the raw code for an unknown state", () => {
  expect(getVoterLinks("ZZ").stateName).toBe("ZZ");
});
