import { test, expect } from "vitest";
import { canonicalizeIssue } from "../issues";

test("merges housing variants into one canonical issue", () => {
  expect(canonicalizeIssue("HOUSING AND HOMELESSNESS")).toBe("Housing");
  expect(canonicalizeIssue("housing")).toBe("Housing");
});

test("merges economy variants into one canonical issue", () => {
  expect(canonicalizeIssue("ECONOMY AND TAXES")).toBe("Economy and Jobs");
  expect(canonicalizeIssue("economy and jobs")).toBe("Economy and Jobs");
  expect(canonicalizeIssue("Economy")).toBe("Economy and Jobs");
});

test("merges healthcare spelling variants", () => {
  expect(canonicalizeIssue("HEALTHCARE")).toBe("Health Care");
  expect(canonicalizeIssue("health care")).toBe("Health Care");
});

test("unknown issues pass through with original casing trimmed", () => {
  expect(canonicalizeIssue("  Tribal Sovereignty ")).toBe("Tribal Sovereignty");
});
