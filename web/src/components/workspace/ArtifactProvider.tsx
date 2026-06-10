"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { snapshotBrief } from "@/lib/artifacts/lifecycle";
import {
  createLocalArtifactStore,
  type ArtifactStore,
} from "@/lib/artifacts/local-store";
import type { ArtifactRecord } from "@/lib/artifacts/types";
import type { DistrictLensState } from "@/types/agent-state";

interface ArtifactContextValue {
  library: ArtifactRecord[];
  active: ArtifactRecord | null;
  activeVersionIndex: number;
  storageAvailable: boolean;
  /** The backing store — exposed for the sign-in sync push (a later task). */
  store: ArtifactStore;
  openArtifact: (artifactId: string) => void;
  closeArtifact: () => void;
  selectVersion: (index: number) => void;
  renameArtifact: (artifactId: string, name: string) => void;
  deleteArtifact: (artifactId: string) => void;
  /** Snapshot a completed brief into the library. Returns the record, or null if nothing saved. */
  recordSnapshot: (state: DistrictLensState) => ArtifactRecord | null;
}

const ArtifactContext = createContext<ArtifactContextValue | null>(null);

function defaultStore(): ArtifactStore {
  if (typeof window === "undefined") return createLocalArtifactStore(null);
  try {
    return createLocalArtifactStore(window.localStorage);
  } catch {
    return createLocalArtifactStore(null);
  }
}

export function ArtifactProvider({
  children,
  store,
}: {
  children: ReactNode;
  /** Injectable for tests; defaults to localStorage. */
  store?: ArtifactStore;
}) {
  const [artifactStore] = useState<ArtifactStore>(() => store ?? defaultStore());
  // Server render sees an empty library; localStorage loads after mount so the
  // server and client first paint match (no hydration mismatch — the artifact
  // rail renders library cards at rest now).
  const [library, setLibrary] = useState<ArtifactRecord[]>([]);
  useEffect(() => {
    setLibrary(artifactStore.list());
  }, [artifactStore]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeVersionIndex, setActiveVersionIndex] = useState(0);

  const active = useMemo(
    () => library.find((r) => r.artifactId === activeId) ?? null,
    [library, activeId],
  );

  const refresh = useCallback(() => setLibrary(artifactStore.list()), [artifactStore]);

  const openArtifact = useCallback(
    (artifactId: string) => {
      const record = artifactStore.get(artifactId);
      if (!record) return; // dead link — caller renders "not in your library"
      setActiveId(artifactId);
      setActiveVersionIndex(record.versions.length > 0 ? record.versions.length - 1 : 0);
    },
    [artifactStore],
  );

  const closeArtifact = useCallback(() => {
    setActiveId(null);
    setActiveVersionIndex(0);
  }, []);

  const selectVersion = useCallback(
    (index: number) => {
      if (!active) return;
      const clamped = Math.min(Math.max(index, 0), active.versions.length - 1);
      setActiveVersionIndex(clamped);
    },
    [active],
  );

  const renameArtifact = useCallback(
    (artifactId: string, name: string) => {
      artifactStore.rename(artifactId, name);
      refresh();
    },
    [artifactStore, refresh],
  );

  const deleteArtifact = useCallback(
    (artifactId: string) => {
      artifactStore.remove(artifactId);
      setActiveId((current) => (current === artifactId ? null : current));
      refresh();
    },
    [artifactStore, refresh],
  );

  const recordSnapshot = useCallback(
    (state: DistrictLensState): ArtifactRecord | null => {
      if (!state.currentRaceKey) return null;
      const existing = artifactStore.findByRaceKey(state.currentRaceKey, "brief");
      const record = snapshotBrief(state, existing, {
        artifactId: crypto.randomUUID(),
        versionId: crypto.randomUUID(),
      });
      if (record !== existing) artifactStore.upsert(record);
      refresh();
      return record;
    },
    [artifactStore, refresh],
  );

  const value = useMemo(
    () => ({
      library,
      active,
      activeVersionIndex,
      storageAvailable: artifactStore.available,
      store: artifactStore,
      openArtifact,
      closeArtifact,
      selectVersion,
      renameArtifact,
      deleteArtifact,
      recordSnapshot,
    }),
    [
      library,
      active,
      activeVersionIndex,
      artifactStore,
      openArtifact,
      closeArtifact,
      selectVersion,
      renameArtifact,
      deleteArtifact,
      recordSnapshot,
    ],
  );

  return <ArtifactContext.Provider value={value}>{children}</ArtifactContext.Provider>;
}

export function useArtifacts(): ArtifactContextValue {
  const ctx = useContext(ArtifactContext);
  if (!ctx) throw new Error("useArtifacts must be used inside ArtifactProvider");
  return ctx;
}
