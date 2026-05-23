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

/** FEC stores names as "Last, First Middle"; web search matches "First Last" far better. */
export function normalizeCandidateName(candidateName: string): string {
  if (candidateName.includes(",")) {
    const [last, first] = candidateName.split(",", 2);
    return `${first.trim()} ${last.trim()}`.trim();
  }
  return candidateName.trim();
}

export function buildNewsPrompt(candidateName: string): string {
  const name = normalizeCandidateName(candidateName);
  return (
    `Summarize recent news coverage of ${name}, a 2026 U.S. congressional ` +
    `candidate, from the last 7 days. Only include coverage about this person as ` +
    `a political candidate or officeholder: campaign activities, public ` +
    `statements, debates, polling, endorsements, fundraising, or controversies. ` +
    `Ignore unrelated results that merely match the name (films, businesses, ` +
    `other people). If there is no election-related coverage, reply exactly ` +
    `"No recent campaign coverage found." Cite each claim.`
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
  const rawSources: Array<{ title?: string; url: string; date?: string; last_updated?: string; snippet?: string }> =
    data.search_results ?? [];
  const sources: PerplexitySource[] = rawSources.map((sr) => ({
    title: sr.title ?? sr.url,
    url: sr.url,
    date: sr.date ?? sr.last_updated ?? null,
    snippet: sr.snippet ?? "",
  }));

  return { answer, sources, relatedQuestions: data.related_questions ?? [] };
}

export { CIVIC_DOMAINS };
