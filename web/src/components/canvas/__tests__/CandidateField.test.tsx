import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CandidateField } from "../CandidateField";
import type { CandidateCard } from "@/types/agent-state";

const mk = (name: string, party: string, status = "challenger"): CandidateCard => ({
  candidateId: name, name, party, status, photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-03",
});

test("primary phase groups by party with column headings", () => {
  render(<CandidateField candidates={[mk("Ann", "DEM"), mk("Bob", "REP")]} financeByCandidate={{}} phase="primary" />);
  expect(screen.getByText(/Democratic/i)).toBeInTheDocument();
  expect(screen.getByText(/Republican/i)).toBeInTheDocument();
  expect(screen.getByText("Ann")).toBeInTheDocument();
  expect(screen.getByText("Bob")).toBeInTheDocument();
});

test("called phase renders a flat field (no party headings)", () => {
  render(<CandidateField candidates={[mk("Ann", "DEM", "incumbent"), mk("Bob", "REP")]} financeByCandidate={{}} phase="called" />);
  expect(screen.queryByText(/Democratic primary/i)).not.toBeInTheDocument();
  expect(screen.getByText("Ann")).toBeInTheDocument();
  expect(screen.getByText("Bob")).toBeInTheDocument();
});
