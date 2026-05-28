import { z } from "zod";

import { deriveDistrictKey } from "@/lib/saved-briefs/schema";

// A journalist research thread: a named, renameable container that groups saved
// briefs (by thread_id on saved_briefs) across one or more races, plus notes.
export interface AgentThreadDoc {
  thread_id: string;
  clerk_user_id: string;
  title: string;
  race_keys: string[];
  notes: string;
  created_at: string;
  updated_at: string;
}

// A row in the threads sidebar.
export interface ThreadSummary {
  threadId: string;
  title: string;
  raceKeys: string[];
  briefCount: number;
  updatedAt: string;
}

export const createThreadRequestSchema = z.object({
  // Optional race to seed the auto-title; a thread can also start empty.
  raceKey: z.string().min(1).optional(),
});

// At least one of title/notes may be present; an empty title is rejected, but an
// empty body (no-op) is allowed so the client can PATCH freely.
export const updateThreadRequestSchema = z.object({
  title: z.string().min(1, "title cannot be empty").optional(),
  notes: z.string().optional(),
});
export type UpdateThreadRequest = z.infer<typeof updateThreadRequestSchema>;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Deterministic short date, e.g. "May 27" (UTC, locale-independent for tests).
function shortDate(now: Date): string {
  return `${MONTHS[now.getUTCMonth()]} ${now.getUTCDate()}`;
}

// Heuristic title from the races in the thread + the date. Renameable by the user.
export function deriveThreadTitle(raceKeys: string[], now: Date): string {
  const date = shortDate(now);
  if (raceKeys.length === 0) return `Investigation · ${date}`;
  const first = deriveDistrictKey(raceKeys[0]);
  if (raceKeys.length === 1) return `${first} · ${date}`;
  return `${first} +${raceKeys.length - 1} more · ${date}`;
}

export function buildThreadDoc(
  clerkUserId: string,
  raceKeys: string[],
  threadId: string,
  now: Date = new Date(),
): AgentThreadDoc {
  const uniqueSorted = [...new Set(raceKeys)].sort();
  const iso = now.toISOString();
  return {
    thread_id: threadId,
    clerk_user_id: clerkUserId,
    title: deriveThreadTitle(uniqueSorted, now),
    race_keys: uniqueSorted,
    notes: "",
    created_at: iso,
    updated_at: iso,
  };
}
