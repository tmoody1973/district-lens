/**
 * Recent-news search powered by Gemini 2.0 Flash with Google Search grounding.
 * Uses @ai-sdk/google-vertex (already a direct dependency) — no google-auth-library
 * import needed at runtime since the AI SDK handles Vertex auth internally.
 *
 * Replaces Perplexity so no competing AI service is called at runtime.
 */

import { createVertex } from "@ai-sdk/google-vertex";
import { generateText } from "ai";
import { normalizeCandidateName, filterRelevantSources } from "@/lib/perplexity";

export interface NewsSource {
  title: string;
  url: string;
  snippet: string;
  date: string | null;
}

export interface NewsResult {
  answer: string;
  sources: NewsSource[];
  relatedQuestions: string[];
}

const NO_COVERAGE_RE = /no recent (campaign )?coverage found/i;

function buildGeminiNewsPrompt(candidateName: string): string {
  const name = normalizeCandidateName(candidateName);
  return (
    `Search for recent news coverage of ${name}, a 2026 U.S. congressional candidate, ` +
    `from the last 7 days. Only include coverage about this person as a political ` +
    `candidate or officeholder: campaign activities, public statements, debates, ` +
    `polling, endorsements, fundraising, or controversies. ` +
    `Ignore results that merely match the name (films, businesses, other people). ` +
    `If there is no election-related coverage in the last 7 days, reply exactly ` +
    `"No recent campaign coverage found." Cite each claim with sources.`
  );
}

export async function searchGeminiNews(candidateName: string): Promise<NewsResult> {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT not set");

  const vertex = createVertex({ project, location });
  const model = vertex("gemini-2.0-flash-exp");

  const { text, sources: sdkSources } = await generateText({
    model,
    prompt: buildGeminiNewsPrompt(candidateName),
  });

  const rawSources: NewsSource[] = ((sdkSources ?? []) as Array<{
    url?: string;
    title?: string;
  }>)
    .filter((s) => s.url)
    .map((s) => ({
      title: s.title ?? "",
      url: s.url!,
      snippet: "",
      date: null,
    }));

  const sources = NO_COVERAGE_RE.test(text)
    ? []
    : filterRelevantSources(rawSources, candidateName);

  return { answer: text, sources, relatedQuestions: [] };
}
