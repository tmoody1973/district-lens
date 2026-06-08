import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CandidateSearchCard } from "../CandidateSearchCard";

const data = {
  query: { name: "moore", state: "Wisconsin", office: "", year: 2026 },
  candidates: [
    {
      name: "Gwen Moore",
      url: "https://ballotpedia.org/Gwen_Moore",
      party: "DEM",
      office: "U.S. House Wisconsin District 4",
      state: "Wisconsin",
      status: "found",
      snippet: "Incumbent representative since 2005.",
    },
  ],
  sources: ["https://ballotpedia.org/search"],
};

test("renders each hit with name link, office/state, and snippet", () => {
  render(<CandidateSearchCard data={data} />);
  const link = screen.getByRole("link", { name: /Gwen Moore/ });
  expect(link).toHaveAttribute("href", "https://ballotpedia.org/Gwen_Moore");
  expect(screen.getByText(/U.S. House Wisconsin District 4/)).toBeInTheDocument();
  expect(screen.getByText(/Incumbent representative/)).toBeInTheDocument();
  expect(screen.getByText(/verify before citing/i)).toBeInTheDocument();
});

test("degrades to a no-results shell on empty candidates", () => {
  render(<CandidateSearchCard data={{ ...data, candidates: [] }} />);
  expect(screen.getByText(/no results/i)).toBeInTheDocument();
});
