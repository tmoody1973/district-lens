import { test, expect } from "vitest";

import { stepsFromStage } from "@/lib/steps";

test("idle stage returns empty steps", () => {
  expect(stepsFromStage("idle")).toHaveLength(0);
});

test("candidates stage marks first two steps done", () => {
  const steps = stepsFromStage("candidates");
  expect(steps[0].status).toBe("done");
  expect(steps[1].status).toBe("done");
  expect(steps[2].status).toBe("pending");
});

test("complete stage marks all steps done", () => {
  const steps = stepsFromStage("complete");
  expect(steps.every((s) => s.status === "done")).toBe(true);
});
