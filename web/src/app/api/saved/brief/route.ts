/**
 * POST /api/saved/brief — save a completed brief to the signed-in user's ballot.
 *
 * Auth-gated (this is a WRITE): public reads stay open elsewhere, but saving
 * requires a Clerk session. Returns 401 JSON when signed out so the client can
 * prompt sign-in rather than follow a redirect.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { saveBriefRequestSchema } from "@/lib/saved-briefs/schema";
import { createSavedBrief } from "@/lib/saved-briefs/store";
import type { DistrictLensState } from "@/types/agent-state";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to save briefs." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = saveBriefRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid brief.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const { briefId } = await createSavedBrief(userId, parsed.data.state as unknown as DistrictLensState);
    return NextResponse.json({ success: true, briefId }, { status: 201 });
  } catch (err) {
    console.error("POST /api/saved/brief failed:", err);
    return NextResponse.json({ error: "Failed to save brief." }, { status: 500 });
  }
}
