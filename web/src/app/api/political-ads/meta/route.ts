import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const candidateName = req.nextUrl.searchParams.get("candidate")?.trim();
  const state = req.nextUrl.searchParams.get("state")?.trim();
  if (!candidateName) return NextResponse.json({ error: "candidate required" }, { status: 400 });

  const accessToken = process.env.META_AD_LIBRARY_TOKEN;
  if (!accessToken) {
    return NextResponse.json({
      ads: [],
      note: "META_AD_LIBRARY_TOKEN not configured. Add a Facebook app access token to enable political ad spend data.",
    });
  }

  const url = new URL("https://graph.facebook.com/v21.0/ads_archive");
  url.searchParams.set("ad_type", "POLITICAL_AND_ISSUE_ADS");
  url.searchParams.set("search_terms", candidateName);
  url.searchParams.set("ad_reached_countries", "US");
  if (state) url.searchParams.set("ad_delivery_country", "US");
  url.searchParams.set(
    "fields",
    "id,ad_creative_bodies,ad_snapshot_url,spend,impressions,page_name,funding_entity,ad_delivery_start_time,demographic_distribution"
  );
  url.searchParams.set("limit", "20");
  url.searchParams.set("access_token", accessToken);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return NextResponse.json({ error: `Meta API ${res.status}` }, { status: 502 });
    const data = await res.json();
    return NextResponse.json({ ads: data.data ?? [], paging: data.paging ?? null });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
