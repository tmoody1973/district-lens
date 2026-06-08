import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BallotpediaCardShell } from "../BallotpediaCardShell";

test("renders the discovery chip and governance footer", () => {
  render(
    <BallotpediaCardShell title="Ballot Measures">
      <p>child content</p>
    </BallotpediaCardShell>,
  );
  expect(screen.getByText(/Ballotpedia · discovery/i)).toBeInTheDocument();
  expect(screen.getByText(/verify before citing/i)).toBeInTheDocument();
  expect(screen.getByText("child content")).toBeInTheDocument();
});

test("strong governance variant carries a firmer warning", () => {
  render(
    <BallotpediaCardShell title="Candidate Profile" governanceStrength="strong">
      <p>profile</p>
    </BallotpediaCardShell>,
  );
  expect(screen.getByText(/not a candidate statement/i)).toBeInTheDocument();
});
