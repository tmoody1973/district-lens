import type { CandidateCard } from "@/types/agent-state";

export type RacePhase = "primary" | "called" | "runoff" | "contested";
export type SeatType = "incumbent" | "open";
export type SectionId = "candidates" | "record" | "positions" | "money" | "news";

export interface RaceStatus {
  status: string;
  winners: Record<string, string>;
  confidence: number | null;
  confirmationBasis: string[];
  flaggedReason: string | null;
  resolvedAt: string | null;
  citation: { url: string; publisher: string } | null;
}

export interface HeaderFacts {
  officeLabel: string;
  title: string;
  phase: RacePhase;
  phaseLabel: string;
  seatType: SeatType;
  seatLabel: string;
  fieldSummary: string;
  moneySummary: string;
  stakesLabel: string;
  competitivenessAvailable: false;
}

export interface SectionPlan { id: SectionId; defaultOpen: boolean }
export interface BriefLayout { header: HeaderFacts; sections: SectionPlan[] }

export function derivePhase(status: RaceStatus | null): RacePhase {
  switch (status?.status) {
    case "confirmed": return "called";
    case "runoff_pending": return "runoff";
    case "contested": return "contested";
    default: return "primary";
  }
}

export function deriveSeatType(candidates: CandidateCard[]): SeatType {
  return candidates.some((c) => c.status === "incumbent") ? "incumbent" : "open";
}
