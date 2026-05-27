import { test, expect } from "vitest";

import { stepsFromStage } from "@/lib/steps";

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
