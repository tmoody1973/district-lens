import { test, expect } from "vitest";
import { unwrapMcpResult } from "../mcp-result";

test("parses an MCP text envelope into the inner object", () => {
  const envelope = {
    content: [{ type: "text", text: JSON.stringify({ state: "Wisconsin", measures: [] }) }],
  };
  expect(unwrapMcpResult(envelope)).toEqual({ state: "Wisconsin", measures: [] });
});

test("returns an already-parsed plain object unchanged", () => {
  const obj = { state: "Illinois", candidates: [{ name: "Jane" }] };
  expect(unwrapMcpResult(obj)).toEqual(obj);
});

test("parses a bare JSON string into an object", () => {
  expect(unwrapMcpResult('{"query":"moore","candidates":[]}')).toEqual({
    query: "moore",
    candidates: [],
  });
});

test("returns null for an MCP error envelope", () => {
  const errorEnvelope = { content: [{ type: "text", text: "boom" }], isError: true };
  expect(unwrapMcpResult(errorEnvelope)).toBeNull();
});

test("returns null when the envelope text is not valid JSON", () => {
  const malformed = { content: [{ type: "text", text: "not json at all" }] };
  expect(unwrapMcpResult(malformed)).toBeNull();
});

test("returns null for null or undefined input", () => {
  expect(unwrapMcpResult(null)).toBeNull();
  expect(unwrapMcpResult(undefined)).toBeNull();
});

test("returns null for a JSON string that parses to a non-object", () => {
  expect(unwrapMcpResult("42")).toBeNull();
  expect(unwrapMcpResult('"just a string"')).toBeNull();
});
