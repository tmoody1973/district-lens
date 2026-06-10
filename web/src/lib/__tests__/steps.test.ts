import { test, expect } from "vitest";

import { annotateSteps, stepsFromStage } from "@/lib/steps";
import { DEFAULT_STATE, type CandidateCard, type DistrictLensState } from "@/types/agent-state";

function candidates(n: number): CandidateCard[] {
  return Array.from({ length: n }, (_, i) => ({
    candidateId: `c${i}`,
    name: `Cand ${i}`,
    party: "DEM",
    status: "challenger",
    photoUrl: "",
    photoSource: "placeholder",
    raceKey: "2026-H-WI-04",
  }));
}

test("idle stage returns empty steps", () => {
  expect(stepsFromStage("idle")).toHaveLength(0);
});

test("candidates stage marks district done and candidates as running", () => {
  const steps = stepsFromStage("candidates");
  expect(steps[0].status).toBe("done");    // District resolved
  expect(steps[1].status).toBe("running"); // Candidates loaded (in progress)
  expect(steps[2].status).toBe("pending"); // Verified via MongoDB MCP
});

test("mcp stage marks the MongoDB MCP step as running", () => {
  const steps = stepsFromStage("mcp");
  expect(steps[1].status).toBe("done");     // Candidates loaded
  expect(steps[2].label).toBe("Verified via MongoDB MCP");
  expect(steps[2].status).toBe("running");
  expect(steps[3].status).toBe("pending");  // Finance pulled
});

test("complete stage marks all steps done", () => {
  const steps = stepsFromStage("complete");
  expect(steps.every((s) => s.status === "done")).toBe(true);
});

test("archiving stage marks positions done and Sources archived running", () => {
  const steps = stepsFromStage("archiving");
  const positions = steps.find((s) => s.label === "Positions searched")!;
  const archiving = steps.find((s) => s.label === "Sources archived")!;
  expect(positions.status).toBe("done");
  expect(archiving.status).toBe("running");
  expect(steps.find((s) => s.label === "Brief complete")!.status).toBe("pending");
});

test("Sources archived step is sourced to Firecrawl with an archived count", () => {
  const state: DistrictLensState = {
    ...DEFAULT_STATE,
    stage: "complete",
    positions: [
      {
        candidateName: "A",
        issue: "housing",
        answer: "x",
        sources: [
          { title: "T", url: "https://a.gov/p", date: null, snippet: "", archived: true },
          { title: "U", url: "https://b.gov/q", date: null, snippet: "" },
        ],
      },
    ],
  };
  const archived = annotateSteps(stepsFromStage("complete"), state).find(
    (s) => s.label === "Sources archived",
  )!;
  expect(archived.source).toBe("Firecrawl");
  expect(archived.detail).toBe("1 archived");
});

test("district stage shows first step as running", () => {
  const steps = stepsFromStage("district");
  expect(steps[0].status).toBe("running");
  expect(steps[1].status).toBe("pending");
});

test("finance stage shows three done and finance running", () => {
  const steps = stepsFromStage("finance");
  expect(steps[0].status).toBe("done");     // District resolved
  expect(steps[1].status).toBe("done");     // Candidates loaded
  expect(steps[2].status).toBe("done");     // Verified via MongoDB MCP
  expect(steps[3].status).toBe("running");  // Finance pulled
  expect(steps[4].status).toBe("pending");  // Legislation loaded
});

test("candidates stage has exactly one running step", () => {
  const steps = stepsFromStage("candidates");
  const runningSteps = steps.filter((s) => s.status === "running");
  expect(runningSteps).toHaveLength(1);
  expect(runningSteps[0].label).toBe("Candidates loaded");
});

test("annotateSteps tags sources and shows the MCP count once done", () => {
  const state: DistrictLensState = {
    ...DEFAULT_STATE,
    stage: "finance",
    currentRaceKey: "2026-H-WI-04",
    candidates: candidates(4),
  };
  const annotated = annotateSteps(stepsFromStage("finance"), state);

  const mcp = annotated.find((s) => s.label === "Verified via MongoDB MCP")!;
  expect(mcp.source).toBe("MongoDB MCP");
  expect(mcp.detail).toBe("4 filings"); // done at finance stage → count shown

  const cands = annotated.find((s) => s.label === "Candidates loaded")!;
  expect(cands.source).toBe("FEC");
  expect(cands.detail).toBe("4 candidates");
});

test("annotateSteps shows source but no count for not-yet-done steps", () => {
  const state: DistrictLensState = {
    ...DEFAULT_STATE,
    stage: "candidates",
    candidates: candidates(2),
  };
  const annotated = annotateSteps(stepsFromStage("candidates"), state);

  const mcp = annotated.find((s) => s.label === "Verified via MongoDB MCP")!;
  expect(mcp.source).toBe("MongoDB MCP"); // source always shown
  expect(mcp.detail).toBeUndefined();      // pending → no count yet
});

test("positions step credits Google Search grounding, not Perplexity", async () => {
  const { annotateSteps, stepsFromStage } = await import("../steps");
  const { DEFAULT_STATE } = await import("@/types/agent-state");
  const steps = annotateSteps(stepsFromStage("positions"), DEFAULT_STATE);
  const positions = steps.find((s) => s.label === "Positions searched")!;
  expect(positions.source).toBe("Google Search grounding");
});
