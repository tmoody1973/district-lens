import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { IssueAccordion } from "../IssueAccordion";
import type { EvidenceCard } from "@/types/agent-state";

const housingCards: EvidenceCard[] = [
  {
    candidateName: "Gwen Moore",
    issue: "housing",
    answer: "Backs the Housing Affordability Act.",
    sources: [{ title: "Campaign site", url: "https://x", date: "2026-03-01", snippet: "" }],
  },
  {
    candidateName: "Tim Rogers",
    issue: "housing",
    answer: "Favors local zoning control over federal housing funding.",
    sources: [{ title: "Press release", url: "https://y", date: "2026-02-10", snippet: "" }],
  },
];

test("renders the issue title once at the section level", () => {
  render(<IssueAccordion issue="housing" cards={housingCards} />);
  expect(screen.getByText("HOUSING")).toBeInTheDocument();
});

test("renders every candidate's statement side by side", () => {
  render(<IssueAccordion issue="housing" cards={housingCards} defaultOpen />);
  expect(screen.getByText("Gwen Moore")).toBeInTheDocument();
  expect(screen.getByText("Tim Rogers")).toBeInTheDocument();
});

test("honestly renders a no-statement card without inventing a position", () => {
  const noStatement: EvidenceCard[] = [
    {
      candidateName: "Gwen Moore",
      issue: "immigration",
      answer: "NO DIRECT STATEMENT FOUND",
      sources: [],
    },
  ];
  render(<IssueAccordion issue="immigration" cards={noStatement} defaultOpen />);
  expect(screen.getByText("no statement found")).toBeInTheDocument();
});
