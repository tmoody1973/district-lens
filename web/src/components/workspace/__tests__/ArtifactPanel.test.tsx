import { test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/canvas/RaceCanvas", () => ({
  RaceCanvas: ({ state }: { state: { currentRaceKey: string | null } }) => (
    <div data-testid="race-canvas">{state.currentRaceKey}</div>
  ),
}));

import { ArtifactPanel } from "../ArtifactPanel";
import { DEFAULT_STATE, type DistrictLensState } from "@/types/agent-state";

const state = (over: Partial<DistrictLensState>): DistrictLensState => ({
  ...DEFAULT_STATE,
  currentRaceKey: "2026-H-WI-04",
  ...over,
});

test("no state renders the provided empty state", () => {
  render(<ArtifactPanel state={null} title={null} isDrafting={false} emptyState={<p>start here</p>} />);
  expect(screen.getByText("start here")).toBeInTheDocument();
  expect(screen.getByText("No artifact open")).toBeInTheDocument();
});

test("drafting shows the building badge and receipt strip", () => {
  render(
    <ArtifactPanel
      state={state({ stage: "finance", briefStartedAt: Date.now() })}
      title="U.S. House · WI-04"
      isDrafting
      emptyState={<p>start here</p>}
    />,
  );
  expect(screen.getByText("building…")).toBeInTheDocument();
  expect(screen.getAllByText(/Finance pulled/i).length).toBeGreaterThanOrEqual(1);
  expect(screen.getByTestId("race-canvas")).toBeInTheDocument();
});

test("complete brief renders title and RaceCanvas without the building badge", () => {
  render(
    <ArtifactPanel
      state={state({ stage: "complete" })}
      title="U.S. House · WI-04"
      isDrafting={false}
      emptyState={<p>start here</p>}
    />,
  );
  expect(screen.getByText("U.S. House · WI-04")).toBeInTheDocument();
  expect(screen.queryByText("building…")).not.toBeInTheDocument();
  expect(screen.getByTestId("race-canvas")).toHaveTextContent("2026-H-WI-04");
});
