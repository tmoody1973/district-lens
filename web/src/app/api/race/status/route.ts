/**
 * GET /api/race/status?race_key=2026-H-GA-07
 *
 * Returns the resolved nominee status for a race — the output of the
 * resolve_nominees job (race_status collection), joined to its source citation
 * (results_citations). Surfaces: confirmed winner(s), runoff_pending,
 * provisional ("not yet called"), or a projected-unofficial signal.
 *
 * Returns 404 when a race has not been resolved yet; the UI renders nothing.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export async function GET(req: NextRequest) {
  const raceKey = req.nextUrl.searchParams.get("race_key")?.trim();
  if (!raceKey) return NextResponse.json({ error: "race_key required" }, { status: 400 });

  try {
    const db = await getDb();
    const status = await db.collection("race_status").findOne(
      { race_key: raceKey },
      {
        projection: {
          _id: 0,
          status: 1,
          winners: 1,
          confidence: 1,
          confirmation_basis: 1,
          flagged_reason: 1,
          citation_id: 1,
          resolved_at: 1,
        },
      }
    );

    if (!status) {
      // Unresolved is the normal pre-election state — return 200 so the
      // browser console stays clean for every not-yet-called race.
      return NextResponse.json({ status: "unresolved" });
    }

    let citation: { url: string; publisher: string } | null = null;
    if (status.citation_id) {
      const cit = await db
        .collection("results_citations")
        .findOne({ _id: status.citation_id }, { projection: { _id: 0, url: 1, publisher: 1 } });
      if (cit?.url) {
        citation = { url: cit.url as string, publisher: (cit.publisher as string) ?? "" };
      }
    }

    return NextResponse.json({
      status: status.status as string,
      winners: (status.winners as Record<string, string>) ?? {},
      confidence: (status.confidence as number | undefined) ?? null,
      confirmationBasis: (status.confirmation_basis as string[]) ?? [],
      flaggedReason: (status.flagged_reason as string | undefined) ?? null,
      resolvedAt: status.resolved_at ? new Date(status.resolved_at as Date).toISOString() : null,
      citation,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
