import { test, expect } from "vitest";
import { deriveKeyDates, formatIsoDate, type ElectionDatesRecord } from "../election-dates";

const TODAY = "2026-06-04";

const record = (over: Partial<ElectionDatesRecord> = {}): ElectionDatesRecord => ({
  state: "Illinois",
  state_abbreviation: "IL",
  primary: { date: "2026-03-17" },
  general_election_date: "2026-11-03",
  ...over,
});

test("formatIsoDate renders a YYYY-MM-DD string as a friendly date", () => {
  expect(formatIsoDate("2026-03-17")).toBe("Mar 17, 2026");
});

test("formatIsoDate returns null for malformed input", () => {
  expect(formatIsoDate("not-a-date")).toBeNull();
});

test("deriveKeyDates returns an empty array for a null record", () => {
  expect(deriveKeyDates(null, TODAY)).toEqual([]);
});

test("deriveKeyDates includes a Primary and a General entry", () => {
  const labels = deriveKeyDates(record(), TODAY).map((d) => d.label);
  expect(labels).toContain("Primary");
  expect(labels).toContain("General");
});

test("deriveKeyDates marks a past date completed", () => {
  const primary = deriveKeyDates(record(), TODAY).find((d) => d.label === "Primary");
  expect(primary?.completed).toBe(true);
});

test("deriveKeyDates marks a future date not completed", () => {
  const general = deriveKeyDates(record(), TODAY).find((d) => d.label === "General");
  expect(general?.completed).toBe(false);
});

test("deriveKeyDates includes Runoff only when the record has one", () => {
  const without = deriveKeyDates(record(), TODAY).map((d) => d.label);
  expect(without).not.toContain("Runoff");

  const withRunoff = deriveKeyDates(
    record({ primary: { date: "2026-03-17", runoff_date_if_necessary: "2026-04-14" } }),
    TODAY,
  ).map((d) => d.label);
  expect(withRunoff).toContain("Runoff");
});

test("deriveKeyDates falls back to 2026-11-03 when general is missing", () => {
  const general = deriveKeyDates(record({ general_election_date: null }), TODAY).find(
    (d) => d.label === "General",
  );
  expect(general?.dateText).toBe("Nov 3, 2026");
});
