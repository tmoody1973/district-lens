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

test("renders status_message when non-null", () => {
  const steps = [{ label: "District resolved", status: "running" as const }];
  render(
    <ReceiptProgress
      steps={steps}
      briefStartedAt={Date.now()}
      statusMessage="Looking up district for 123 Main St…"
    />
  );
  expect(screen.getByTestId("status-message")).toBeInTheDocument();
  expect(screen.getByText("Looking up district for 123 Main St…")).toBeInTheDocument();
});

test("does not render status message when statusMessage is null", () => {
  const steps = [{ label: "District resolved", status: "running" as const }];
  render(
    <ReceiptProgress steps={steps} briefStartedAt={Date.now()} statusMessage={null} />
  );
  expect(screen.queryByTestId("status-message")).not.toBeInTheDocument();
});

test("shows MongoDB badge when steps are present", () => {
  const steps = [{ label: "District resolved", status: "running" as const }];
  render(<ReceiptProgress steps={steps} briefStartedAt={Date.now()} />);
  expect(screen.getByText(/MongoDB/)).toBeInTheDocument();
});

test("horizontal mode renders a condensed strip with step labels", () => {
  const steps = [
    { label: "District resolved", status: "done" as const },
    { label: "Candidates loaded", status: "running" as const },
  ];
  render(<ReceiptProgress steps={steps} briefStartedAt={Date.now() - 5000} horizontal />);
  expect(screen.getByText("Building")).toBeInTheDocument();
  expect(screen.getByText("Candidates loaded")).toBeInTheDocument();
  // The verbose "Building brief" header and MongoDB badge are desktop-only.
  expect(screen.queryByText(/MongoDB/)).not.toBeInTheDocument();
});
