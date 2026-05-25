import { test, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { NomineeStatusBanner } from "../NomineeStatusBanner";

function mockFetch(payload: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => payload }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("confirmed → shows nominee-called badge, winner, NBC source + link", async () => {
  mockFetch({
    status: "confirmed",
    winners: { REP: "Rich McCormick" },
    confidence: 0.95,
    confirmationBasis: ["nbc_decision_desk", "results_page"],
    flaggedReason: "nbc_called",
    resolvedAt: "2026-05-25T17:00:00.000Z",
    citation: { url: "https://www.nbcnews.com/politics/2026-primary-elections/georgia-us-house-district-7-results", publisher: "nbcnews.com" },
  });
  render(<NomineeStatusBanner raceKey="2026-H-GA-07" />);
  expect(await screen.findByText("✓ Nominee called")).toBeInTheDocument();
  expect(screen.getByText("Rich McCormick")).toBeInTheDocument();
  expect(screen.getByText(/NBC Decision Desk/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "source" })).toHaveAttribute(
    "href",
    "https://www.nbcnews.com/politics/2026-primary-elections/georgia-us-house-district-7-results"
  );
});

test("runoff_pending → shows runoff badge, no winner", async () => {
  mockFetch({
    status: "runoff_pending",
    winners: {},
    confidence: 0.95,
    confirmationBasis: [],
    flaggedReason: "nbc_runoff",
    resolvedAt: null,
    citation: null,
  });
  render(<NomineeStatusBanner raceKey="2026-H-GA-07" />);
  expect(await screen.findByText("Runoff pending")).toBeInTheDocument();
});

test("provisional + projected reason → projected-unofficial badge with winner", async () => {
  mockFetch({
    status: "provisional",
    winners: { DEM: "Jane Doe" },
    confidence: 0.85,
    confirmationBasis: [],
    flaggedReason: "projected_unofficial_perplexity",
    resolvedAt: null,
    citation: { url: "https://apnews.com/x", publisher: "apnews.com" },
  });
  render(<NomineeStatusBanner raceKey="2026-H-ID-01" />);
  expect(await screen.findByText("Projected · unofficial")).toBeInTheDocument();
  expect(screen.getByText("Jane Doe")).toBeInTheDocument();
});

test("provisional (not projected) → 'Not yet called'", async () => {
  mockFetch({
    status: "provisional",
    winners: {},
    confidence: 0.0,
    confirmationBasis: [],
    flaggedReason: "no_winner_parsed, low_confidence",
    resolvedAt: null,
    citation: null,
  });
  render(<NomineeStatusBanner raceKey="2026-H-OR-05" />);
  expect(await screen.findByText("Not yet called")).toBeInTheDocument();
});

test("no status (404) → renders nothing", async () => {
  mockFetch({ error: "No status for X" }, false);
  const { container } = render(<NomineeStatusBanner raceKey="2026-H-XX-99" />);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});
