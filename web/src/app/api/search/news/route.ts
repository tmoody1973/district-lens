import { NextRequest, NextResponse } from "next/server";
import { searchPerplexity, buildNewsPrompt, filterRelevantSources } from "@/lib/perplexity";
import { getDb } from "@/lib/mongodb";

const NEWS_TTL_MS = 24 * 60 * 60 * 1000;

function newsCacheKey(candidateName: string): string {
  return `news:${candidateName.toLowerCase().trim()}`;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { candidateName } = body as { candidateName?: string };
  if (!candidateName)
    return NextResponse.json({ error: "candidateName required" }, { status: 400 });

  const cacheKey = newsCacheKey(candidateName);
  const now = new Date();

  try {
    const db = await getDb();
    const cached = await db
      .collection("evidence_cache")
      .findOne({ cache_key: cacheKey, expires_at: { $gt: now } });

    if (cached) {
      return NextResponse.json({
        answer: cached.answer as string,
        sources: filterRelevantSources(
          (cached.sources as { title?: string; snippet?: string }[]) ?? [],
          candidateName,
        ),
        relatedQuestions: (cached.related_questions as string[]) ?? [],
        cached: true,
      });
    }

    const result = await searchPerplexity(buildNewsPrompt(candidateName), {
      recency: "week",
      searchContextSize: "medium",
    });
    result.sources = /no recent campaign coverage found/i.test(result.answer)
      ? []
      : filterRelevantSources(result.sources, candidateName);

    const expiresAt = new Date(now.getTime() + NEWS_TTL_MS);
    await db.collection("evidence_cache").replaceOne(
      { cache_key: cacheKey },
      {
        cache_key: cacheKey,
        query_type: "news",
        candidate_name: candidateName,
        issue: null,
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
