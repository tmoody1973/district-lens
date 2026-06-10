import { test, expect } from "vitest";
import { useCallback, useRef, useState } from "react";
import { act, render } from "@testing-library/react";
import {
  ArtifactProvider,
  useArtifacts,
} from "@/components/workspace/ArtifactProvider";
import { createLocalArtifactStore } from "@/lib/artifacts/local-store";
import {
  applyFocusIntent,
  derivePanelView,
  shouldAutoFocus,
  type FocusIntent,
  type PanelViewResult,
} from "@/lib/workspace/derivePanelView";
import { useAutoSnapshot } from "@/lib/workspace/useAutoSnapshot";
import { useBuildStart } from "@/lib/workspace/useBuildStart";
import { DEFAULT_STATE, type DistrictLensState } from "@/types/agent-state";

/**
 * C8 integration batch: the page's panel wiring, composed from the real
 * modules exactly as w/page.tsx wires them (focus slots + stage watcher +
 * auto-snapshot + pure view derivation). CopilotKit/Clerk keep the real page
 * out of jsdom; this harness pins the contract between the pieces.
 */

interface HarnessApi {
  view: PanelViewResult;
  focusedArtifactId: string | null;
  reopenedSaved: DistrictLensState | null;
  enact: (intent: FocusIntent<DistrictLensState>) => void;
  markNavigated: () => void;
}

function Harness({
  state,
  apiRef,
}: {
  state: DistrictLensState;
  apiRef: { current: HarnessApi | null };
}) {
  const { active, openArtifact, closeArtifact, recordSnapshot } = useArtifacts();
  const [reopenedSaved, setReopenedSaved] = useState<DistrictLensState | null>(null);
  const userNavigatedRef = useRef(false);

  const enact = useCallback(
    (intent: FocusIntent<DistrictLensState>) => {
      const slots = applyFocusIntent(intent);
      setReopenedSaved(slots.savedBrief);
      if (slots.localArtifactId) openArtifact(slots.localArtifactId);
      else closeArtifact();
    },
    [openArtifact, closeArtifact],
  );

  const beginNewBrief = useCallback(() => {
    setReopenedSaved(null);
    closeArtifact();
    userNavigatedRef.current = false;
  }, [closeArtifact]);

  useBuildStart(state.stage, beginNewBrief);

  useAutoSnapshot(state, (s) => {
    const record = recordSnapshot(s);
    if (
      record &&
      shouldAutoFocus({
        snapshotRecorded: true,
        userNavigatedSinceRunStart: userNavigatedRef.current,
      })
    ) {
      enact({ kind: "local", artifactId: record.artifactId });
    }
  });

  apiRef.current = {
    view: derivePanelView({
      hasFocusedSavedBrief: reopenedSaved != null,
      hasFocusedLocalArtifact: active != null,
      stage: state.stage,
    }),
    focusedArtifactId: active?.artifactId ?? null,
    reopenedSaved,
    enact,
    markNavigated: () => {
      userNavigatedRef.current = true;
    },
  };
  return null;
}

const SAVED_BRIEF: DistrictLensState = {
  ...DEFAULT_STATE,
  stage: "complete",
  currentRaceKey: "2026-H-ND-00",
};

function renderHarness(initial: Partial<DistrictLensState> = {}) {
  const apiRef: { current: HarnessApi | null } = { current: null };
  const store = createLocalArtifactStore(null); // in-memory — storage-unavailable path
  const utils = render(
    <ArtifactProvider store={store}>
      <Harness state={{ ...DEFAULT_STATE, ...initial }} apiRef={apiRef} />
    </ArtifactProvider>,
  );
  const setState = (next: Partial<DistrictLensState>) =>
    utils.rerender(
      <ArtifactProvider store={store}>
        <Harness state={{ ...DEFAULT_STATE, ...next }} apiRef={apiRef} />
      </ArtifactProvider>,
    );
  return { apiRef, setState };
}

