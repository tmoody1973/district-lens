import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DonorContributionsCard,
  type DonorRow,
} from "../DonorContributionsCard";

const klein: DonorRow = {
  name: "Klein, Dennis J",
  employer: "CD SMITH",
  occupation: "EXECUTIVE",
  city_state: "Milwaukee, WI",
  total: 6600,
  total_fmt: "$6.6K",
  transactions: 2,
  latest_date: "2025-09-22",
};

const tribe: DonorRow = {
  name: "Yocha Dehe Wintun Nation",
  employer: null,
  occupation: null,
  city_state: "Brooks, CA",
  total: 3500,
  total_fmt: "$3.5K",
  transactions: 1,
  latest_date: "2025-09-19",
};

test("loading state shows status message", () => {
  render(<DonorContributionsCard loading donors={[]} />);
  expect(screen.getByText(/Pulling FEC contribution records/i)).toBeInTheDocument();
});

test("renders donor names and formatted amounts", () => {
  render(<DonorContributionsCard candidate="Moore, Gwen S" donors={[klein, tribe]} />);
  expect(screen.getByText("Klein, Dennis J")).toBeInTheDocument();
  expect(screen.getByText("$6.6K")).toBeInTheDocument();
  expect(screen.getByText("$3.5K")).toBeInTheDocument();
});

test("shows candidate name in the header", () => {
  render(<DonorContributionsCard candidate="Moore, Gwen S" donors={[klein]} />);
  expect(screen.getByText("Moore, Gwen S")).toBeInTheDocument();
});

test("shows employer · occupation when present", () => {
  render(<DonorContributionsCard donors={[klein, tribe]} />);
  expect(screen.getByText(/CD SMITH · EXECUTIVE/i)).toBeInTheDocument();
});

test("shows contribution count only when more than one", () => {
  render(<DonorContributionsCard donors={[klein, tribe]} />);
  expect(screen.getByText(/2 contributions/i)).toBeInTheDocument();
  expect(screen.queryByText(/1 contributions/i)).not.toBeInTheDocument();
});

test("guardrail footer always visible", () => {
  render(<DonorContributionsCard donors={[klein]} />);
  expect(
    screen.getByText(/do not establish a candidate's policy positions/i),
  ).toBeInTheDocument();
});

test("guardrail footer visible even on empty state", () => {
  render(<DonorContributionsCard donors={[]} coverageNote="No itemized receipts." />);
  expect(
    screen.getByText(/do not establish a candidate's policy positions/i),
  ).toBeInTheDocument();
});

test("empty state renders coverage note", () => {
  render(<DonorContributionsCard donors={[]} coverageNote="No itemized receipts." />);
  expect(screen.getByText(/No itemized receipts/i)).toBeInTheDocument();
});

test("source footer shows retrieved date", () => {
  render(
    <DonorContributionsCard donors={[klein]} retrievedAt="2026-06-10T21:00:00+00:00" />,
  );
  expect(screen.getByText(/Source: FEC API · retrieved 2026-06-10/i)).toBeInTheDocument();
});
