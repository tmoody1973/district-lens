import { describe, it, expect } from "vitest";
import { buildPositionPrompt, buildNewsPrompt, extractCitations } from "@/lib/perplexity";

describe("buildPositionPrompt", () => {
  it("includes candidate name and issue", () => {
    const prompt = buildPositionPrompt("Gwen Moore", "housing");
    expect(prompt).toContain("Gwen Moore");
    expect(prompt).toContain("housing");
  });

  it("requests direct statements", () => {
    const prompt = buildPositionPrompt("Jane Doe", "climate");
    expect(prompt.toLowerCase()).toContain("direct");
  });
});

describe("buildNewsPrompt", () => {
  it("includes candidate name", () => {
    const prompt = buildNewsPrompt("John Smith");
    expect(prompt).toContain("John Smith");
  });
});

describe("extractCitations", () => {
  it("returns empty array for empty citations", () => {
    expect(extractCitations([], [])).toEqual([]);
  });

  it("merges search_results with citation URLs", () => {
    const citations = ["https://example.com/1", "https://example.com/2"];
    const searchResults = [
      { title: "Article 1", url: "https://example.com/1", date: "2026-01-01", snippet: "text" },
    ];
    const result = extractCitations(citations, searchResults);
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe("https://example.com/1");
    expect(result[0].title).toBe("Article 1");
    expect(result[1].url).toBe("https://example.com/2");
    expect(result[1].title).toBe("https://example.com/2");
  });
});
