/**
 * Recent-news search powered by Gemini 3.5 Flash with Google Search grounding.
 * Uses the Vertex AI REST API directly (same approach as the Python agent service)
 * to avoid AI SDK model-name resolution quirks.
 *
 * Replaces Perplexity — no competing AI service is called at runtime.
 */

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
const GROUNDING_MODEL = "gemini-3.5-flash";

function buildPrompt(candidateName: string): string {
  const name = normalizeCandidateName(candidateName);
  return (
    `Search for recent news coverage of ${name}, a 2026 U.S. congressional candidate, ` +
    `from the last 7 days. Only include coverage about this person as a political ` +
    `candidate or officeholder: campaign activities, public statements, debates, ` +
    `polling, endorsements, fundraising, or controversies. ` +
    `Ignore results that merely match the name (films, businesses, other people). ` +
    `If there is no election-related coverage in the last 7 days, reply exactly ` +
    `"No recent campaign coverage found." Cite each claim.`
  );
}

async function getAccessToken(): Promise<string> {
  // Cloud Run provides credentials via the metadata server (no SDK needed).
  const res = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } }
  );
  if (!res.ok) throw new Error(`Metadata server ${res.status}`);
  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

export async function searchGeminiNews(candidateName: string): Promise<NewsResult> {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT not set");
  const location = "us-central1"; // grounding only available at a regional endpoint

  const token = await getAccessToken();
  const endpoint =
    `https://aiplatform.googleapis.com/v1/projects/${project}` +
    `/locations/${location}/publishers/google/models/${GROUNDING_MODEL}:generateContent`;

  const body = {
    contents: [{ role: "user", parts: [{ text: buildPrompt(candidateName) }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: { temperature: 0.1 },
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini news ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      groundingMetadata?: {
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      };
    }>;
  };

  const cand = data.candidates?.[0];
  const answer = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const chunks = cand?.groundingMetadata?.groundingChunks ?? [];

  const rawSources: NewsSource[] = chunks
    .map((c) => ({ title: c.web?.title ?? "", url: c.web?.uri ?? "", snippet: "", date: null }))
    .filter((s) => s.url);

  const sources = NO_COVERAGE_RE.test(answer)
    ? []
    : filterRelevantSources(rawSources, candidateName);

  return { answer, sources, relatedQuestions: [] };
}
