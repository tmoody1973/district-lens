import type { BriefFingerprint } from "@/lib/brief-fingerprint";
import type { SourceRef } from "@/lib/saved-briefs/schema";
import type { DistrictLensState } from "@/types/agent-state";

export type ArtifactType = "brief" | "comparison" | "overview" | "lead";

/** One immutable snapshot. Versions are append-only (linear history). */
export interface ArtifactVersion {
  versionId: string;
  savedAt: string; // ISO
  snapshot: DistrictLensState;
  fingerprint: BriefFingerprint;
  sourceRefs: SourceRef[];
}

export interface ArtifactRecord {
  artifactId: string;
  type: ArtifactType;
  name: string;
  raceKey: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  versions: ArtifactVersion[];
  /** Set after a one-shot sign-in push to Mongo (a later task). */
  syncedAt?: string;
}
