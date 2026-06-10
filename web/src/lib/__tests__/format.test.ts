import { test, expect } from "vitest";
import { fmtMoney, fmtDate } from "@/lib/format";

test("fmtMoney formats millions", () => {
  expect(fmtMoney(1_500_000)).toBe("$1.5M");
});

test("fmtMoney formats thousands", () => {
  expect(fmtMoney(2_500)).toBe("$3K");
});

test("fmtMoney returns dash for null", () => {
  expect(fmtMoney(null)).toBe("—");
});

test("fmtDate produces a locale date string from an ISO timestamp", () => {
  const iso = "2026-06-09T12:00:00Z";
  expect(fmtDate(iso)).toBe(new Date(iso).toLocaleDateString());
});
