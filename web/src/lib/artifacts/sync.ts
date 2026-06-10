import type { ArtifactStore } from "./local-store";

export interface SyncResult {
  pushed: number;
  failed: number;
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
    try {
      const res = await fetchFn("/api/saved/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: latest.snapshot }),
      });
      if (res.ok) {
        store.upsert({ ...record, syncedAt: new Date().toISOString() });
        pushed += 1;
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }
  return { pushed, failed };
}
