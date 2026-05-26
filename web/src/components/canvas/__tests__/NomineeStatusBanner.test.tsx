import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NomineeStatusBanner } from "../NomineeStatusBanner";
import type { RaceStatus } from "@/lib/brief-layout";

const status = (over: Partial<RaceStatus>): RaceStatus => ({
  status: "provisional", winners: {}, confidence: null, confirmationBasis: [],
  flaggedReason: null, resolvedAt: null, citation: null, ...over,
});

test("renders nothing when status is null", () => {
  const { container } = render(<NomineeStatusBanner status={null} />);
  expect(container).toBeEmptyDOMElement();
});

test("renders a confirmed nominee", () => {
  render(<NomineeStatusBanner status={status({ status: "confirmed", winners: { DEM: "Jane Doe" }, confirmationBasis: ["nbc_decision_desk"] })} />);
  expect(screen.getByText(/Nominee called/i)).toBeInTheDocument();
  expect(screen.getByText("Jane Doe")).toBeInTheDocument();
});

test("renders a not-yet-called provisional state", () => {
  render(<NomineeStatusBanner status={status({ status: "provisional" })} />);
  expect(screen.getByText(/Not yet called/i)).toBeInTheDocument();
});
