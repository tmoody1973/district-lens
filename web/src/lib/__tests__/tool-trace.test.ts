import { expect, test } from "vitest";

import { summarizeArgs, toolMeta } from "@/lib/tool-trace";

test("toolMeta returns known tool metadata", () => {
  expect(toolMeta("get_voting_record")).toEqual({
    icon: "🗳️",
    label: "Voting record",
    source: "Congress.gov",
  });
});

test("toolMeta labels any mongodb-prefixed tool as the partner MCP", () => {
  const meta = toolMeta("mongodb_aggregate");
  expect(meta.source).toBe("MongoDB MCP");
  expect(meta.label).toContain("MongoDB MCP");
  expect(meta.label).toContain("aggregate");
});

test("toolMeta falls back for unknown tools", () => {
  expect(toolMeta("some_new_tool")).toEqual({
    icon: "🔧",
    label: "some_new_tool",
    source: "Tool",
  });
});

test("summarizeArgs picks the interesting keys", () => {
  const summary = summarizeArgs({ race_key: "2026-H-WI-04", limit: 8 });
  expect(summary).toContain("race_key: 2026-H-WI-04");
  expect(summary).not.toContain("limit");
});

test("summarizeArgs handles object values and empty input", () => {
  expect(summarizeArgs(undefined)).toBe("");
  expect(summarizeArgs({ collection: "candidates" })).toBe("collection: candidates");
});
