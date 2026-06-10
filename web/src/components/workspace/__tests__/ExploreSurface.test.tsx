import { test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExploreSurface } from "@/components/workspace/ExploreSurface";
import type { RaceRow } from "@/types/agent-state";

// USMap pulls in topojson + d3 — substitute a lightweight stand-in.
vi.mock("@/components/map/USMap", () => ({
  USMap: ({ onStateClick }: { onStateClick: (code: string) => void }) => (
    <button type="button" onClick={() => onStateClick("WI")}>
      mock-us-map
    </button>
  ),
}));

const RACE: RaceRow = {
  raceKey: "2026-H-WI-04",
  state: "WI",
  office: "house",
  district: "04",
  incumbentName: "Moore, Gwen",
  incumbentParty: "DEM",
  incumbentReceipts: 500000,
  topChallengerName: null,
  topChallengerReceipts: null,
  financeGap: 500000,
  pacPct: 40,
};

test("renders the address input with build action", () => {
  render(
    <ExploreSurface
      onSubmitAddress={() => {}}
      onStateClick={() => {}}
      onRaceClick={() => {}}
      mapFocus={null}
      stateRaces={[]}
    />,
  );
  expect(screen.getByLabelText("Street address or ZIP code")).toBeDefined();
  expect(screen.getByRole("button", { name: "Build brief" })).toBeDefined();
});

test("shows the explore hint while no state is selected", () => {
  render(
    <ExploreSurface
      onSubmitAddress={() => {}}
      onStateClick={() => {}}
      onRaceClick={() => {}}
      mapFocus={null}
      stateRaces={[]}
    />,
  );
  expect(screen.getByText(/click a state on the map/i)).toBeDefined();
});

test("renders the race table once state races exist", () => {
  render(
    <ExploreSurface
      onSubmitAddress={() => {}}
      onStateClick={() => {}}
      onRaceClick={() => {}}
      mapFocus="WI"
      stateRaces={[RACE]}
    />,
  );
  expect(screen.getByText(/1 races/i)).toBeDefined();
  expect(screen.queryByText(/click a state on the map/i)).toBeNull();
});

test("renders before the coagent state hydrates (stateRaces undefined)", () => {
  // Pre-hydration, useCoAgent can hand out a state whose fields are missing.
  // The old voter empty-state never read stateRaces; ExploreSurface renders
  // at rest for everyone, so it must tolerate the gap — reading .length on
  // undefined here crashed /w outright (rev 00070).
  render(
    <ExploreSurface
      onSubmitAddress={() => {}}
      onStateClick={() => {}}
      onRaceClick={() => {}}
      mapFocus={null}
      stateRaces={undefined}
    />,
  );
  expect(screen.getByText(/click a state on the map/i)).toBeDefined();
});

test("map state clicks propagate", () => {
  const onStateClick = vi.fn();
  render(
    <ExploreSurface
      onSubmitAddress={() => {}}
      onStateClick={onStateClick}
      onRaceClick={() => {}}
      mapFocus={null}
      stateRaces={[]}
    />,
  );
  fireEvent.click(screen.getByText("mock-us-map"));
  expect(onStateClick).toHaveBeenCalledWith("WI");
});
