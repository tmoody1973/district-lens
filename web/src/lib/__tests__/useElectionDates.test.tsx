import { test, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useElectionDates } from "../useElectionDates";

afterEach(() => vi.restoreAllMocks());

test("returns null before the fetch resolves", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  const { result } = renderHook(() => useElectionDates("IL"));
  expect(result.current).toBeNull();
});

test("returns the parsed record after fetch resolves", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ state: "Illinois", state_abbreviation: "IL", primary: { date: "2026-03-17" }, general_election_date: "2026-11-03" }),
  })));
  const { result } = renderHook(() => useElectionDates("IL"));
  await waitFor(() => expect(result.current?.primary?.date).toBe("2026-03-17"));
});

test("returns null on a 404 / error body", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "no data" }) })));
  const { result } = renderHook(() => useElectionDates("ZZ"));
  await waitFor(() => expect(result.current).toBeNull());
});
