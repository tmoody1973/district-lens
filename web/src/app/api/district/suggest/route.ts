/**
 * GET /api/district/suggest?q=<partial>
 * Returns address suggestions using Geocod.io's geocode endpoint
 * as a lightweight typeahead (Geocod.io has no dedicated suggest API).
 * Returns up to 4 formatted address strings.
 */

import { NextRequest, NextResponse } from "next/server";

const GEOCODIO_BASE = "https://api.geocod.io/v1.12";

export async function GET(req: NextRequest) {
  const apiKey = process.env.GEOCODIO_API_KEY;
  if (!apiKey) return NextResponse.json({ suggestions: [] });

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  // Require at least 5 chars to avoid burning quota on short inputs
  if (q.length < 5) return NextResponse.json({ suggestions: [] });

  const url = new URL(`${GEOCODIO_BASE}/geocode`);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "4");
  url.searchParams.set("api_key", apiKey);

  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) return NextResponse.json({ suggestions: [] });
    const data = await resp.json();
    const suggestions = (data.results ?? [])
      .map((r: { formatted_address?: string }) => r.formatted_address ?? "")
      .filter(Boolean);
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
