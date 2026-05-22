import { test, expect } from "vitest";
import { fmtMoney } from "../CandidateCard";

test("null returns em dash", () => {
  expect(fmtMoney(null)).toBe("—");
});

test("sub-thousand returns dollar amount", () => {
  expect(fmtMoney(500)).toBe("$500");
});

test("thousands round correctly", () => {
  expect(fmtMoney(844000)).toBe("$844K");
  expect(fmtMoney(1500)).toBe("$2K");
});

test("millions format with one decimal", () => {
  expect(fmtMoney(1_500_000)).toBe("$1.5M");
  expect(fmtMoney(2_000_000)).toBe("$2.0M");
});
