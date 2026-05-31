import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FinanceToolCard, type FinanceToolCandidate } from "../FinanceToolCard";

const funded: FinanceToolCandidate = {
  name: "Gwen Moore",
  party: "DEM",
  status: "incumbent",
  candidate_id: "P001",
  raised: 844000,
  raised_fmt: "$844.0K",
  spent_fmt: "$500.0K",
  cash_on_hand_fmt: "$344.0K",
  individual_contributions: 328000,
  individual_contributions_fmt: "$328.0K",
  pac_contributions: 516000,
  pac_contributions_fmt: "$516.0K",
  coverage_end_date: "03/31/2026",
  has_finance: true,
};

const challenger: FinanceToolCandidate = {
  name: "Tim Rogers",
  party: "REP",
  status: "challenger",
  candidate_id: "P002",
  raised: 100000,
  raised_fmt: "$100.0K",
  individual_contributions: 100000,
  individual_contributions_fmt: "$100.0K",
  pac_contributions: 0,
  pac_contributions_fmt: "$0",
  coverage_end_date: "03/31/2026",
  has_finance: true,
};

const noFiling: FinanceToolCandidate = {
  name: "Pat Nofile",
  party: "IND",
  status: "challenger",
  candidate_id: "P003",
  has_finance: false,
};

test("loading state shows a spinner message, no candidates", () => {
  render(<FinanceToolCard loading candidates={[]} raceKey="2026-H-WI-04" />);
  expect(screen.getByText(/Pulling FEC finance data/i)).toBeInTheDocument();
});

test("renders each candidate's formatted raised total", () => {
  render(<FinanceToolCard candidates={[funded, challenger]} raceKey="2026-H-WI-04" />);
  expect(screen.getByText("$844.0K")).toBeInTheDocument();
  expect(screen.getByText("$100.0K")).toBeInTheDocument();
});

test("candidate with no FEC filing shows 'No FEC filing'", () => {
  render(<FinanceToolCard candidates={[funded, noFiling]} />);
  expect(screen.getByText(/No FEC filing/i)).toBeInTheDocument();
});

test("shows outraises Nx when leader at least doubles runner-up", () => {
  render(<FinanceToolCard candidates={[funded, challenger]} />);
  // 844k / 100k ≈ 8x
  expect(screen.getByText(/outraises/i)).toBeInTheDocument();
  expect(screen.getByText(/8×/)).toBeInTheDocument();
});

test("omits outraises line when race is close", () => {
  const close = { ...challenger, raised: 700000, raised_fmt: "$700.0K" };
  render(<FinanceToolCard candidates={[funded, close]} />);
  expect(screen.queryByText(/outraises/i)).not.toBeInTheDocument();
});

test("surfaces the coverage date as a citation stamp", () => {
  render(<FinanceToolCard candidates={[funded]} source="Source: FEC" />);
  expect(screen.getByText(/through 03\/31\/2026/i)).toBeInTheDocument();
});
