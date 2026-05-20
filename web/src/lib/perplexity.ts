const ENDPOINT = "https://api.perplexity.ai/v1/sonar";
const MODEL = "sonar-pro";
const TIMEOUT_MS = 30_000;

const CIVIC_DOMAINS = [
  "congress.gov", "fec.gov", "ballotpedia.org", "opensecrets.org",
  "votesmart.org", "govtrack.us", "house.gov", "senate.gov", "gpo.gov",
  "politifact.com", "factcheck.org", "apnews.com", "reuters.com",
  "npr.org", "pbs.org", "nytimes.com", "washingtonpost.com",
  "wsj.com", "thehill.com", "rollcall.com",
];

const NONPARTISAN_SYSTEM = [
  "You are a nonpartisan civic research assistant.",
  "Report only what verifiable sources say.",
  "Distinguish direct candidate statements from third-party characterizations.",
  "If no direct statement exists in the sources, say so explicitly.",
  "Never recommend how to vote. Never infer positions from donors or party alone.",
  "Cite every factual claim with inline numeric markers [1], [2], etc.",
].join(" ");

export interface PerplexitySource {
  title: string;
  url: string;
  date: string | null;
  snippet: string;
}

export interface PerplexityResult {
  answer: string;
  sources: PerplexitySource[];
  relatedQuestions: string[];
}

export function buildPositionPrompt(candidateName: string, issue: string): string {
  return (
    `What has ${candidateName} publicly said about ${issue}? ` +
    `Prioritize direct statements (campaign website, press releases, floor speeches, ` +
    `voting record, debate transcripts, verified questionnaires). ` +
    `If only third-party characterizations exist, label them as such. ` +
    `If no direct statement is found in the sources, say so explicitly.`
  );
}

export function buildNewsPrompt(candidateName: string): string {
  return (
    `Summarize news coverage of ${candidateName} from the last 7 days. ` +
    `Focus on campaign activities, public statements, debate appearances, ` +
    `polling, endorsements, and significant controversies. Cite each claim.`
  );
}

export function extractCitations(
  citations: string[],
  searchResults: Array<{ title?: string; url: string; date?: string; snippet?: string }>
): PerplexitySource[] {
  return citations.map((url) => {
    const match = searchResults.find((sr) => sr.url === url);
    return {
      title: match?.title ?? url,
      url,
      date: match?.date ?? null,
      snippet: match?.snippet ?? "",
    };
  });
}

export async function searchPerplexity(
  prompt: string,
  options: {
    recency?: "hour" | "day" | "week" | "month" | "year";
    domainAllowlist?: string[];
    searchContextSize?: "low" | "medium" | "high";
  } = {}
): Promise<PerplexityResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY not configured");

  const payload: Record<string, unknown> = {
    model: MODEL,
    messages: [
      { role: "system", content: NONPARTISAN_SYSTEM },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 1500,
    return_related_questions: true,
    return_images: false,
    web_search_options: { search_context_size: options.searchContextSize ?? "medium" },
  };
  if (options.recency) payload.search_recency_filter = options.recency;
  if (options.domainAllowlist?.length) payload.search_domain_filter = options.domainAllowlist.slice(0, 20);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Perplexity API ${response.status}: ${body}`);
  }

  const data = await response.json();
  const answer: string = data.choices?.[0]?.message?.content ?? "";
  const citations: string[] = data.citations ?? [];
  const rawSources = data.search_results ?? [];
  const sources = extractCitations(citations, rawSources);

  return { answer, sources, relatedQuestions: data.related_questions ?? [] };
}

export { CIVIC_DOMAINS };
