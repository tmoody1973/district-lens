import { test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RaceTable } from "../RaceTable";

const races = [
  {
    raceKey: "2026-H-OH-01",
    state: "OH",
    office: "H",
    district: "01",
    incumbentName: "Steve Chabot",
    incumbentParty: "REP",
    incumbentReceipts: 2100000,
    topChallengerName: "Challenger A",
    topChallengerReceipts: 100000,
    financeGap: 2000000,
    pacPct: 78,
  },
  {
    raceKey: "2026-H-WI-04",
    state: "WI",
    office: "H",
    district: "04",
    incumbentName: "Gwen Moore",
    incumbentParty: "DEM",
    incumbentReceipts: 844000,
    topChallengerName: "Purnima Nath",
    topChallengerReceipts: 0,
    financeGap: 844000,
    pacPct: 61,
  },
];

test("renders race rows", () => {
  render(<RaceTable races={races} onRaceClick={vi.fn()} />);
  expect(screen.getByText("Steve Chabot")).toBeInTheDocument();
  expect(screen.getByText("Gwen Moore")).toBeInTheDocument();
});

test("calls onRaceClick with raceKey when row clicked", () => {
  const handler = vi.fn();
  render(<RaceTable races={races} onRaceClick={handler} />);
  fireEvent.click(screen.getByText("Steve Chabot"));
  expect(handler).toHaveBeenCalledWith("2026-H-OH-01");
});

test("sorts by finance gap descending by default", () => {
  render(<RaceTable races={races} onRaceClick={vi.fn()} />);
  const rows = screen.getAllByRole("row");
  expect(rows[1]).toHaveTextContent("Steve Chabot");
});
