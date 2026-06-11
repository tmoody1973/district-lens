import { test, expect } from "vitest";
import { normalizeCandidateName, filterRelevantSources } from "../perplexity";

test("normalizes FEC Last, First order", () => {
  expect(normalizeCandidateName("Moore, Gwen S")).toBe("Gwen S Moore");
});

test("survives FEC double-comma names (Brink,, Bridget)", () => {
  expect(normalizeCandidateName("Brink,, Bridget")).toBe("Bridget Brink");
});

test("passes through natural-order names", () => {
  expect(normalizeCandidateName("Josh Cowen")).toBe("Josh Cowen");
});

const sources = [
  { title: "Bridget Brink launches MI-07 bid", url: "a", snippet: "", date: null },
  { title: "With 2026 Midterms approaching, races to watch", url: "b", snippet: "Democrats' odds", date: null },
  { title: "Palmetto Politics LIVE forum", url: "c", snippet: "SC governor candidates", date: null },
  { title: "Campaign stop", url: "d", snippet: "Brink spoke in Lansing", date: null },
];

test("keeps only sources that mention the candidate's surname", () => {
  const kept = filterRelevantSources(sources, "Brink,, Bridget");
  expect(kept.map((s) => s.url)).toEqual(["a", "d"]);
});

test("empty result when nothing mentions the candidate", () => {
  expect(filterRelevantSources(sources.slice(1, 3), "Brink,, Bridget")).toEqual([]);
});
