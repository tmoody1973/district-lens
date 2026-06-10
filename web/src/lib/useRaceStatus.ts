"use client";
import { useEffect, useState } from "react";
import type { RaceStatus } from "./brief-layout";

// Fetches the resolved nominee status for a race. Returns null until the fetch
// resolves, on 404 (race not resolved), or on error. Tagged with the race key
// so a previous race's status is never returned for the current one.
export function useRaceStatus(raceKey: string | null): RaceStatus | null {
  const [data, setData] = useState<(RaceStatus & { forKey: string }) | null>(null);

  useEffect(() => {
    if (!raceKey) return;
    let cancelled = false;
    fetch(`/api/race/status?race_key=${encodeURIComponent(raceKey)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json && !json.error && json.status !== "unresolved") {
          setData({ ...(json as RaceStatus), forKey: raceKey });
        }
      })
      .catch(() => {
        /* no status yet — return null */
      });
    return () => {
      cancelled = true;
    };
  }, [raceKey]);

  if (!data || data.forKey !== raceKey) return null;
  return data;
}
