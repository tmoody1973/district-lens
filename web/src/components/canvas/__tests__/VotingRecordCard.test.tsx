import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VotingRecordCard } from "../VotingRecordCard";
import type { VotingRecordSummary } from "@/types/agent-state";

const base: VotingRecordSummary = {
  memberName: "Jane Rep", congress: "119th", attendancePct: 97.5,
  partyLinePct: 92, votesCast: 390, votesMissed: 10, totalRollCalls: 400,
  asOfDate: "2026-05-20", sourceUrl: "https://www.congress.gov/roll-call-votes/119-2",
};

describe("VotingRecordCard", () => {
  it("renders attendance and party-line percentages", () => {
    render(<VotingRecordCard record={base} />);
    expect(screen.getByText(/97.5%/)).toBeInTheDocument();
    expect(screen.getByText(/92%/)).toBeInTheDocument();
    expect(screen.getByText(/10 missed/i)).toBeInTheDocument();
  });

  it("renders an honest gap when party-line is null", () => {
    render(<VotingRecordCard record={{ ...base, partyLinePct: null }} />);
    expect(screen.getByText(/not enough party-split votes/i)).toBeInTheDocument();
  });

  it("renders nothing when record is null", () => {
    const { container } = render(<VotingRecordCard record={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
