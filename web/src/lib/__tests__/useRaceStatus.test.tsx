import { test, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useRaceStatus } from "../useRaceStatus";

afterEach(() => vi.restoreAllMocks());

test("returns null before the fetch resolves", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  const { result } = renderHook(() => useRaceStatus("2026-H-WI-03"));
  expect(result.current).toBeNull();
});

test("returns parsed status after fetch resolves", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ status: "confirmed", winners: { DEM: "Jane" }, confidence: 1, confirmationBasis: [], flaggedReason: null, resolvedAt: null, citation: null }),
  })));
  const { result } = renderHook(() => useRaceStatus("2026-H-WI-03"));
  await waitFor(() => expect(result.current?.status).toBe("confirmed"));
});

test("returns null on a 404 / error body", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "no status" }) })));
  const { result } = renderHook(() => useRaceStatus("2026-H-WI-99"));
  await waitFor(() => expect(result.current).toBeNull());
});

test("returns null for a 200 unresolved payload (no console-error 404s)", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ status: "unresolved" }) })));
  const { result } = renderHook(() => useRaceStatus("2026-H-WI-04"));
  await new Promise((r) => setTimeout(r, 50));
  expect(result.current).toBeNull();
});
