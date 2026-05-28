import { test, expect } from "vitest";

import {
  buildThreadDoc,
  deriveThreadTitle,
  updateThreadRequestSchema,
} from "@/lib/threads/schema";

const NOW = new Date("2026-05-27T19:00:00.000Z");

test("title for an empty thread is a dated investigation", () => {
  expect(deriveThreadTitle([], NOW)).toBe("Investigation · May 27");
});

test("title for one race names the district", () => {
  expect(deriveThreadTitle(["2026-H-GA-07"], NOW)).toBe("GA-07 · May 27");
});

test("title for multiple races summarizes the count", () => {
  expect(deriveThreadTitle(["2026-H-GA-07", "2026-H-GA-06", "2026-S-GA"], NOW)).toBe(
    "GA-07 +2 more · May 27",
  );
});

test("buildThreadDoc dedupes + sorts race keys and stamps timestamps", () => {
  const doc = buildThreadDoc("user_1", ["2026-H-GA-07", "2026-H-GA-06", "2026-H-GA-07"], "t-1", NOW);
  expect(doc.thread_id).toBe("t-1");
  expect(doc.clerk_user_id).toBe("user_1");
  expect(doc.race_keys).toEqual(["2026-H-GA-06", "2026-H-GA-07"]);
  expect(doc.notes).toBe("");
  expect(doc.created_at).toBe("2026-05-27T19:00:00.000Z");
  expect(doc.updated_at).toBe("2026-05-27T19:00:00.000Z");
  expect(doc.title).toBe("GA-06 +1 more · May 27");
});

test("update request accepts a title and/or notes, rejects empty title", () => {
  expect(updateThreadRequestSchema.safeParse({ title: "My investigation" }).success).toBe(true);
  expect(updateThreadRequestSchema.safeParse({ notes: "lead: check FEC Q2" }).success).toBe(true);
  expect(updateThreadRequestSchema.safeParse({ title: "" }).success).toBe(false);
  expect(updateThreadRequestSchema.safeParse({}).success).toBe(true); // no-op update is allowed
});
