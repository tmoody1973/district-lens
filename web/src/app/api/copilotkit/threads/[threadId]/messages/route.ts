/**
 * GET /api/copilotkit/threads/[threadId]/messages
 * Returns the stored chat messages for a thread so the client can restore
 * conversation history when reopening a thread.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { getDb } from "@/lib/mongodb";
import type { AgentThreadDoc } from "@/lib/threads/schema";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to view thread messages." }, { status: 401 });
  }

  const { threadId } = await params;

  try {
    const db = await getDb();
    const thread = await db.collection<AgentThreadDoc>("agent_threads").findOne({
      clerk_user_id: userId,
      thread_id: threadId,
    });
    return NextResponse.json({ messages: thread?.messages ?? [] });
  } catch (err) {
    console.error("GET /api/copilotkit/threads/[threadId]/messages failed:", err);
    return NextResponse.json({ error: "Failed to load messages." }, { status: 500 });
  }
}
