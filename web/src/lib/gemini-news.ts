/**
 * Recent-news search powered by Gemini 3.5 Flash with Google Search grounding.
 * Replaces the Perplexity news search so no competing AI service is called at runtime.
 *
 * Uses the Vertex AI REST API directly — the @ai-sdk/google-vertex package handles
 * auth via Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS or
 * the service account attached to the Cloud Run instance).
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
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? "global";
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT not set");

  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = tokenResponse?.token ?? tokenResponse?.res?.data?.access_token;

  const endpoint =
    `https://${location === "global" ? "aiplatform" : location + "-aiplatform"}.googleapis.com` +
    `/v1/projects/${project}/locations/${location === "global" ? "us-central1" : location}` +
    `/publishers/google/models/gemini-2.0-flash-exp:generateContent`;

  const body = {
    contents: [{ role: "user", parts: [{ text: buildGeminiNewsPrompt(candidateName) }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: { temperature: 0.1 },
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Gemini news error ${res.status}: ${await res.text()}`);
  const data = await res.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      groundingMetadata?: {
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
        searchEntryPoint?: { renderedContent?: string };
      };
    }>;
  };

  const candidate = data.candidates?.[0];
  const answer = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];

  const rawSources: NewsSource[] = chunks
    .map((c) => ({
      title: c.web?.title ?? "",
      url: c.web?.uri ?? "",
      snippet: "",
      date: null,
    }))
    .filter((s) => s.url);

  const sources = NO_COVERAGE_RE.test(answer)
    ? []
    : filterRelevantSources(rawSources, candidateName);

  return { answer, sources, relatedQuestions: [] };
}
