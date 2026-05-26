import { test, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RaceCanvas } from "../RaceCanvas";
import { DEFAULT_STATE, type DistrictLensState } from "@/types/agent-state";

afterEach(() => vi.restoreAllMocks());

const state = (over: Partial<DistrictLensState>): DistrictLensState => ({
  ...DEFAULT_STATE, stage: "complete", currentRaceKey: "2026-H-WI-03", ...over,
});

test("idle state shows the empty prompt", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  render(<RaceCanvas state={state({ stage: "idle", currentRaceKey: null })} />);
  expect(screen.getByText(/Enter an address or click a state/i)).toBeInTheDocument();
});

test("renders the decision header for a resolved race", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  render(<RaceCanvas state={state({
    candidates: [{ candidateId: "1", name: "Jane Doe", party: "DEM", status: "open_seat", photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-03" }],
  })} />);
  expect(screen.getByText("U.S. House — Wisconsin District 3")).toBeInTheDocument();
  expect(screen.getByText(/Competitiveness rating — not yet available/)).toBeInTheDocument();
});

test("shows the honest empty state when there are no positions", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  render(<RaceCanvas state={state({
    candidates: [{ candidateId: "1", name: "Jane Doe", party: "DEM", status: "open_seat", photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-03" }],
  })} />);
  expect(screen.getByText(/No position evidence found in indexed sources/i)).toBeInTheDocument();
});

test("journalist mode renders campaign finance before issue positions", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  render(<RaceCanvas state={state({
    mode: "journalist",
    candidates: [{ candidateId: "1", name: "Gwen Moore", party: "DEM", status: "incumbent", photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-03" }],
    finance: [{ candidateId: "1", name: "Gwen Moore", party: "DEM", receipts: 500000, disbursements: null, cashOnHand: null, individualContributions: null, pacContributions: null, coverageEndDate: null }],
  })} />);
  const money = screen.getByText("Campaign finance · FEC");
  const positions = screen.getByText("Issue positions · Perplexity");
  // positions must appear AFTER money in document order
  expect(money.compareDocumentPosition(positions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
