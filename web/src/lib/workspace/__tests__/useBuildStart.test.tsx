import { test, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { useBuildStart } from "@/lib/workspace/useBuildStart";
import type { ResearchStage } from "@/types/agent-state";

function Harness({
  stage,
  onBuildStart,
}: {
  stage: ResearchStage | undefined;
  onBuildStart: () => void;
}) {
  useBuildStart(stage, onBuildStart);
  return null;
}

test("C2: fires on idle → active even without onRunStart (typed-chat build)", () => {
  const onBuildStart = vi.fn();
  const { rerender } = render(<Harness stage="idle" onBuildStart={onBuildStart} />);
  expect(onBuildStart).not.toHaveBeenCalled();
  rerender(<Harness stage="district" onBuildStart={onBuildStart} />);
  expect(onBuildStart).toHaveBeenCalledTimes(1);
});

test("fires on complete → active (back-to-back builds)", () => {
  const onBuildStart = vi.fn();
  const { rerender } = render(<Harness stage="complete" onBuildStart={onBuildStart} />);
  rerender(<Harness stage="candidates" onBuildStart={onBuildStart} />);
  expect(onBuildStart).toHaveBeenCalledTimes(1);
});

test("fires once per build, not on every stage advance", () => {
  const onBuildStart = vi.fn();
  const { rerender } = render(<Harness stage="idle" onBuildStart={onBuildStart} />);
  rerender(<Harness stage="district" onBuildStart={onBuildStart} />);
  rerender(<Harness stage="candidates" onBuildStart={onBuildStart} />);
  rerender(<Harness stage="finance" onBuildStart={onBuildStart} />);
  expect(onBuildStart).toHaveBeenCalledTimes(1);
});

test("does NOT fire when hydration lands mid-build (prev stage unknown)", () => {
  // Mid-build page refresh: the coagent state hydrates straight into an
  // active stage. Firing here would wipe focus the user just restored.
  const onBuildStart = vi.fn();
  const { rerender } = render(<Harness stage={undefined} onBuildStart={onBuildStart} />);
  rerender(<Harness stage="positions" onBuildStart={onBuildStart} />);
  expect(onBuildStart).not.toHaveBeenCalled();
});

test("does NOT fire on active → complete or complete → idle", () => {
  const onBuildStart = vi.fn();
  const { rerender } = render(<Harness stage="archiving" onBuildStart={onBuildStart} />);
  rerender(<Harness stage="complete" onBuildStart={onBuildStart} />);
  rerender(<Harness stage="idle" onBuildStart={onBuildStart} />);
  expect(onBuildStart).not.toHaveBeenCalled();
});
