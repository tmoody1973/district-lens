/**
 * GET /api/saved — the signed-in user's "My Ballot" list (saved races + a
 * pointer to each one's latest snapshot). Auth-gated; 401 JSON when signed out.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { listSavedBallot } from "@/lib/saved-briefs/store";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to view saved briefs." }, { status: 401 });
  }

  try {
    const items = await listSavedBallot(userId);
    return NextResponse.json({ items });
  } catch (err) {
    console.error("GET /api/saved failed:", err);
    return NextResponse.json({ error: "Failed to load saved briefs." }, { status: 500 });
  }
}
