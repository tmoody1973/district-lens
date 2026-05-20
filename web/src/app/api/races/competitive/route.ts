import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export async function GET(req: NextRequest) {
  const stateFilter = req.nextUrl.searchParams.get("state")?.toUpperCase().trim() ?? null;

  try {
    const db = await getDb();
    const query = stateFilter ? { state: stateFilter } : {};
    const candidates = await db
      .collection("candidates")
      .find(query, { projection: { _id: 0, candidate_id: 1, race_key: 1, name: 1, party: 1, state: 1, incumbent_challenge_status: 1 } })
      .toArray();

    const finance = await db
      .collection("finance_summaries")
      .find({ candidate_id: { $in: candidates.map((c) => c.candidate_id as string) } })
      .toArray();

    const finMap = Object.fromEntries(finance.map((f) => [f.candidate_id as string, f]));

    const byRace: Record<string, { incumbent: typeof candidates[0] | null; topChallenger: typeof candidates[0] | null; state: string }> = {};
    for (const c of candidates) {
      const key = c.race_key as string;
      if (!byRace[key]) byRace[key] = { incumbent: null, topChallenger: null, state: c.state as string };
      if (c.incumbent_challenge_status === "incumbent") {
        byRace[key].incumbent = c;
      } else {
        const current = byRace[key].topChallenger;
        const currentReceipts = current ? ((finMap[current.candidate_id as string]?.receipts as number) ?? 0) : -1;
        const thisReceipts = (finMap[c.candidate_id as string]?.receipts as number) ?? 0;
        if (thisReceipts > currentReceipts) byRace[key].topChallenger = c;
      }
    }

    const competitive = Object.entries(byRace)
      .filter(([, d]) => d.incumbent && d.topChallenger)
      .map(([raceKey, d]) => {
        const incFin = finMap[d.incumbent!.candidate_id as string];
        const chalFin = finMap[d.topChallenger!.candidate_id as string];
        const incReceipts = (incFin?.receipts as number) ?? 0;
        const chalReceipts = (chalFin?.receipts as number) ?? 0;
        return {
          raceKey,
          state: d.state,
          incumbentName: d.incumbent!.name as string,
          incumbentParty: d.incumbent!.party as string,
          incumbentReceipts: incReceipts,
          topChallengerName: d.topChallenger!.name as string,
          topChallengerReceipts: chalReceipts,
          financeGap: incReceipts - chalReceipts,
          challengerLeading: chalReceipts > incReceipts,
        };
      })
      .filter((r) => r.challengerLeading || r.financeGap < 100_000)
      .sort((a, b) => a.financeGap - b.financeGap)
      .slice(0, 20);

    return NextResponse.json({ competitive });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
