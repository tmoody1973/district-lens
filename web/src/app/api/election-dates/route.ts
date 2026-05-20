import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state")?.toUpperCase().trim();
  if (!state) return NextResponse.json({ error: "state required" }, { status: 400 });

  try {
    const db = await getDb();
    const record = await db
      .collection("election_dates")
      .findOne(
        { state_abbreviation: state },
        { projection: { _id: 0, state: 1, state_abbreviation: 1, primary: 1, general_election_date: 1, general_early_in_person_voting: 1, candidate_filing_deadlines: 1, events_chronological: 1 } }
      );

    if (!record) return NextResponse.json({ error: `No election date data for ${state}` }, { status: 404 });
    return NextResponse.json(record);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
