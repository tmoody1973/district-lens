export type ResearchStage =
  | "idle"
  | "district"
  | "candidates"
  | "mcp"
  | "finance"
  | "legislation"
  | "positions"
  | "archiving"
  | "complete";

export type StepStatus = "pending" | "running" | "done";

export interface BriefStep {
  label: string;
  status: StepStatus;
  source?: string; // tool/data source for this step, e.g. "MongoDB MCP", "FEC"
  detail?: string; // result summary once done, e.g. "4 filings"
}

export type AppMode = "voter" | "journalist";

export type PartyCode = "DEM" | "REP" | "IND" | string;

export type CandidateStatus =
  | "incumbent"
  | "challenger"
  | "open_seat"
  | string;

export type PhotoSource = "bioguide" | "ballotpedia" | "placeholder";

export interface CandidateCard {
  candidateId: string;
  name: string;
  party: PartyCode;
  status: CandidateStatus;
  photoUrl: string;
  photoSource: PhotoSource;
  raceKey: string;
  // Primary result from NBC's reconciled ballot roster (Phase 2). Present only on
  // races NBC covered; absent for FEC-only/uncontested races.
  voteSharePct?: number;
  isPrimaryWinner?: boolean;
}

export interface FinanceSummary {
  candidateId: string;
  name: string;
  party: PartyCode;
  receipts: number | null;
  disbursements: number | null;
  cashOnHand: number | null;
  individualContributions: number | null;
  pacContributions: number | null;
  coverageEndDate: string | null;
}

export interface BillRecord {
  billId: string;
  title: string;
  introducedDate: string | null;
  latestAction: string | null;
  memberName: string;
}

export interface VotingRecordSummary {
  memberName: string;
  congress: string;
  attendancePct: number;
  partyLinePct: number | null; // null = honest gap (no party-split votes yet)
  votesCast: number;
  votesMissed: number;
  totalRollCalls: number;
  asOfDate: string | null;
  sourceUrl: string;
}

export interface NewsItem {
  title: string;
  url: string;
  date: string | null;
  snippet: string;
  source: string;
}

export interface EvidenceCard {
  candidateName: string;
  // The owning candidate's stable id (Phase 1 T5) — lets the canvas tell which
  // candidates have positions vs. a no-footprint empty state. Optional for
  // backward-compat with cards that predate the field.
  candidateId?: string;
  issue: string;
  answer: string;
  // How strong the evidence is: "direct_quote" | "reported" | "questionnaire" |
  // "voting_record". Optional for backward-compat with cards that predate the field.
  evidenceType?: string;
  // Archival fields (Phase 1 T3/T4) — present only on sources the brief pipeline
  // archived via the evidence store. Optional for backward-compat with cards that
  // predate archival; un-archived sources render as plain links.
  sources: Array<{
    title: string;
    url: string;
    date: string | null;
    snippet: string;
    archived?: boolean;
    archivedAt?: string | null;
    sourceDocumentId?: string;
  }>;
}

export interface RaceRow {
  raceKey: string;
  state: string;
  office: string;
  district: string;
  incumbentName: string | null;
  incumbentParty: PartyCode | null;
  incumbentReceipts: number | null;
  topChallengerName: string | null;
  topChallengerReceipts: number | null;
  financeGap: number | null;
  pacPct: number | null;
}

export interface DistrictLensState {
  mode: AppMode;
  mapFocus: string | null;
  currentRaceKey: string | null;
  stage: ResearchStage;
  briefStartedAt: number | null;   // ms timestamp, set when stage leaves idle
  status_message: string | null;
  candidates: CandidateCard[];
  finance: FinanceSummary[];
  legislation: BillRecord[];
  votingRecord: VotingRecordSummary | null;
  news: NewsItem[];
  positions: EvidenceCard[];
  stateRaces: RaceRow[];
  comparisons: RaceRow[];
  briefMarkdown: string | null;
  briefReady: boolean;
}

export const DEFAULT_STATE: DistrictLensState = {
  mode: "voter",
  mapFocus: null,
  currentRaceKey: null,
  stage: "idle",
  briefStartedAt: null,
  status_message: null,
  candidates: [],
  finance: [],
  legislation: [],
  votingRecord: null,
  news: [],
  positions: [],
  stateRaces: [],
  comparisons: [],
  briefMarkdown: null,
  briefReady: false,
};
