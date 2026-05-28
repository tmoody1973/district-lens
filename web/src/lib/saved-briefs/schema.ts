import { z } from "zod";

import { computeFingerprint, type BriefFingerprint } from "@/lib/brief-fingerprint";
import type { DistrictLensState } from "@/types/agent-state";

// Boundary validation for the save request. We store the full brief, so we keep
// unknown fields (passthrough) but hard-require a currentRaceKey — you cannot
// save a brief that isn't pinned to a race.
const sourceSchema = z
  .object({ title: z.string(), url: z.string(), date: z.string().nullable() })
  .passthrough();

const stateSchema = z
  .object({
    currentRaceKey: z.string().min(1, "a brief must be pinned to a race to save"),
    candidates: z.array(z.object({ candidateId: z.string() }).passthrough()).default([]),
    finance: z.array(z.object({ coverageEndDate: z.string().nullable() }).passthrough()).default([]),
    votingRecord: z
      .object({ asOfDate: z.string().nullable(), sourceUrl: z.string() })
      .passthrough()
      .nullable()
      .default(null),
    legislation: z.array(z.unknown()).default([]),
    positions: z
      .array(z.object({ sources: z.array(sourceSchema).default([]) }).passthrough())
      .default([]),
    news: z.array(z.object({ date: z.string().nullable() }).passthrough()).default([]),
  })
  .passthrough();

export const saveBriefRequestSchema = z.object({ state: stateSchema });
export type SaveBriefRequest = z.infer<typeof saveBriefRequestSchema>;

export interface SourceRef {
  title: string;
  url: string;
  date: string | null;
}

export interface SavedBriefDoc {
  brief_id: string;
  clerk_user_id: string;
  race_key: string;
  question: string;
  answer_snapshot: DistrictLensState;
  source_refs: SourceRef[];
  freshness: BriefFingerprint;
  created_at: string;
  updated_at: string;
}

export interface SavedDistrictDoc {
  saved_district_id: string;
  clerk_user_id: string;
  district_key: string;
  race_key: string;
  label: string;
  created_at: string;
  updated_at: string;
}

const OFFICE_NAMES: Record<string, string> = { H: "U.S. House", S: "U.S. Senate", G: "Governor" };

// "2026-H-WI-04" -> "WI-04"; "2026-S-WI" -> "WI". The district key is the
// geography, independent of the election year, so a re-saved race in a later
// cycle still maps to the same bookmark.
export function deriveDistrictKey(raceKey: string): string {
  return raceKey.split("-").slice(2).join("-");
}

// "2026-H-WI-04" -> "U.S. House · WI-04".
export function deriveLabel(raceKey: string): string {
  const office = OFFICE_NAMES[raceKey.split("-")[1]] ?? "Race";
  return `${office} · ${deriveDistrictKey(raceKey)}`;
}

// Citations the saved brief must preserve: every position's stored sources plus
// the incumbent voting-record source, de-duplicated by URL.
function collectSourceRefs(state: DistrictLensState): SourceRef[] {
  const byUrl = new Map<string, SourceRef>();
  for (const position of state.positions) {
    for (const s of position.sources ?? []) {
      if (s.url) byUrl.set(s.url, { title: s.title, url: s.url, date: s.date });
    }
  }
  if (state.votingRecord?.sourceUrl) {
    byUrl.set(state.votingRecord.sourceUrl, {
      title: "Incumbent voting record",
      url: state.votingRecord.sourceUrl,
      date: state.votingRecord.asOfDate,
    });
  }
  return [...byUrl.values()];
}

export interface BuildIds {
  briefId: string;
  savedDistrictId: string;
}

// Pure: turn a live brief into the two documents we persist. IDs and clock are
// injectable so this is deterministic under test.
export function buildSavedDocs(
  clerkUserId: string,
  state: DistrictLensState,
  ids: BuildIds,
  now: Date = new Date(),
): { savedBrief: SavedBriefDoc; savedDistrict: SavedDistrictDoc } {
  const raceKey = state.currentRaceKey;
  if (!raceKey) throw new Error("cannot build saved docs: state has no currentRaceKey");

  const iso = now.toISOString();
  const label = deriveLabel(raceKey);

  return {
    savedBrief: {
      brief_id: ids.briefId,
      clerk_user_id: clerkUserId,
      race_key: raceKey,
      question: `Voter brief — ${label}`,
      answer_snapshot: state,
      source_refs: collectSourceRefs(state),
      freshness: computeFingerprint(state),
      created_at: iso,
      updated_at: iso,
    },
    savedDistrict: {
      saved_district_id: ids.savedDistrictId,
      clerk_user_id: clerkUserId,
      district_key: deriveDistrictKey(raceKey),
      race_key: raceKey,
      label,
      created_at: iso,
      updated_at: iso,
    },
  };
}
