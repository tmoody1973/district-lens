import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BallotMeasuresCard } from "../BallotMeasuresCard";

const data = {
  state: "Wisconsin",
  year: 2026,
  measures: [
    {
      title: "Question 1",
      type: "Constitutional amendment",
      subject: "Elections; Voting",
      description: "Photo ID requirement to vote.",
      status: "on_ballot",
      url: "https://ballotpedia.org/Q1",
    },
    {
      title: "Question 2",
      type: "Referendum",
      subject: "Taxes",
      description: "Property tax cap.",
      status: "on_ballot",
      url: "https://ballotpedia.org/Q2",
    },
  ],
  sources: ["https://ballotpedia.org/Wisconsin_2026_ballot_measures"],
};

test("renders measures grouped by first subject token with linked titles", () => {
  render(<BallotMeasuresCard data={data} />);
  expect(screen.getByText("Elections")).toBeInTheDocument();
  expect(screen.getByText("Taxes")).toBeInTheDocument();
  const link = screen.getByRole("link", { name: /Question 1/ });
  expect(link).toHaveAttribute("href", "https://ballotpedia.org/Q1");
  expect(screen.getByText(/Photo ID requirement/)).toBeInTheDocument();
  expect(screen.getByText(/verify before citing/i)).toBeInTheDocument();
});

test("falls back to a single bucket when subject is absent", () => {
  const noSubject = {
    ...data,
    measures: [{ ...data.measures[0], subject: undefined }],
  };
  render(<BallotMeasuresCard data={noSubject} />);
  expect(screen.getByText(/Question 1/)).toBeInTheDocument();
});

test("degrades to a no-results shell on empty measures", () => {
  render(<BallotMeasuresCard data={{ ...data, measures: [] }} />);
  expect(screen.getByText(/no results/i)).toBeInTheDocument();
  expect(screen.getByText(/verify before citing/i)).toBeInTheDocument();
});
