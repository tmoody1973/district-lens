import { computeFingerprint, type BriefFingerprint } from "@/lib/brief-fingerprint";
import { collectSourceRefs, deriveLabel } from "@/lib/saved-briefs/schema";
import type { DistrictLensState } from "@/types/agent-state";
import type { ArtifactRecord, ArtifactVersion } from "./types";

/**
 * Auto-snapshot fires only on the transition INTO `complete` with a race key.
 * Failed or partial builds never reach the library (spec §Error handling).
 */
export function shouldSnapshot(
  prevStage: string,
  stage: string,
  raceKey: string | null,
): boolean {
  return stage === "complete" && prevStage !== "complete" && raceKey !== null;
}

export function fingerprintsEqual(a: BriefFingerprint, b: BriefFingerprint): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function deriveArtifactName(raceKey: string): string {
  const year = raceKey.split("-")[0];
  return `${deriveLabel(raceKey)} · ${year}`;
}

/**
 * Snapshot a completed brief. Returns a NEW record (immutability rule):
 * - no existing record → single-version record with a generated name
 * - identical latest fingerprint → existing record returned as-is (dedupe)
 * - changed fingerprint → new version appended; prior versions untouched
 */
export function snapshotBrief(
  state: DistrictLensState,
  existing: ArtifactRecord | null,
  ids: { artifactId: string; versionId: string },
  now: Date = new Date(),
): ArtifactRecord {
  if (!state.currentRaceKey) {
    throw new Error("Cannot snapshot a brief without a race key");
  }
  const fingerprint = computeFingerprint(state);
  const version: ArtifactVersion = {
    versionId: ids.versionId,
    savedAt: now.toISOString(),
    snapshot: state,
    fingerprint,
    sourceRefs: collectSourceRefs(state),
  };

  if (!existing) {
    return {
      artifactId: ids.artifactId,
      type: "brief",
      name: deriveArtifactName(state.currentRaceKey),
      raceKey: state.currentRaceKey,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      versions: [version],
    };
  }

  const latest = existing.versions[existing.versions.length - 1];
  if (latest && fingerprintsEqual(latest.fingerprint, fingerprint)) {
    return existing;
  }
  return {
    ...existing,
    updatedAt: now.toISOString(),
    versions: [...existing.versions, version],
  };
}
