import { test, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ArtifactProvider, useArtifacts } from "../ArtifactProvider";
import { createLocalArtifactStore } from "@/lib/artifacts/local-store";
import { DEFAULT_STATE, type DistrictLensState } from "@/types/agent-state";

let api: ReturnType<typeof useArtifacts>;

function Probe() {
  api = useArtifacts();
  return <span data-testid="count">{api.library.length}</span>;
}

const completeState = (over: Partial<DistrictLensState> = {}): DistrictLensState => ({
  ...DEFAULT_STATE,
  stage: "complete",
  currentRaceKey: "2026-H-WI-04",
  ...over,
});

function renderProvider() {
  const store = createLocalArtifactStore(null); // in-memory for tests
  render(
    <ArtifactProvider store={store}>
      <Probe />
    </ArtifactProvider>,
  );
  return store;
}

beforeEach(() => window.localStorage.clear());

test("starts with an empty library", () => {
  renderProvider();
  expect(screen.getByTestId("count").textContent).toBe("0");
});

test("recordSnapshot adds a brief artifact to the library and store", () => {
  const store = renderProvider();
  act(() => {
    api.recordSnapshot(completeState());
  });
  expect(api.library).toHaveLength(1);
  expect(api.library[0].type).toBe("brief");
  expect(store.list()).toHaveLength(1);
});

test("snapshotting the same race twice with identical evidence keeps one version", () => {
  renderProvider();
  act(() => void api.recordSnapshot(completeState()));
  act(() => void api.recordSnapshot(completeState()));
  expect(api.library).toHaveLength(1);
  expect(api.library[0].versions).toHaveLength(1);
});

test("open / close an artifact", () => {
  renderProvider();
  act(() => void api.recordSnapshot(completeState()));
  const id = api.library[0].artifactId;
  act(() => api.openArtifact(id));
  expect(api.active?.artifactId).toBe(id);
  expect(api.activeVersionIndex).toBe(0);
  act(() => api.closeArtifact());
  expect(api.active).toBeNull();
});

test("openArtifact with an unknown id leaves active null (dead-link path)", () => {
  renderProvider();
  act(() => api.openArtifact("nope"));
  expect(api.active).toBeNull();
});

test("rename and delete update both context and store", () => {
  const store = renderProvider();
  act(() => void api.recordSnapshot(completeState()));
  const id = api.library[0].artifactId;
  act(() => api.renameArtifact(id, "Maya's race"));
  expect(store.get(id)?.name).toBe("Maya's race");
  act(() => api.deleteArtifact(id));
  expect(api.library).toHaveLength(0);
  expect(store.get(id)).toBeNull();
});
