import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export async function GET() {
  try {
    const db = await getDb();

    const candidates = await db
      .collection("candidates")
      .find({}, { projection: { _id: 0, candidate_id: 1, race_key: 1, incumbent_challenge_status: 1, party: 1, name: 1 } })
      .toArray();

    const finance = await db
      .collection("finance_summaries")
      .find({}, { projection: { _id: 0, candidate_id: 1, receipts: 1, pac_contributions: 1 } })
      .toArray();

    const finMap = Object.fromEntries(finance.map((f) => [f.candidate_id as string, f]));

    const byRace: Record<string, { incumbentReceipts: number | null; topChallengerReceipts: number | null; incumbentParty: string | null }> = {};

    for (const cand of candidates) {
      const key = cand.race_key as string;
      if (!byRace[key]) byRace[key] = { incumbentReceipts: null, topChallengerReceipts: null, incumbentParty: null };
      const fin = finMap[cand.candidate_id as string];
      const receipts = (fin?.receipts as number) ?? 0;
      if (cand.incumbent_challenge_status === "incumbent") {
        byRace[key].incumbentReceipts = receipts;
        byRace[key].incumbentParty = cand.party as string;
      } else {
        if (byRace[key].topChallengerReceipts === null || receipts > byRace[key].topChallengerReceipts!) {
          byRace[key].topChallengerReceipts = receipts;
        }
      }
    }

    const heatmap = Object.entries(byRace).map(([raceKey, data]) => ({
      raceKey,
      state: raceKey.split("-")[2],
      financeGap:
        data.incumbentReceipts !== null && data.topChallengerReceipts !== null
          ? data.incumbentReceipts - data.topChallengerReceipts
          : null,
      incumbentParty: data.incumbentParty,
    }));

    return NextResponse.json({ heatmap });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
