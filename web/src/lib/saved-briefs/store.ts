import { randomUUID } from "crypto";

import { getDb, getFinanceSummaries } from "@/lib/mongodb";
import type { BriefFingerprint } from "@/lib/brief-fingerprint";
import type { DistrictLensState } from "@/types/agent-state";

import { diffFingerprints, type CurrentRaceFingerprint } from "./diff";
import {
  buildSavedDocs,
  type SavedBallotItem,
  type SavedBriefDoc,
  type SavedDistrictDoc,
} from "./schema";

let indexesEnsured = false;

async function ensureIndexes(): Promise<void> {
  if (indexesEnsured) return;
  const db = await getDb();
  await Promise.all([
    db.collection("saved_briefs").createIndex({ clerk_user_id: 1, created_at: -1 }),
    db.collection("saved_briefs").createIndex({ brief_id: 1 }, { unique: true }),
    db.collection("saved_districts").createIndex(
      { clerk_user_id: 1, race_key: 1 },
      { unique: true },
    ),
  ]);
  indexesEnsured = true;
}

// Persist a brief: a new immutable snapshot in saved_briefs (history powers the
// change-diff), plus an upserted one-per-race bookmark in saved_districts.
export async function createSavedBrief(
  clerkUserId: string,
  state: DistrictLensState,
): Promise<{ briefId: string }> {
  await ensureIndexes();
  const db = await getDb();

  const { savedBrief, savedDistrict } = buildSavedDocs(clerkUserId, state, {
    briefId: randomUUID(),
    savedDistrictId: randomUUID(),
  });

  await db.collection<SavedBriefDoc>("saved_briefs").insertOne(savedBrief);

  // clerk_user_id + race_key come from the filter on insert, so they live in
  // neither $set nor $setOnInsert (avoids a Mongo path-conflict).
  await db.collection<SavedDistrictDoc>("saved_districts").updateOne(
    { clerk_user_id: clerkUserId, race_key: savedDistrict.race_key },
    {
      $set: {
        label: savedDistrict.label,
        district_key: savedDistrict.district_key,
        updated_at: savedDistrict.updated_at,
      },
      $setOnInsert: {
        saved_district_id: savedDistrict.saved_district_id,
        created_at: savedDistrict.created_at,
      },
    },
    { upsert: true },
  );

  return { briefId: savedBrief.brief_id };
}

// Recompute the cheap-to-derive signals for a race as it stands now (current
// candidate set + latest fundraising coverage), straight from stored data, to
// compare against a saved fingerprint.
export async function computeCurrentRaceFingerprint(
  raceKey: string,
): Promise<CurrentRaceFingerprint> {
  const db = await getDb();
  const cands = await db
    .collection("candidates")
    .find({ race_key: raceKey }, { projection: { _id: 0, candidate_id: 1 } })
    .toArray();
  const candidateIds = cands.map((c) => c.candidate_id as string).sort();

  const fins = candidateIds.length ? await getFinanceSummaries(candidateIds) : [];
  const dates = fins
    .map((f) => (f.coverage_end_date as string | null) ?? null)
    .filter((d): d is string => !!d);
  const financeCoverageEndMax = dates.length ? dates.reduce((m, d) => (d > m ? d : m)) : null;

  return { candidateIds, financeCoverageEndMax };
}

// The user's "My Ballot": one row per bookmarked race (most recent first), each
// pointing at its latest snapshot and annotated with what's changed since.
export async function listSavedBallot(clerkUserId: string): Promise<SavedBallotItem[]> {
  const db = await getDb();
  const districts = await db
    .collection<SavedDistrictDoc>("saved_districts")
    .find({ clerk_user_id: clerkUserId })
    .sort({ updated_at: -1 })
    .toArray();

  return Promise.all(
    districts.map(async (d): Promise<SavedBallotItem> => {
      const latest = await db
        .collection<SavedBriefDoc>("saved_briefs")
        .find({ clerk_user_id: clerkUserId, race_key: d.race_key })
        .sort({ created_at: -1 })
        .limit(1)
        .next();

      let changes: string[] = [];
      const savedFingerprint = latest?.freshness as BriefFingerprint | undefined;
      if (savedFingerprint) {
        try {
          const current = await computeCurrentRaceFingerprint(d.race_key);
          changes = diffFingerprints(savedFingerprint, current);
        } catch {
          // A diff failure must never break the list — just show no changes.
          changes = [];
        }
      }

      return {
        raceKey: d.race_key,
        districtKey: d.district_key,
        label: d.label,
        briefId: latest?.brief_id ?? null,
        savedAt: latest?.created_at ?? d.updated_at,
        changes,
      };
    }),
  );
}

// A single saved snapshot, scoped to its owner so one user can never read
// another's saved brief.
export async function getSavedBrief(
  clerkUserId: string,
  briefId: string,
): Promise<SavedBriefDoc | null> {
  const db = await getDb();
  return db
    .collection<SavedBriefDoc>("saved_briefs")
    .findOne({ clerk_user_id: clerkUserId, brief_id: briefId }, { projection: { _id: 0 } });
}
