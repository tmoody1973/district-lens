/**
 * GET /api/race/brief?race_key=2026-H-WI-04
 * Returns candidates + finance brief for a race. Called by the CopilotKit
 * client-side action handler.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb, fmtMoney } from "@/lib/mongodb";

export async function GET(req: NextRequest) {
  const raceKey = req.nextUrl.searchParams.get("race_key")?.trim();
  if (!raceKey) return NextResponse.json({ error: "race_key required" }, { status: 400 });

  try {
    const db = getDb();
    const cands = await db
      .collection("candidates")
      .find(
        { race_key: raceKey },
        { projection: { _id: 0, candidate_id: 1, name: 1, party: 1, incumbent_challenge_status: 1 } }
      )
      .toArray();

    if (!cands.length) return NextResponse.json({ error: `No candidates found for ${raceKey}` }, { status: 404 });

    const candIds = cands.map((c) => c.candidate_id as string);
    const fins = await db
      .collection("finance_summaries")
      .find(
        { candidate_id: { $in: candIds } },
        { projection: { _id: 0, candidate_id: 1, receipts: 1, disbursements: 1, cash_on_hand: 1, individual_contributions: 1, pac_contributions: 1, coverage_end_date: 1 } }
      )
      .toArray();

    const finMap = Object.fromEntries(fins.map((f) => [f.candidate_id as string, f]));
    const sorted = [...cands].sort((a) => (a.incumbent_challenge_status === "incumbent" ? -1 : 1));

    const lines = [`Finance brief for ${raceKey} (source: FEC bulk data, fec.gov):`];
    for (const c of sorted) {
      const status = (c.incumbent_challenge_status as string ?? "unknown").replace("_", " ");
      const fin = finMap[c.candidate_id as string];
      if (fin) {
        lines.push(
          `\n${c.name} (${c.party}, ${status})` +
          `\n  Raised: ${fmtMoney(fin.receipts as number)}  Spent: ${fmtMoney(fin.disbursements as number)}  Cash on hand: ${fmtMoney(fin.cash_on_hand as number)}` +
          `\n  Individuals: ${fmtMoney(fin.individual_contributions as number)}  PACs: ${fmtMoney(fin.pac_contributions as number)}` +
          `\n  Coverage through: ${fin.coverage_end_date ?? "unknown"}`
        );
      } else {
        lines.push(`\n${c.name} (${c.party}, ${status}) — no financial filing on record`);
      }
    }
    lines.push("\nFinance data does not prove issue positions — use for fundraising context only.");
    return NextResponse.json({ brief: lines.join("\n"), candidate_count: cands.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
