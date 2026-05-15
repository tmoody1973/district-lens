/**
 * GET /api/incumbent/legislation?race_key=2026-H-WI-04&limit=6
 * Returns recently sponsored bills for the incumbent in a race.
 * Data from Congress.gov API via Phase 3 import.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export async function GET(req: NextRequest) {
  const raceKey = req.nextUrl.searchParams.get("race_key")?.trim();
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "6"), 20);
  if (!raceKey) return NextResponse.json({ error: "race_key required" }, { status: 400 });

  try {
    const db = await getDb();
    const bills = await db
      .collection("legislative_actions")
      .find(
        { race_key_2026: raceKey, action_type: "sponsored_bill" },
        { projection: { _id: 0, bill_id: 1, title: 1, introduced_date: 1, latest_action: 1, member_name: 1 } }
      )
      .sort({ introduced_date: -1 })
      .limit(limit)
      .toArray();

    if (!bills.length) {
      return NextResponse.json({ legislation: `No sponsored legislation found for race ${raceKey} in the 119th Congress.` });
    }

    const member = bills[0]?.member_name ?? "The incumbent";
    const lines = [`${member} — recent sponsored legislation (119th Congress, source: Congress.gov):`];
    for (const b of bills) {
      lines.push(`\n  ${b.bill_id} (${b.introduced_date}): ${b.title}`);
      if (b.latest_action) lines.push(`    Status: ${b.latest_action}`);
    }
    lines.push("\nSponsorship shows legislative priorities, not definitive policy positions.");
    return NextResponse.json({ legislation: lines.join("\n"), count: bills.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
