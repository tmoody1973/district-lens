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

test("short direct quote gets 'direct quote' confidence", () => {
  const shortQuote = {
    candidateName: "Test",
    issue: "housing",
    answer: '"I support this bill." — Rep. Moore',
    sources: [],
  };
  render(<EvidenceCard evidence={shortQuote} />);
  expect(screen.getByText("direct quote")).toBeInTheDocument();
});

test("long answer without quotes gets 'paraphrase' confidence", () => {
  const paraphrase = {
    candidateName: "Test",
    issue: "housing",
    answer: "Moore supports the Housing Affordability Act and has co-sponsored legislation to expand affordable housing funding in urban areas across Wisconsin.",
    sources: [],
  };
  render(<EvidenceCard evidence={paraphrase} />);
  expect(screen.getByText("paraphrase")).toBeInTheDocument();
});

test("short answer without quotes gets 'no statement found'", () => {
  const noStatement = {
    candidateName: "Test",
    issue: "climate",
    answer: "No record found.",
    sources: [],
  };
  render(<EvidenceCard evidence={noStatement} />);
  expect(screen.getByText("no statement found")).toBeInTheDocument();
});

test("answer containing 'no direct statement' gets 'no statement found'", () => {
  const noEvidence = {
    candidateName: "Test",
    issue: "healthcare",
    answer: "I found no direct statement from this candidate on healthcare in indexed sources.",
    sources: [],
  };
  render(<EvidenceCard evidence={noEvidence} />);
  expect(screen.getByText("no statement found")).toBeInTheDocument();
});
