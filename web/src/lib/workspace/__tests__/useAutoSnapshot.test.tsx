import { test, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { useAutoSnapshot } from "@/lib/workspace/useAutoSnapshot";
import { DEFAULT_STATE, type DistrictLensState } from "@/types/agent-state";

function Harness({ state, onSnapshot }: { state: DistrictLensState; onSnapshot: (s: DistrictLensState) => unknown }) {
  useAutoSnapshot(state, onSnapshot);
  return null;
}

const drafting: DistrictLensState = { ...DEFAULT_STATE, stage: "positions", currentRaceKey: "2026-H-WI-04" };
const complete: DistrictLensState = { ...DEFAULT_STATE, stage: "complete", currentRaceKey: "2026-H-WI-04" };

test("fires exactly once on the drafting → complete transition", () => {
  const onSnapshot = vi.fn();
  const { rerender } = render(<Harness state={drafting} onSnapshot={onSnapshot} />);
  expect(onSnapshot).not.toHaveBeenCalled();
  rerender(<Harness state={complete} onSnapshot={onSnapshot} />);
  expect(onSnapshot).toHaveBeenCalledTimes(1);
  rerender(<Harness state={complete} onSnapshot={onSnapshot} />); // stays complete
  expect(onSnapshot).toHaveBeenCalledTimes(1);
});

test("never fires for a completed state with no race key (failed build)", () => {
  const onSnapshot = vi.fn();
  const { rerender } = render(
    <Harness state={{ ...DEFAULT_STATE, stage: "district" }} onSnapshot={onSnapshot} />,
  );
  rerender(<Harness state={{ ...DEFAULT_STATE, stage: "complete" }} onSnapshot={onSnapshot} />);
  expect(onSnapshot).not.toHaveBeenCalled();
});

test("re-arms for a fresh build of the same race (new briefStartedAt)", () => {
  const onSnapshot = vi.fn();
  const { rerender } = render(
    <Harness state={{ ...drafting, briefStartedAt: 1 }} onSnapshot={onSnapshot} />,
  );
  rerender(<Harness state={{ ...complete, briefStartedAt: 1 }} onSnapshot={onSnapshot} />);
  expect(onSnapshot).toHaveBeenCalledTimes(1);
  // User rebuilds the SAME race: stage drops back to drafting, new briefStartedAt.
  rerender(<Harness state={{ ...drafting, briefStartedAt: 2 }} onSnapshot={onSnapshot} />);
  rerender(<Harness state={{ ...complete, briefStartedAt: 2 }} onSnapshot={onSnapshot} />);
  expect(onSnapshot).toHaveBeenCalledTimes(2);
});
