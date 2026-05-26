import { test, expect } from "vitest";
import { parseRaceKey } from "../race-key";

test("parses a House race key", () => {
  expect(parseRaceKey("2026-H-WI-04")).toEqual({
    year: "2026", office: "house", state: "WI", district: "04",
  });
});

test("parses a Senate race key (no district)", () => {
  expect(parseRaceKey("2026-S-WI")).toEqual({
    year: "2026", office: "senate", state: "WI", district: null,
  });
});

test("parses an at-large House district", () => {
  expect(parseRaceKey("2026-H-AK-00")).toEqual({
    year: "2026", office: "house", state: "AK", district: "00",
  });
});

test("returns null for a malformed key", () => {
  expect(parseRaceKey("garbage")).toBeNull();
  expect(parseRaceKey(null)).toBeNull();
});
