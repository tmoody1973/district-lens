import type { AppMode, CandidateCard, DistrictLensState, FinanceSummary } from "@/types/agent-state";
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
  const trimmed = name.trim();
  // FEC stores names as "Last, First" — the surname is before the comma.
  if (trimmed.includes(",")) return trimmed.split(",")[0].trim() || trimmed;
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1] || trimmed;
}

function fieldSummary(phase: RacePhase, candidates: CandidateCard[], winners: Record<string, string>): string {
  if (phase === "called") {
    const known = (parties: string[]) =>
      [...new Set(parties.map((p) => PARTY_LETTER[p.toUpperCase()]).filter((l): l is string => Boolean(l)))];
    const fromWinners = known(Object.keys(winners));
    const letters = fromWinners.length >= 2 ? fromWinners : known(candidates.map((c) => c.party));
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

// Ordered section plans keyed by mode × seat type. Sections absent from state
// are filtered out in buildSections.
const SECTION_PLANS: Record<AppMode, Record<SeatType, SectionPlan[]>> = {
  voter: {
    incumbent: [
      { id: "candidates", defaultOpen: true },
      { id: "record", defaultOpen: true },
      { id: "positions", defaultOpen: true },
      { id: "money", defaultOpen: false },
      { id: "news", defaultOpen: false },
    ],
    open: [
      { id: "candidates", defaultOpen: true },
      { id: "positions", defaultOpen: true },
      { id: "money", defaultOpen: false },
      { id: "news", defaultOpen: false },
    ],
  },
  journalist: {
    incumbent: [
      { id: "candidates", defaultOpen: true },
      { id: "money", defaultOpen: true },
      { id: "record", defaultOpen: true },
      { id: "positions", defaultOpen: false },
      { id: "news", defaultOpen: false },
    ],
    open: [
      { id: "candidates", defaultOpen: true },
      { id: "money", defaultOpen: true },
      { id: "positions", defaultOpen: true },
      { id: "news", defaultOpen: false },
    ],
  },
};

function isIncluded(id: SectionId, seatType: SeatType, state: DistrictLensState): boolean {
  switch (id) {
    case "candidates": return true;
    case "positions": return true;
    case "record":
      return seatType === "incumbent" && (state.legislation.length > 0 || state.votingRecord != null);
    case "money": return state.finance.length > 0;
    case "news": return state.candidates.length > 0 || state.news.length > 0;
  }
}

export function buildSections(mode: AppMode, seatType: SeatType, state: DistrictLensState): SectionPlan[] {
  return SECTION_PLANS[mode][seatType].filter((p) => isIncluded(p.id, seatType, state));
}

export function buildBriefLayout(state: DistrictLensState, raceStatus: RaceStatus | null): BriefLayout {
  const header = buildHeaderFacts(state, raceStatus);
  const sections = buildSections(state.mode, header.seatType, state);
  return { header, sections };
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
      fieldSummary: fieldSummary(phase, state.candidates, raceStatus?.winners ?? {}), moneySummary: moneySummary(state.finance),
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
    fieldSummary: fieldSummary(phase, state.candidates, raceStatus?.winners ?? {}), moneySummary: moneySummary(state.finance),
    stakesLabel, competitivenessAvailable: false,
  };
}
