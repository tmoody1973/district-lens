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
