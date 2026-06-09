import type { ArtifactRecord, ArtifactType } from "./types";

export const ARTIFACTS_STORAGE_KEY = "districtlens.artifacts.v1";

export interface ArtifactStore {
  /** False when localStorage is missing/blocked — session-only mode. */
  available: boolean;
  list(): ArtifactRecord[];
  get(artifactId: string): ArtifactRecord | null;
  /** Returns false when a real storage write failed (quota); true otherwise. */
  upsert(record: ArtifactRecord): boolean;
  /** Returns false when the id is unknown. A quota-failed persist still returns true — the in-memory rename succeeded; durability is reported by upsert's path. */
  rename(artifactId: string, name: string): boolean;
  remove(artifactId: string): void;
  findByRaceKey(raceKey: string, type: ArtifactType): ArtifactRecord | null;
}

function readAll(storage: Storage | null): ArtifactRecord[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(ARTIFACTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ArtifactRecord[]) : [];
  } catch {
    return []; // corrupt store → empty library, never a crash
  }
}

export function createLocalArtifactStore(storage: Storage | null): ArtifactStore {
  // In-memory mirror is the source of truth for reads; storage is the durable
  // copy. Quota failures keep the session copy alive (spec §Error handling).
  //
  // Single-tab assumption: each tab holds its own in-memory mirror and
  // last-write-wins on persist. Cross-tab sync (storage event listener)
  // is deliberately deferred — artifacts are re-derivable by rebuilding
  // a brief, so divergence loses no user-authored data.
  let records: ArtifactRecord[] = readAll(storage);

  /** True when the library is durably persisted (or persistence is N/A). */
  function persist(): boolean {
    if (!storage) return true; // memory-only mode: nothing to write, not a failure
    try {
      storage.setItem(ARTIFACTS_STORAGE_KEY, JSON.stringify(records));
      return true;
    } catch {
      return false; // quota/blocked: session copy survives, caller may notify
    }
  }

  return {
    available: storage !== null,

    list(): ArtifactRecord[] {
      return [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    get(artifactId: string): ArtifactRecord | null {
      return records.find((r) => r.artifactId === artifactId) ?? null;
    },

    upsert(record: ArtifactRecord): boolean {
      const index = records.findIndex((r) => r.artifactId === record.artifactId);
      records =
        index === -1
          ? [...records, record]
          : [...records.slice(0, index), record, ...records.slice(index + 1)];
      return persist();
    },

    rename(artifactId: string, name: string): boolean {
      const existing = records.find((r) => r.artifactId === artifactId);
      if (!existing) return false;
      records = records.map((r) =>
        r.artifactId === artifactId
          ? { ...r, name, updatedAt: new Date().toISOString() }
          : r,
      );
      persist();
      return true;
    },

    remove(artifactId: string): void {
      records = records.filter((r) => r.artifactId !== artifactId);
      persist();
    },

    findByRaceKey(raceKey: string, type: ArtifactType): ArtifactRecord | null {
      return records.find((r) => r.raceKey === raceKey && r.type === type) ?? null;
    },
  };
}
