import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { CanVoteStrip } from "../CanVoteStrip";
import type { KeyDate } from "@/lib/election-dates";

const keyDates: KeyDate[] = [
  { label: "Primary", dateText: "Mar 17, 2026", completed: true },
  { label: "General", dateText: "Nov 3, 2026", completed: false },
];

test("names the state and exposes official logistics links that open safely", () => {
  render(<CanVoteStrip stateCode="WI" />);

  expect(screen.getByText(/Can you vote in Wisconsin\?/)).toBeInTheDocument();

  const registration = screen.getByRole("link", { name: /Check registration/ });
  expect(registration).toHaveAttribute("href", "https://vote.gov/");
  expect(registration).toHaveAttribute("target", "_blank");
  expect(registration).toHaveAttribute("rel", "noopener noreferrer");

  expect(screen.getByRole("link", { name: /full ballot/ })).toHaveAttribute(
    "href",
    "https://www.vote411.org/"
  );
});

test("renders a Key dates line with primary and general dates when provided", () => {
  render(<CanVoteStrip stateCode="IL" keyDates={keyDates} />);
  expect(screen.getByText(/Key dates/i)).toBeInTheDocument();
  expect(screen.getByText(/Mar 17, 2026/)).toBeInTheDocument();
  expect(screen.getByText(/Nov 3, 2026/)).toBeInTheDocument();
});

test("marks a past date as completed in the Key dates line", () => {
  render(<CanVoteStrip stateCode="IL" keyDates={keyDates} />);
  expect(screen.getByText(/completed/i)).toBeInTheDocument();
});

test("omits the Key dates line when no dates are provided", () => {
  render(<CanVoteStrip stateCode="IL" keyDates={[]} />);
  expect(screen.queryByText(/Key dates/i)).not.toBeInTheDocument();
  // logistics links still render
  expect(screen.getByRole("link", { name: /Check registration/ })).toBeInTheDocument();
});
