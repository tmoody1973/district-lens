"use client";

import { RaceTable } from "@/components/canvas/RaceTable";
import { USMap } from "@/components/map/USMap";
import { AddressSuggestInput } from "./AddressSuggestInput";
import type { RaceRow } from "@/types/agent-state";

/**
 * The unified workspace's explore surface (U1) — one surface for everyone:
 * the action carries the intent. Typing an address builds a brief; clicking a
 * state explores its races. Renders beneath the artifact list in the rail's
 * rest state.
 */
export function ExploreSurface({
  onSubmitAddress,
  onStateClick,
  onRaceClick,
  mapFocus,
  stateRaces,
}: {
  onSubmitAddress: (address: string) => void;
  onStateClick: (stateCode: string) => void;
  onRaceClick: (raceKey: string) => void;
  mapFocus: string | null;
  stateRaces: RaceRow[];
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-4 pt-4">
        <AddressSuggestInput onSubmit={onSubmitAddress} compact />
      </div>
      <div className="shrink-0 p-4">
        <USMap focusedState={mapFocus} onStateClick={onStateClick} heatmapData={stateRaces} />
      </div>
      {stateRaces.length > 0 ? (
        <RaceTable races={stateRaces} onRaceClick={onRaceClick} />
      ) : (
        <p className="px-4 pb-4 text-sm text-ink-faint">
          Click a state on the map to explore its 2026 races.
        </p>
      )}
    </div>
  );
}
