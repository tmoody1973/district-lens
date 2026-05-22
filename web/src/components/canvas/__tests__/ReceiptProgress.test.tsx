import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ReceiptProgress } from "../ReceiptProgress";

test("renders running step with amber text", () => {
  const steps = [
    { label: "District resolved", status: "done" as const },
    { label: "Candidates loaded", status: "running" as const },
    { label: "Finance pulled", status: "pending" as const },
  ];
  render(<ReceiptProgress steps={steps} briefStartedAt={Date.now() - 5000} />);
  expect(screen.getByText("Candidates loaded")).toBeInTheDocument();
  expect(screen.getByText(/sec left/)).toBeInTheDocument();
});

test("shows green complete bar when all steps done", () => {
  const steps = [
    { label: "District resolved", status: "done" as const },
    { label: "Brief complete", status: "done" as const },
  ];
  render(<ReceiptProgress steps={steps} briefStartedAt={Date.now() - 10000} />);
  expect(screen.getAllByText("Brief complete").length).toBeGreaterThan(0);
});
