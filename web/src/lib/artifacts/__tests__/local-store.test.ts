import { test, expect } from "vitest";
import { ARTIFACTS_STORAGE_KEY, createLocalArtifactStore } from "@/lib/artifacts/local-store";
import type { ArtifactRecord } from "@/lib/artifacts/types";

const record = (over: Partial<ArtifactRecord> = {}): ArtifactRecord => ({
  artifactId: "art-1",
  type: "brief",
  name: "U.S. House · WI-04 · 2026",
  raceKey: "2026-H-WI-04",
  createdAt: "2026-06-09T12:00:00Z",
  updatedAt: "2026-06-09T12:00:00Z",
  versions: [],
  ...over,
});

function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

test("upsert then list round-trips through storage", () => {
  const storage = fakeStorage();
  const store = createLocalArtifactStore(storage);
  expect(store.upsert(record())).toBe(true);
  const rehydrated = createLocalArtifactStore(storage);
  expect(rehydrated.list()).toHaveLength(1);
  expect(rehydrated.get("art-1")?.name).toBe("U.S. House · WI-04 · 2026");
});

test("list is sorted by updatedAt descending", () => {
  const store = createLocalArtifactStore(fakeStorage());
  store.upsert(record({ artifactId: "old", updatedAt: "2026-06-01T00:00:00Z" }));
  store.upsert(record({ artifactId: "new", updatedAt: "2026-06-09T00:00:00Z" }));
  expect(store.list().map((r) => r.artifactId)).toEqual(["new", "old"]);
});

test("findByRaceKey matches type and race", () => {
  const store = createLocalArtifactStore(fakeStorage());
  store.upsert(record());
  expect(store.findByRaceKey("2026-H-WI-04", "brief")?.artifactId).toBe("art-1");
  expect(store.findByRaceKey("2026-H-WI-05", "brief")).toBeNull();
});

test("rename and remove", () => {
  const store = createLocalArtifactStore(fakeStorage());
  store.upsert(record());
  expect(store.rename("art-1", "My ballot race")).toBe(true);
  expect(store.get("art-1")?.name).toBe("My ballot race");
  store.remove("art-1");
  expect(store.get("art-1")).toBeNull();
});

test("null storage degrades to in-memory (no crash, available=false)", () => {
  const store = createLocalArtifactStore(null);
  expect(store.available).toBe(false);
  expect(store.upsert(record())).toBe(true);
  expect(store.list()).toHaveLength(1);
});

test("quota errors degrade: upsert returns false but memory copy survives", () => {
  const storage = fakeStorage();
  storage.setItem = () => {
    throw new DOMException("quota", "QuotaExceededError");
  };
  const store = createLocalArtifactStore(storage);
  expect(store.upsert(record())).toBe(false);
  expect(store.list()).toHaveLength(1); // session-only copy
});

test("corrupt stored JSON resets to an empty library", () => {
  const storage = fakeStorage();
  storage.setItem(ARTIFACTS_STORAGE_KEY, "{corrupt");
  const store = createLocalArtifactStore(storage);
  expect(store.list()).toEqual([]);
});
