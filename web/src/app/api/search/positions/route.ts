import { NextRequest, NextResponse } from "next/server";
import { searchPerplexity, buildPositionPrompt, CIVIC_DOMAINS } from "@/lib/perplexity";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { candidateName, issue } = body as { candidateName?: string; issue?: string };
  if (!candidateName || !issue)
    return NextResponse.json({ error: "candidateName and issue required" }, { status: 400 });

  try {
    const result = await searchPerplexity(buildPositionPrompt(candidateName, issue), {
      recency: "year",
      domainAllowlist: CIVIC_DOMAINS,
      searchContextSize: "medium",
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
