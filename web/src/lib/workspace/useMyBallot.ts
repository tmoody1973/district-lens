"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pushLocalArtifacts } from "@/lib/artifacts/sync";
import type { ArtifactStore } from "@/lib/artifacts/local-store";
import type { SavedBallotItem } from "@/lib/saved-briefs/schema";

export function useMyBallot(isSignedIn: boolean | undefined, store: ArtifactStore) {
  const [savedItems, setSavedItems] = useState<SavedBallotItem[]>([]);
  const syncedRef = useRef(false);

  const loadBallot = useCallback(async () => {
    try {
      const res = await fetch("/api/saved");
      if (!res.ok) { setSavedItems([]); return; }
      const data = await res.json();
      setSavedItems(data.items ?? []);
    } catch {
      setSavedItems([]);
    }
  }, []);

  // Clerk hydrates the session AFTER mount on a hard reload — an immediate
  // fetch 401s and (previously) never retried, leaving My Ballot empty until
  // the next navigation. Gate on the signed-in flag and refire when it flips.
  useEffect(() => {
    if (!isSignedIn) {
      setSavedItems([]);
      return;
    }
    loadBallot();
  }, [isSignedIn, loadBallot]);

  // One-shot push of locally saved artifacts when a signed-in session starts —
  // Mongo becomes the source of truth, localStorage stays the offline cache.
  useEffect(() => {
    if (!isSignedIn || syncedRef.current) return;
    syncedRef.current = true;
    pushLocalArtifacts(store)
      .then((result) => {
        if (result.pushed > 0) loadBallot();
      })
      .catch(() => {});
  }, [isSignedIn, store, loadBallot]);

  return { savedItems, loadBallot };
}
