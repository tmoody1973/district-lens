import { randomUUID } from "crypto";

import { getDb } from "@/lib/mongodb";
import type { DistrictLensState } from "@/types/agent-state";

import { buildSavedDocs, type SavedBriefDoc, type SavedDistrictDoc } from "./schema";

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
