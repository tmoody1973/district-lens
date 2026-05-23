import type { BriefStep, ResearchStage } from "@/types/agent-state";

const STEP_LABELS = [
  "District resolved",
  "Candidates loaded",
  "Finance pulled",
  "Legislation loaded",
  "Positions searched",
  "News loading",
  "Brief complete",
] as const;

const STAGE_DONE_COUNT: Record<ResearchStage, number> = {
  idle: 0,
  district: 0,
  candidates: 1,
  finance: 2,
  legislation: 3,
  positions: 4,
  news: 5,
  complete: 7,
};

const STAGE_RUNNING_INDEX: Record<ResearchStage, number | null> = {
  idle: null,
  district: 0,
  candidates: 1,
  finance: 2,
  legislation: 3,
  positions: 4,
  news: 5,
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
