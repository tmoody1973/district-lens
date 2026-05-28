/**
 * /api/threads — journalist research threads. Auth-gated (writes + owner-scoped
 * reads); public civic reads live elsewhere and stay open.
 *   GET  -> list the user's threads
 *   POST -> create a thread (optional { raceKey } seeds the auto-title)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { createThreadRequestSchema } from "@/lib/threads/schema";
import { createThread, listThreads } from "@/lib/threads/store";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in to view threads." }, { status: 401 });
  try {
    return NextResponse.json({ threads: await listThreads(userId) });
  } catch (err) {
    console.error("GET /api/threads failed:", err);
    return NextResponse.json({ error: "Failed to load threads." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in to create threads." }, { status: 401 });

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {}; // empty body is fine — create an untitled-by-race thread
  }

  const parsed = createThreadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const thread = await createThread(userId, parsed.data.raceKey);
    return NextResponse.json({ thread }, { status: 201 });
  } catch (err) {
    console.error("POST /api/threads failed:", err);
    return NextResponse.json({ error: "Failed to create thread." }, { status: 500 });
  }
}
