import type { ArtifactStore } from "./local-store";
import type { DistrictLensState } from "@/types/agent-state";

export interface SyncResult {
  pushed: number;
  failed: number;
}

/**
 * Single owner of the "persist a brief snapshot to Mongo" write (CLAUDE.md:
 * integrations live behind service functions, not inline component fetches).
 */
export async function saveBriefSnapshot(
  state: DistrictLensState,
  threadId?: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn("/api/saved/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(threadId ? { state, threadId } : { state }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * One-shot sign-in push: local brief artifacts → Mongo via the existing
 * /api/saved/brief endpoint (append-only snapshots; the per-race My Ballot
 * bookmark is upserted server-side). Mongo becomes the source of truth;
 * localStorage stays the offline cache (spec §Data flow). Comparison /
 * overview / lead sync arrives with those artifact types in later phases.
 */
export async function pushLocalArtifacts(
  store: ArtifactStore,
  fetchFn: typeof fetch = fetch,
): Promise<SyncResult> {
  const pending = store
    .list()
    .filter((record) => record.type === "brief" && !record.syncedAt && record.versions.length > 0);

  let pushed = 0;
  let failed = 0;
  for (const record of pending) {
    const latest = record.versions[record.versions.length - 1];
    const ok = await saveBriefSnapshot(latest.snapshot, undefined, fetchFn);
    if (ok) {
      store.upsert({ ...record, syncedAt: new Date().toISOString() });
      pushed += 1;
    } else {
      failed += 1;
    }
  }
  return { pushed, failed };
}
