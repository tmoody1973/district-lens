import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CandidateCard } from "../CandidateCard";

const candidate = {
  candidateId: "P001",
  name: "Gwen Moore",
  party: "DEM",
  status: "incumbent",
  photoUrl: "",
  photoSource: "placeholder" as const,
  raceKey: "2026-H-WI-04",
};

const finance = {
  candidateId: "P001",
  name: "Gwen Moore",
  party: "DEM",
  receipts: 844000,
  disbursements: null,
  cashOnHand: null,
  individualContributions: 328000,
  pacContributions: 516000,
  coverageEndDate: null,
};

test("renders candidate name", () => {
  render(<CandidateCard candidate={candidate} finance={finance} />);
  expect(screen.getByText("Gwen Moore")).toBeInTheDocument();
});

test("renders finance total", () => {
  render(<CandidateCard candidate={candidate} finance={finance} />);
  expect(screen.getByText("$844K")).toBeInTheDocument();
});

test("renders PAC percentage", () => {
  render(<CandidateCard candidate={candidate} finance={finance} />);
  expect(screen.getByText(/61%/)).toBeInTheDocument();
});

// Phase 2: NBC primary result badge.
test("shows the primary vote share when present", () => {
  render(<CandidateCard candidate={{ ...candidate, voteSharePct: 39.17 }} />);
  expect(screen.getByText(/39\.2%/)).toBeInTheDocument();
  expect(screen.getByText(/primary/i)).toBeInTheDocument();
});

test("marks the primary winner", () => {
  render(
    <CandidateCard candidate={{ ...candidate, voteSharePct: 62, isPrimaryWinner: true }} />,
  );
  expect(screen.getByText(/won primary/i)).toBeInTheDocument();
});

test("renders no primary badge when there is no vote share", () => {
  render(<CandidateCard candidate={candidate} finance={finance} />);
  expect(screen.queryByText(/primary/i)).not.toBeInTheDocument();
});
