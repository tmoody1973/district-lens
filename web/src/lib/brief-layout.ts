import type { CandidateCard, DistrictLensState, FinanceSummary } from "@/types/agent-state";
import { parseRaceKey } from "./race-key";
import { stateName } from "./states";
import { fmtMoney } from "./format";

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

const PHASE_LABEL: Record<RacePhase, string> = {
  primary: "Primary · winner advances to November",
  called: "Nominee called · general",
  runoff: "Runoff pending",
  contested: "Outcome contested",
};

const PARTY_NOUN: Record<string, string> = { DEM: "Democrat", REP: "Republican", IND: "Independent" };
const PARTY_LETTER: Record<string, string> = { DEM: "D", REP: "R", IND: "I" };

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}

function fieldSummary(phase: RacePhase, candidates: CandidateCard[]): string {
  if (phase === "called") {
    const letters = [...new Set(candidates.map((c) => PARTY_LETTER[c.party.toUpperCase()] ?? "?"))];
    return letters.length > 1 ? `${letters.join(" vs ")} matchup` : "General matchup";
  }
  const counts = new Map<string, number>();
  for (const c of candidates) {
    const key = c.party.toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ordered = ["DEM", "REP", ...[...counts.keys()].filter((k) => k !== "DEM" && k !== "REP").sort()];
  const segments = ordered
    .filter((k) => counts.has(k))
    .map((k) => plural(counts.get(k)!, PARTY_NOUN[k] ?? "Other"));
  return segments.length > 0 ? segments.join(" · ") : "No candidates yet";
}

function moneySummary(finance: FinanceSummary[]): string {
  const withReceipts = finance.filter((f) => f.receipts != null);
  if (withReceipts.length === 0) return "Finance data not yet available";
  const total = withReceipts.reduce((sum, f) => sum + (f.receipts ?? 0), 0);
  const top = withReceipts.reduce((a, b) => ((b.receipts ?? 0) > (a.receipts ?? 0) ? b : a));
  return `${fmtMoney(total)} raised · top ${lastName(top.name)} ${fmtMoney(top.receipts)}`;
}

export function buildHeaderFacts(state: DistrictLensState, raceStatus: RaceStatus | null): HeaderFacts {
  const parsed = parseRaceKey(state.currentRaceKey);
  const phase = derivePhase(raceStatus);
  const seatType = deriveSeatType(state.candidates);
  const incumbent = state.candidates.find((c) => c.status === "incumbent");

  if (!parsed) {
    return {
      officeLabel: "Race", title: "Race", phase, phaseLabel: PHASE_LABEL[phase],
      seatType, seatLabel: incumbent ? `Incumbent — ${incumbent.name} (${incumbent.party})` : "Open seat",
      fieldSummary: fieldSummary(phase, state.candidates), moneySummary: moneySummary(state.finance),
      stakesLabel: "", competitivenessAvailable: false,
    };
  }

  const isHouse = parsed.office === "house";
  const officeLabel = isHouse ? "U.S. House" : "U.S. Senate";
  const sName = stateName(parsed.state);
  const districtLabel =
    parsed.district === "00" ? "At-Large" : parsed.district ? `District ${Number(parsed.district)}` : "";
  const title = isHouse ? `${officeLabel} — ${sName} ${districtLabel}`.trim() : `${officeLabel} — ${sName}`;
  const stakesLabel = isHouse
    ? "1 of 435 U.S. House seats"
    : "1 of 100 — chamber control + judicial confirmations";

  return {
    officeLabel, title, phase, phaseLabel: PHASE_LABEL[phase], seatType,
    seatLabel: incumbent ? `Incumbent — ${incumbent.name} (${incumbent.party})` : "Open seat",
    fieldSummary: fieldSummary(phase, state.candidates), moneySummary: moneySummary(state.finance),
    stakesLabel, competitivenessAvailable: false,
  };
}
