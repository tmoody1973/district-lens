import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { EvidenceCard } from "../EvidenceCard";

const mockEvidence = {
  candidateName: "Gwen Moore",
  issue: "housing",
  answer:
    "Moore supports the Housing Affordability Act and has co-sponsored legislation to expand affordable housing funding in urban areas.",
  sources: [
    {
      title: "Ballotpedia",
      url: "https://ballotpedia.org/Gwen_Moore",
      date: "2026-03-14",
      snippet: "",
    },
  ],
};

test("renders issue tag as uppercase pill", () => {
  render(<EvidenceCard evidence={mockEvidence} />);
  expect(screen.getByText("HOUSING")).toBeInTheDocument();
});

test("renders candidate name", () => {
  render(<EvidenceCard evidence={mockEvidence} />);
  expect(screen.getByText("Gwen Moore")).toBeInTheDocument();
});

test("renders clickable source URL", () => {
  render(<EvidenceCard evidence={mockEvidence} />);
  expect(screen.getByRole("link", { name: "Ballotpedia" })).toHaveAttribute(
    "href",
    "https://ballotpedia.org/Gwen_Moore"
  );
});
