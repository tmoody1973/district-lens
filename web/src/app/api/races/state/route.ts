import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state")?.toUpperCase().trim();
  if (!state) return NextResponse.json({ error: "state required" }, { status: 400 });

  try {
    const db = await getDb();
    const races = await db
      .collection("races")
      .find(
        { state },
        {
          projection: {
            _id: 0,
            race_key: 1,
            state: 1,
            office: 1,
            district: 1,
            incumbent_name_bp: 1,
            incumbent_bioguide_id: 1,
          },
        }
      )
      .toArray();

    const raceKeys = races.map((r) => r.race_key as string);
    const candidates = await db
      .collection("candidates")
      .find({ race_key: { $in: raceKeys } })
      .toArray();
    const finance = await db
      .collection("finance_summaries")
      .find({ candidate_id: { $in: candidates.map((c) => c.candidate_id) } })
      .toArray();

    const finMap = Object.fromEntries(
      finance.map((f) => [f.candidate_id as string, f])
    );

    const rows = races.map((race) => {
      const raceCands = candidates.filter((c) => c.race_key === race.race_key);
      const incumbent = raceCands.find((c) => c.incumbent_challenge_status === "incumbent");
      const challengers = raceCands.filter((c) => c.incumbent_challenge_status !== "incumbent");
      const incFin = incumbent ? finMap[incumbent.candidate_id as string] : null;
      const topChallenger = challengers.sort((a, b) => {
        const fa = finMap[a.candidate_id as string]?.receipts ?? 0;
        const fb = finMap[b.candidate_id as string]?.receipts ?? 0;
        return (fb as number) - (fa as number);
      })[0];
      const chalFin = topChallenger ? finMap[topChallenger.candidate_id as string] : null;
      const incReceipts = (incFin?.receipts as number) ?? null;
      const chalReceipts = (chalFin?.receipts as number) ?? null;
      const financeGap =
        incReceipts !== null && chalReceipts !== null
          ? incReceipts - chalReceipts
          : null;
      const pacPct =
        incFin && (incFin.receipts as number) > 0
          ? Math.round(((incFin.pac_contributions as number) / (incFin.receipts as number)) * 100)
          : null;

      return {
        raceKey: race.race_key,
        state: race.state,
        office: race.office,
        district: race.district,
        incumbentName: (incumbent?.name as string) ?? null,
        incumbentParty: (incumbent?.party as string) ?? null,
        incumbentReceipts: incReceipts,
        topChallengerName: (topChallenger?.name as string) ?? null,
        topChallengerReceipts: chalReceipts,
        financeGap,
        pacPct,
      };
    });

    return NextResponse.json({ races: rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
