import { test, expect, vi } from "vitest";
import { pushLocalArtifacts } from "@/lib/artifacts/sync";
import { createLocalArtifactStore } from "@/lib/artifacts/local-store";
import { DEFAULT_STATE } from "@/types/agent-state";
import type { ArtifactRecord } from "@/lib/artifacts/types";

const briefRecord = (over: Partial<ArtifactRecord> = {}): ArtifactRecord => ({
  artifactId: "art-1",
  type: "brief",
  name: "U.S. House · WI-04 · 2026",
  raceKey: "2026-H-WI-04",
  createdAt: "2026-06-09T12:00:00Z",
  updatedAt: "2026-06-09T12:00:00Z",
  versions: [
    {
      versionId: "v1",
      savedAt: "2026-06-09T12:00:00Z",
      snapshot: { ...DEFAULT_STATE, stage: "complete", currentRaceKey: "2026-H-WI-04" },
      fingerprint: {} as never,
      sourceRefs: [],
    },
  ],
  ...over,
});

test("pushes each unsynced brief's latest snapshot to /api/saved/brief", async () => {
  const store = createLocalArtifactStore(null);
  store.upsert(briefRecord());
  const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
  const result = await pushLocalArtifacts(store, fetchFn as unknown as typeof fetch);
  expect(result).toEqual({ pushed: 1, failed: 0 });
  expect(fetchFn).toHaveBeenCalledWith(
    "/api/saved/brief",
    expect.objectContaining({ method: "POST" }),
  );
  expect(store.get("art-1")?.syncedAt).toBeTruthy();
});

test("already-synced and non-brief artifacts are skipped", async () => {
  const store = createLocalArtifactStore(null);
  store.upsert(briefRecord({ artifactId: "done", syncedAt: "2026-06-08T00:00:00Z" }));
  store.upsert(briefRecord({ artifactId: "lead-1", type: "lead" }));
  const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
  const result = await pushLocalArtifacts(store, fetchFn as unknown as typeof fetch);
  expect(result).toEqual({ pushed: 0, failed: 0 });
  expect(fetchFn).not.toHaveBeenCalled();
});

test("a failed POST counts as failed and stays unsynced for retry", async () => {
  const store = createLocalArtifactStore(null);
  store.upsert(briefRecord());
  const fetchFn = vi.fn(async () => new Response(null, { status: 500 }));
  const result = await pushLocalArtifacts(store, fetchFn as unknown as typeof fetch);
  expect(result).toEqual({ pushed: 0, failed: 1 });
  expect(store.get("art-1")?.syncedAt).toBeUndefined();
});
