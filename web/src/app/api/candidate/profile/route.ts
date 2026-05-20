import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { bioguidePhotoUrl, placeholderAvatarUrl } from "@/lib/bioguide";

export async function GET(req: NextRequest) {
  const raceKey = req.nextUrl.searchParams.get("race_key")?.trim();
  if (!raceKey) return NextResponse.json({ error: "race_key required" }, { status: 400 });

  try {
    const db = await getDb();

    const candidates = await db
      .collection("candidates")
      .find({ race_key: raceKey }, {
        projection: {
          _id: 0,
          candidate_id: 1,
          name: 1,
          party: 1,
          incumbent_challenge_status: 1,
          ballotpedia_profile_url: 1,
          official_government_website: 1,
          official_campaign_website: 1,
        },
      })
      .toArray();

    const profiles = await db
      .collection("legislator_profiles")
      .find({ name: { $in: candidates.map((c) => c.name as string) } })
      .toArray();

    const profileMap = Object.fromEntries(
      profiles.map((p) => [p.name as string, p])
    );

    const result = candidates.map((c) => {
      const profile = profileMap[c.name as string];
      const bioguideId = (profile?.bioguide_id as string) ?? null;
      const photoUrl = bioguideId
        ? bioguidePhotoUrl(bioguideId)!
        : placeholderAvatarUrl(c.name as string, c.party as string);

      return {
        candidateId: c.candidate_id,
        name: c.name,
        party: c.party,
        status: c.incumbent_challenge_status ?? "unknown",
        photoUrl,
        photoSource: bioguideId ? "bioguide" : "placeholder",
        raceKey,
        ballotpediaUrl: c.ballotpedia_profile_url ?? null,
        officialWebsite: c.official_government_website ?? profile?.official_website ?? null,
        campaignWebsite: c.official_campaign_website ?? null,
        committees: (profile?.committees as string[]) ?? [],
      };
    });

    return NextResponse.json({ candidates: result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
