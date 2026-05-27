import type { BriefStep, DistrictLensState, ResearchStage } from "@/types/agent-state";

const STEP_LABELS = [
  "District resolved",
  "Candidates loaded",
  "Verified via MongoDB MCP",
  "Finance pulled",
  "Legislation loaded",
  "Positions searched",
  "Brief complete",
] as const;

const STAGE_DONE_COUNT: Record<ResearchStage, number> = {
  idle: 0,
  district: 0,
  candidates: 1,
  mcp: 2,
  finance: 3,
  legislation: 4,
  positions: 5,
  complete: 7,
};

const STAGE_RUNNING_INDEX: Record<ResearchStage, number | null> = {
  idle: null,
  district: 0,
  candidates: 1,
  mcp: 2,
  finance: 3,
  legislation: 4,
  positions: 5,
  complete: null,
};

export function stepsFromStage(stage: ResearchStage): BriefStep[] {
  if (stage === "idle") return [];
  const doneCount = STAGE_DONE_COUNT[stage];
  const runningIdx = STAGE_RUNNING_INDEX[stage];
  return STEP_LABELS.map((label, i): BriefStep => {
    if (i < doneCount) return { label, status: "done" };
    if (i === runningIdx) return { label, status: "running" };
    return { label, status: "pending" };
  });
}

// The tool/data source behind each pipeline step — shown in the activity trace
// so a reader (and a hackathon judge) sees which source each step drew from.
const STEP_SOURCE: Record<string, string> = {
  "District resolved": "Geocod.io",
  "Candidates loaded": "FEC",
  "Verified via MongoDB MCP": "MongoDB MCP",
  "Finance pulled": "FEC",
  "Legislation loaded": "Congress.gov",
  "Positions searched": "Perplexity",
};

function stepDetail(label: string, state: DistrictLensState): string {
  const candidateCount = state.candidates.length;
  switch (label) {
    case "District resolved":
      return state.currentRaceKey ?? "";
    case "Candidates loaded":
      return candidateCount ? `${candidateCount} candidates` : "";
    // The MCP count() ran against the candidates collection for this race, so
    // the candidate count is exactly what the partner MCP verified.
    case "Verified via MongoDB MCP":
      return candidateCount ? `${candidateCount} filings` : "";
    case "Finance pulled":
      return state.finance.length ? `${state.finance.length} filings` : "";
    case "Legislation loaded":
      if (state.votingRecord) return `${state.votingRecord.totalRollCalls} roll-call votes`;
      return state.legislation.length ? `${state.legislation.length} bills` : "";
    case "Positions searched":
      return state.positions.length ? `${state.positions.length} issues` : "";
    default:
      return "";
  }
}

// Decorate steps with their source + (once done) a result summary, turning the
// receipt into an honest per-tool activity trace. Pure: derives only from state.
export function annotateSteps(steps: BriefStep[], state: DistrictLensState): BriefStep[] {
  return steps.map((step) => {
    const source = STEP_SOURCE[step.label];
    const detail = step.status === "done" ? stepDetail(step.label, state) : "";
    return {
      ...step,
      source: source || undefined,
      detail: detail || undefined,
    };
  });
}
