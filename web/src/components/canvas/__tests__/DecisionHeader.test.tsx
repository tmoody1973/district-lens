import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DecisionHeader } from "../DecisionHeader";
import type { HeaderFacts } from "@/lib/brief-layout";

const facts: HeaderFacts = {
  officeLabel: "U.S. House", title: "U.S. House — Wisconsin District 3",
  phase: "primary", phaseLabel: "Primary · winner advances to November",
  seatType: "open", seatLabel: "Open seat", fieldSummary: "4 Democrats · 3 Republicans",
  moneySummary: "$4.3M raised · top Smith $2.1M", stakesLabel: "1 of 435 U.S. House seats",
  competitivenessAvailable: false,
};

test("renders title, phase, and all four fact cells", () => {
  render(<DecisionHeader facts={facts} />);
  expect(screen.getByText("U.S. House — Wisconsin District 3")).toBeInTheDocument();
  expect(screen.getByText(/Primary · winner advances/)).toBeInTheDocument();
  expect(screen.getByText("Open seat")).toBeInTheDocument();
  expect(screen.getByText("4 Democrats · 3 Republicans")).toBeInTheDocument();
  expect(screen.getByText("$4.3M raised · top Smith $2.1M")).toBeInTheDocument();
  expect(screen.getByText("1 of 435 U.S. House seats")).toBeInTheDocument();
});

test("always shows the honest competitiveness gap row", () => {
  render(<DecisionHeader facts={facts} />);
  expect(screen.getByText(/Competitiveness rating — not yet available/)).toBeInTheDocument();
});
