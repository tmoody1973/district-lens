"use client";
import { useEffect, useState } from "react";
import type { ElectionDatesRecord } from "./election-dates";

// Fetches 2026 election dates for a state. Returns null until the fetch resolves, on
// 404 (no data for the state), or on error. Tagged with the state code so a previous
// state's dates are never returned for the current one.
export function useElectionDates(stateCode: string | null): ElectionDatesRecord | null {
  const [data, setData] = useState<(ElectionDatesRecord & { forState: string }) | null>(null);

  useEffect(() => {
    if (!stateCode) return;
    let cancelled = false;
    fetch(`/api/election-dates?state=${encodeURIComponent(stateCode)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json && !json.error) {
          setData({ ...(json as ElectionDatesRecord), forState: stateCode });
        }
      })
      .catch(() => {
        /* no data yet — return null */
      });
    return () => {
      cancelled = true;
    };
  }, [stateCode]);

  if (!data || data.forState !== stateCode) return null;
  return data;
}
