/**
 * GET /api/saved/brief/[id] — fetch one saved snapshot to reopen it. Auth-gated
 * and owner-scoped: a user can only read their own saved briefs.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { getSavedBrief } from "@/lib/saved-briefs/store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to view saved briefs." }, { status: 401 });
  }

  const { id } = await params;

  try {
    const brief = await getSavedBrief(userId, id);
    if (!brief) {
      return NextResponse.json({ error: "Saved brief not found." }, { status: 404 });
    }
    return NextResponse.json({ brief });
  } catch (err) {
    console.error("GET /api/saved/brief/[id] failed:", err);
    return NextResponse.json({ error: "Failed to load saved brief." }, { status: 500 });
  }
}