test("C8: typed-chat build while focused — stage transition clears focus, DRAFT takes the panel", () => {
  const { apiRef, setState } = renderHarness({ stage: "idle" });
  act(() => apiRef.current!.enact({ kind: "saved", state: SAVED_BRIEF }));
  expect(apiRef.current!.view.view).toBe("focused");

  // Typed chat: no onRunStart — only the coagent stage moves.
  act(() => setState({ stage: "district" }));
  expect(apiRef.current!.reopenedSaved).toBeNull();
  expect(apiRef.current!.view.view).toBe("draft");
});

test("C8: exploration keeps stage idle — focus survives, no draft, no clearing", () => {
  const { apiRef, setState } = renderHarness({ stage: "idle" });
  act(() => apiRef.current!.enact({ kind: "saved", state: SAVED_BRIEF }));

  // get_state_races fills stateRaces while the stage REMAINS idle (pinned
  // backend assumption) — nothing about the panel may change.
  act(() => setState({ stage: "idle", stateRaces: [{ raceKey: "2026-H-WI-04" } as never] }));
  expect(apiRef.current!.view.view).toBe("focused");
  expect(apiRef.current!.reopenedSaved).not.toBeNull();
});

test("C8: completion auto-focuses the snapshotted artifact when the user stayed put", () => {
  const { apiRef, setState } = renderHarness({ stage: "idle" });
  act(() => setState({ stage: "district", currentRaceKey: "2026-H-WI-04", briefStartedAt: 1 }));
  expect(apiRef.current!.view.view).toBe("draft");

  act(() => setState({ stage: "complete", currentRaceKey: "2026-H-WI-04", briefStartedAt: 1 }));
  expect(apiRef.current!.view.view).toBe("focused");
  expect(apiRef.current!.focusedArtifactId).not.toBeNull();
});

test("C8: manual navigation during draft — completion must not steal the panel", () => {
  const { apiRef, setState } = renderHarness({ stage: "idle" });
  act(() => setState({ stage: "district", currentRaceKey: "2026-H-WI-04", briefStartedAt: 2 }));

  // User opens a saved brief mid-run.
  act(() => {
    apiRef.current!.markNavigated();
    apiRef.current!.enact({ kind: "saved", state: SAVED_BRIEF });
  });
  expect(apiRef.current!.view.view).toBe("focused");
  expect(apiRef.current!.view.showBuildPill).toBe(true); // build stays visible

  act(() => setState({ stage: "complete", currentRaceKey: "2026-H-WI-04", briefStartedAt: 2 }));
  // Snapshot recorded, but focus stays on the user's choice.
  expect(apiRef.current!.reopenedSaved).not.toBeNull();
  expect(apiRef.current!.focusedArtifactId).toBeNull();
});

test("C8: saved-then-local cross-open — one focus concept (C3)", () => {
  const { apiRef, setState } = renderHarness({ stage: "idle" });

  // Build something so the library has a real artifact to open.
  act(() => setState({ stage: "district", currentRaceKey: "2026-H-WI-04", briefStartedAt: 3 }));
  act(() => setState({ stage: "complete", currentRaceKey: "2026-H-WI-04", briefStartedAt: 3 }));
  const localId = apiRef.current!.focusedArtifactId!;

  act(() => apiRef.current!.enact({ kind: "saved", state: SAVED_BRIEF }));
  expect(apiRef.current!.reopenedSaved).not.toBeNull();
  expect(apiRef.current!.focusedArtifactId).toBeNull();

  act(() => apiRef.current!.enact({ kind: "local", artifactId: localId }));
  expect(apiRef.current!.reopenedSaved).toBeNull();
  expect(apiRef.current!.focusedArtifactId).toBe(localId);
});

test("C8: storage-unavailable completion still snapshots and focuses (session-only)", () => {
  // The harness store is created with null storage throughout this file —
  // this pins that the full draft→complete→auto-focus path works in
  // memory-only mode.
  const { apiRef, setState } = renderHarness({ stage: "idle" });
  act(() => setState({ stage: "archiving", currentRaceKey: "2026-S-MT", briefStartedAt: 4 }));
  act(() => setState({ stage: "complete", currentRaceKey: "2026-S-MT", briefStartedAt: 4 }));
  expect(apiRef.current!.view.view).toBe("focused");
  expect(apiRef.current!.focusedArtifactId).not.toBeNull();
});
