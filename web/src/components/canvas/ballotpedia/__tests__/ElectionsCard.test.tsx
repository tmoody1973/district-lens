import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ElectionsCard } from "../ElectionsCard";

const data = {
  state: "Wisconsin",
  year: 2026,
  elections: [
    {
      title: "U.S. House Wisconsin District 4",
      url: "https://ballotpedia.org/WI04",
      date: "November 3, 2026",
      office_type: "U.S. House",
      candidates_preview: [
        { name: "Gwen Moore", url: "https://ballotpedia.org/Gwen_Moore" },
        { name: "Tim Rogers", url: "https://ballotpedia.org/Tim_Rogers" },
      ],
    },
    {
      title: "Offices on the ballot",
      url: "https://ballotpedia.org/x",
      date: "November 3, 2026",
      office_type: "other",
      candidates_preview: [],
    },
  ],
  sources: ["https://ballotpedia.org/Wisconsin_elections_2026"],
};

test("renders each race with office_type badge, date, and preview names", () => {
  render(<ElectionsCard data={data} />);
  expect(screen.getByText(/U.S. House Wisconsin District 4/)).toBeInTheDocument();
  expect(screen.getByText(/Gwen Moore/)).toBeInTheDocument();
  expect(screen.getByText(/November 3, 2026/)).toBeInTheDocument();
  expect(screen.getByText(/verify before citing/i)).toBeInTheDocument();
});

test("filters section-header noise rows", () => {
  render(<ElectionsCard data={data} />);
  expect(screen.queryByText("Offices on the ballot")).not.toBeInTheDocument();
});
