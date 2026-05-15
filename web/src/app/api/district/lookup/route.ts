/**
 * POST /api/district/lookup
 * Resolves an address or ZIP to a congressional district via Geocod.io.
 * DECISIONS_LOG §3.5: compound cd120,cd request with cd fallback.
 * DECISIONS_LOG §1.5: returns multiple districts for ambiguous ZIPs.
 */

import { NextRequest, NextResponse } from "next/server";

const GEOCODIO_BASE = "https://api.geocod.io/v1.12";

interface GeocodioDistrict {
  district_number: number;
  congress_number: string;
  proportion: number;
}

function buildRaceKey(state: string, districtNumber: number): string {
  // Geocod.io codes DC at-large delegate as district 98 → "DC-00"
  const n = districtNumber === 98 ? 0 : districtNumber;
  return `${state.toUpperCase()}-${String(n).padStart(2, "0")}`;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEOCODIO_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEOCODIO_API_KEY not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const address: string | undefined = body?.address;
  if (!address?.trim()) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  const url = new URL(`${GEOCODIO_BASE}/geocode`);
  url.searchParams.set("q", address);
  url.searchParams.set("fields", "cd120,cd");
  url.searchParams.set("api_key", apiKey);

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    return NextResponse.json({ error: `Geocod.io error ${resp.status}` }, { status: 502 });
  }

  const data = await resp.json();
  const results: unknown[] = data.results ?? [];
  if (!results.length) {
    return NextResponse.json({ error: "No results found for that address" }, { status: 404 });
  }

  const top = results[0] as {
    formatted_address: string;
    location: { lat: number; lng: number };
    accuracy: number;
    accuracy_type: string;
    address_components: { state: string };
    fields: { congressional_districts?: GeocodioDistrict[] };
  };

  const state = top.address_components?.state ?? "";
  const rawDistricts: GeocodioDistrict[] = top.fields?.congressional_districts ?? [];

  // DECISIONS_LOG §3.5: prefer cd120, fall back to cd
  const fieldSource = rawDistricts[0]?.congress_number?.includes("120") ? "cd120" : "cd";

  const districts = rawDistricts.map((d) => ({
    race_key: buildRaceKey(state, d.district_number),
    district_number: d.district_number,
    proportion: d.proportion ?? 1,
    congress_number: d.congress_number,
    field_source: fieldSource,
  }));

  const isZipAmbiguous =
    ["zip_centroid", "approximate", "place"].includes(top.accuracy_type) &&
    districts.length > 1;

  return NextResponse.json({
    formatted_address: top.formatted_address,
    lat: Math.round(top.location.lat * 100) / 100,
    lng: Math.round(top.location.lng * 100) / 100,
    accuracy_type: top.accuracy_type,
    state,
    districts,
    primary: districts.sort((a, b) => b.proportion - a.proportion)[0] ?? null,
    is_zip_ambiguous: isZipAmbiguous,
    field_source: fieldSource,
  });
}
