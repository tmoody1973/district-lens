/**
 * /api/threads/[id] — a single research thread (auth-gated, owner-scoped).
 *   GET    -> the thread + its saved briefs
 *   PATCH  -> rename / edit notes
 *   DELETE -> remove the thread (its briefs are untagged, not deleted)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { updateThreadRequestSchema } from "@/lib/threads/schema";
import { deleteThread, getThread, updateThread } from "@/lib/threads/store";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in to view threads." }, { status: 401 });
  const { id } = await params;
  try {
    const result = await getThread(userId, id);
    if (!result) return NextResponse.json({ error: "Thread not found." }, { status: 404 });
    return NextResponse.json(result);
  } catch (err) {
    console.error("GET /api/threads/[id] failed:", err);
    return NextResponse.json({ error: "Failed to load thread." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in to edit threads." }, { status: 401 });
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = updateThreadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid update.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const ok = await updateThread(userId, id, parsed.data);
    if (!ok) return NextResponse.json({ error: "Thread not found." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/threads/[id] failed:", err);
    return NextResponse.json({ error: "Failed to update thread." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in to delete threads." }, { status: 401 });
  const { id } = await params;
  try {
    const ok = await deleteThread(userId, id);
    if (!ok) return NextResponse.json({ error: "Thread not found." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/threads/[id] failed:", err);
    return NextResponse.json({ error: "Failed to delete thread." }, { status: 500 });
  }
}
