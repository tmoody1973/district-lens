import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name")?.trim() ?? "";
  const state = req.nextUrl.searchParams.get("state")?.trim().toUpperCase() ?? "";
  if (!name) return NextResponse.json({ candidates: [] });

  try {
    const db = getDb();
    const query: Record<string, unknown> = { $text: { $search: name } };
    if (state) query.state = state;

    const results = await db
      .collection("candidates")
      .find(query, {
        projection: { _id: 0, candidate_id: 1, name: 1, party: 1, race_key: 1, incumbent_challenge_status: 1, score: { $meta: "textScore" } },
      })
      .sort({ score: { $meta: "textScore" } })
      .limit(6)
      .toArray();

    return NextResponse.json({ candidates: results });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
