import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CandidateProfileCard } from "../CandidateProfileCard";

const base = {
  name: "Gwen Moore",
  url: "https://ballotpedia.org/Gwen_Moore",
  party: "DEM",
  office: "U.S. House Wisconsin District 4",
  state: "Wisconsin",
  bio: "Representative for Wisconsin's 4th district.",
  campaign_themes: "Healthcare access, voting rights, economic equity.",
  key_votes: [
    { bill: "H.R.1", position: "Yea", description: "For the People Act." },
  ],
  election_history: ["2024", "2022"],
  endorsements: ["AFL-CIO"],
};

test("renders name, party/office/state, bio, and themes with strong governance", () => {
  render(<CandidateProfileCard data={base} />);
  expect(screen.getByText("Gwen Moore")).toBeInTheDocument();
  expect(screen.getByText(/U.S. House Wisconsin District 4/)).toBeInTheDocument();
  expect(screen.getByText(/Representative for Wisconsin/)).toBeInTheDocument();
  expect(screen.getByText(/Healthcare access/)).toBeInTheDocument();
  expect(screen.getByText(/not a candidate statement/i)).toBeInTheDocument();
});

test("omits key_votes and endorsements sections when absent (honest-empty)", () => {
  const sparse = { ...base, key_votes: [], endorsements: [] };
  render(<CandidateProfileCard data={sparse} />);
  expect(screen.queryByText(/key votes/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/endorsements/i)).not.toBeInTheDocument();
});
