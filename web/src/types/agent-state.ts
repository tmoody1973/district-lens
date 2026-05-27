export type ResearchStage =
  | "idle"
  | "district"
  | "candidates"
  | "mcp"
  | "finance"
  | "legislation"
  | "positions"
  | "complete";

export type StepStatus = "pending" | "running" | "done";

export interface BriefStep {
  label: string;
  status: StepStatus;
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
  issue: string;
  answer: string;
  // How strong the evidence is: "direct_quote" | "reported" | "questionnaire" |
  // "voting_record". Optional for backward-compat with cards that predate the field.
  evidenceType?: string;
  sources: Array<{ title: string; url: string; date: string | null; snippet: string }>;
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
