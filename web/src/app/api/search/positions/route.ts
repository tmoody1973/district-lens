import { NextRequest, NextResponse } from "next/server";
import { searchPerplexity, buildPositionPrompt, CIVIC_DOMAINS } from "@/lib/perplexity";
import { getDb } from "@/lib/mongodb";

const POSITIONS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function positionsCacheKey(candidateName: string, issue: string): string {
  return `positions:${candidateName.toLowerCase().trim()}:${issue.toLowerCase().trim()}`;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { candidateName, issue } = body as { candidateName?: string; issue?: string };
  if (!candidateName || !issue)
    return NextResponse.json({ error: "candidateName and issue required" }, { status: 400 });

  const cacheKey = positionsCacheKey(candidateName, issue);
  const now = new Date();

  try {
    const db = await getDb();
    const cached = await db
      .collection("evidence_cache")
      .findOne({ cache_key: cacheKey, expires_at: { $gt: now } });

    if (cached) {
      return NextResponse.json({
        answer: cached.answer as string,
        sources: cached.sources,
        relatedQuestions: (cached.related_questions as string[]) ?? [],
        cached: true,
      });
    }

    const result = await searchPerplexity(buildPositionPrompt(candidateName, issue), {
      recency: "year",
      domainAllowlist: CIVIC_DOMAINS,
      searchContextSize: "medium",
    });

    const expiresAt = new Date(now.getTime() + POSITIONS_TTL_MS);
    await db.collection("evidence_cache").replaceOne(
      { cache_key: cacheKey },
      {
        cache_key: cacheKey,
        query_type: "positions",
        candidate_name: candidateName,
        issue,
        answer: result.answer,
        sources: result.sources,
        related_questions: result.relatedQuestions,
        retrieved_at: now,
        expires_at: expiresAt,
      },
      { upsert: true }
    );

    return NextResponse.json({ ...result, cached: false });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
