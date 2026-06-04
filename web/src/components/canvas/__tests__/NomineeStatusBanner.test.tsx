import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NomineeStatusBanner } from "../NomineeStatusBanner";
import type { RaceStatus } from "@/lib/brief-layout";
import type { CandidateCard, PartyCode } from "@/types/agent-state";

const status = (over: Partial<RaceStatus>): RaceStatus => ({
  status: "provisional", winners: {}, confidence: null, confirmationBasis: [],
  flaggedReason: null, resolvedAt: null, citation: null, ...over,
});

const winner = (party: PartyCode, name: string, voteSharePct: number): CandidateCard => ({
  candidateId: name, name, party, status: "open_seat",
  photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-IL-07",
  isPrimaryWinner: true, voteSharePct,
});

test("renders nothing when status is null", () => {
  const { container } = render(<NomineeStatusBanner status={null} />);
  expect(container).toBeEmptyDOMElement();
});

test("renders a confirmed nominee", () => {
  render(<NomineeStatusBanner status={status({ status: "confirmed", winners: { DEM: "Jane Doe" }, confirmationBasis: ["nbc_decision_desk"] })} />);
  expect(screen.getByText(/Nominee called/i)).toBeInTheDocument();
  expect(screen.getByText("Jane Doe")).toBeInTheDocument();
});

test("renders a not-yet-called provisional state when no card winners exist", () => {
  render(<NomineeStatusBanner status={status({ status: "provisional" })} candidates={[]} />);
  expect(screen.getByText(/Not yet called/i)).toBeInTheDocument();
});

test("relabels provisional as projected when cards carry NBC winners", () => {
  render(
    <NomineeStatusBanner
      status={status({ status: "provisional" })}
      candidates={[winner("DEM", "Jane Koppie", 65.2)]}
    />,
  );
  expect(screen.getByText(/Projected/i)).toBeInTheDocument();
  expect(screen.queryByText(/Not yet called/i)).not.toBeInTheDocument();
});

test("projected-from-cards banner lists each NBC winner and party", () => {
  render(
    <NomineeStatusBanner
      status={status({ status: "provisional" })}
      candidates={[winner("DEM", "Jane Koppie", 65.2)]}
    />,
  );
  expect(screen.getByText("Jane Koppie")).toBeInTheDocument();
  expect(screen.getByText(/\(DEM\)/)).toBeInTheDocument();
});

test("projected-from-cards banner says it is not an official call", () => {
  render(
    <NomineeStatusBanner
      status={status({ status: "provisional" })}
      candidates={[winner("DEM", "Jane Koppie", 65.2)]}
    />,
  );
  expect(screen.getByText(/not an official call/i)).toBeInTheDocument();
});

test("card winners do not turn a provisional race into a green official call", () => {
  render(
    <NomineeStatusBanner
      status={status({ status: "provisional" })}
      candidates={[winner("DEM", "Jane Koppie", 65.2)]}
    />,
  );
  expect(screen.queryByText(/Nominee called/i)).not.toBeInTheDocument();
});
