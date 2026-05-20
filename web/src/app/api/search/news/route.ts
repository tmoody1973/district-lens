import { NextRequest, NextResponse } from "next/server";
import { searchPerplexity, buildNewsPrompt } from "@/lib/perplexity";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { candidateName } = body as { candidateName?: string };
  if (!candidateName)
    return NextResponse.json({ error: "candidateName required" }, { status: 400 });

  try {
    const result = await searchPerplexity(buildNewsPrompt(candidateName), {
      recency: "week",
      searchContextSize: "medium",
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
