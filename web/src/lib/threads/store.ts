import { randomUUID } from "crypto";

import { getDb } from "@/lib/mongodb";
import type { SavedBriefDoc } from "@/lib/saved-briefs/schema";

import {
  buildThreadDoc,
  type AgentThreadDoc,
  type ThreadSummary,
  type UpdateThreadRequest,
} from "./schema";

let indexesEnsured = false;

async function ensureIndexes(): Promise<void> {
  if (indexesEnsured) return;
  const db = await getDb();
  await Promise.all([
    db.collection("agent_threads").createIndex({ clerk_user_id: 1, updated_at: -1 }),
    db.collection("agent_threads").createIndex({ thread_id: 1 }, { unique: true }),
  ]);
  indexesEnsured = true;
}

export async function createThread(
  clerkUserId: string,
  raceKey?: string,
): Promise<AgentThreadDoc> {
  await ensureIndexes();
  const db = await getDb();
  const doc = buildThreadDoc(clerkUserId, raceKey ? [raceKey] : [], randomUUID());
  await db.collection<AgentThreadDoc>("agent_threads").insertOne(doc);
  return doc;
}

export async function listThreads(clerkUserId: string): Promise<ThreadSummary[]> {
  const db = await getDb();
  const threads = await db
    .collection<AgentThreadDoc>("agent_threads")
    .find({ clerk_user_id: clerkUserId })
    .sort({ updated_at: -1 })
    .toArray();

  return Promise.all(
    threads.map(async (t): Promise<ThreadSummary> => {
      const briefCount = await db
        .collection("saved_briefs")
        .countDocuments({ clerk_user_id: clerkUserId, thread_id: t.thread_id });
      return {
        threadId: t.thread_id,
        title: t.title,
        raceKeys: t.race_keys,
        briefCount,
        updatedAt: t.updated_at,
      };
    }),
  );
}

export async function getThread(
  clerkUserId: string,
  threadId: string,
): Promise<{ thread: AgentThreadDoc; briefs: SavedBriefDoc[] } | null> {
  const db = await getDb();
  const thread = await db
    .collection<AgentThreadDoc>("agent_threads")
    .findOne({ clerk_user_id: clerkUserId, thread_id: threadId }, { projection: { _id: 0 } });
  if (!thread) return null;

  const briefs = await db
    .collection<SavedBriefDoc>("saved_briefs")
    .find({ clerk_user_id: clerkUserId, thread_id: threadId }, { projection: { _id: 0 } })
    .sort({ created_at: -1 })
    .toArray();

  return { thread, briefs };
}

// Returns true if a thread was updated (exists + owned), false otherwise.
export async function updateThread(
  clerkUserId: string,
  threadId: string,
  patch: UpdateThreadRequest,
): Promise<boolean> {
  const db = await getDb();
  const set: Record<string, string> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.notes !== undefined) set.notes = patch.notes;

  const res = await db
    .collection<AgentThreadDoc>("agent_threads")
    .updateOne({ clerk_user_id: clerkUserId, thread_id: threadId }, { $set: set });
  return res.matchedCount > 0;
}

// Add a race to a thread (idempotent) and bump its updated_at — called when a
// brief is filed into the thread. Owner-scoped.
export async function attachRaceToThread(
  clerkUserId: string,
  threadId: string,
  raceKey: string,
): Promise<void> {
  const db = await getDb();
  await db.collection<AgentThreadDoc>("agent_threads").updateOne(
    { clerk_user_id: clerkUserId, thread_id: threadId },
    { $addToSet: { race_keys: raceKey }, $set: { updated_at: new Date().toISOString() } },
  );
}

export async function deleteThread(clerkUserId: string, threadId: string): Promise<boolean> {
  const db = await getDb();
  // Untag the thread's briefs so they survive in saved_briefs / My Ballot.
  await db
    .collection("saved_briefs")
    .updateMany(
      { clerk_user_id: clerkUserId, thread_id: threadId },
      { $unset: { thread_id: "" } },
    );
  const res = await db
    .collection<AgentThreadDoc>("agent_threads")
    .deleteOne({ clerk_user_id: clerkUserId, thread_id: threadId });
  return res.deletedCount > 0;
}
