"""
Capability spike: test how well each search API finds candidate issue positions.

Run from the agent/ directory:
    uv run python -m scripts.test_position_search                        # all three models
    uv run python -m scripts.test_position_search --models gemini-search-grounding
    uv run python -m scripts.test_position_search --models sonar-pro sonar-deep-research

Requires (per model):
    sonar-pro / sonar-deep-research: PERPLEXITY_API_KEY env var
    gemini-search-grounding:         GOOGLE_CLOUD_PROJECT env var + ADC credentials

Outputs a report comparing models on:
    - hit rate (found a direct statement vs. inferred/missing)
    - citation quality (civic domains vs. partisan sources)
    - evidence freshness (2025-2026 dates)
    - latency (seconds per query)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
from typing import Any

import httpx

PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/chat/completions"

CIVIC_DOMAINS = [
    "congress.gov", "fec.gov", "ballotpedia.org", "opensecrets.org",
    "votesmart.org", "govtrack.us", "house.gov", "senate.gov", "gpo.gov",
    "politifact.com", "factcheck.org", "apnews.com", "reuters.com",
    "npr.org", "pbs.org", "nytimes.com", "washingtonpost.com",
    "wsj.com", "thehill.com", "rollcall.com",
]

NONPARTISAN_SYSTEM = (
    "You are a nonpartisan civic research assistant. "
    "Report only what verifiable sources say. "
    "Distinguish direct candidate statements from third-party characterizations. "
    "If no direct statement exists in the sources, say so explicitly with the phrase "
    "'NO DIRECT STATEMENT FOUND'. "
    "Never recommend how to vote. Never infer positions from donors or party alone. "
    "Cite every factual claim with inline numeric markers [1], [2], etc."
)

# Real 2026 candidates — mix of incumbents and challengers
TEST_CASES: list[tuple[str, str, str]] = [
    ("Mike Quigley", "IL", "healthcare"),
    ("Mike Quigley", "IL", "housing affordability"),
    ("Kevin Hern", "OK", "immigration"),
    ("Markwayne Mullin", "OK", "healthcare"),
    ("Hillary Scholten", "MI", "climate change"),
    ("Hillary Scholten", "MI", "housing affordability"),
    ("Mark Tedford", "OK", "healthcare"),
]


def build_position_prompt(candidate_name: str, state: str, issue: str) -> str:
    return (
        f"What has {candidate_name}, congressional candidate from {state}, "
        f"publicly said about {issue}? "
        "Prioritize direct statements from: campaign website, press releases, "
        "floor speeches, voting record, debate transcripts, verified questionnaires. "
        "If only third-party characterizations exist, label them as such. "
        "If no direct statement is found, say 'NO DIRECT STATEMENT FOUND' explicitly."
    )


async def query_perplexity(
    prompt: str,
    model: str,
    timeout: float = 60.0,
) -> dict[str, Any]:
    api_key = os.environ.get("PERPLEXITY_API_KEY", "")
    if not api_key:
        raise RuntimeError("PERPLEXITY_API_KEY not set")

    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": NONPARTISAN_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "max_tokens": 1500,
        "return_related_questions": False,
        "return_images": False,
        "search_domain_filter": CIVIC_DOMAINS[:20],
        "search_recency_filter": "year",
        "web_search_options": {"search_context_size": "high"},
    }

    start = time.perf_counter()
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            PERPLEXITY_ENDPOINT,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()

    elapsed = time.perf_counter() - start

    answer: str = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    raw_sources: list[dict[str, Any]] = data.get("search_results", [])

    return {
        "answer": answer,
        "sources": raw_sources,
        "latency_s": round(elapsed, 2),
        "model": model,
    }


async def query_gemini_grounding(
    prompt: str,
    timeout: float = 90.0,
) -> dict[str, Any]:
    from google import genai
    from google.genai import types as gtypes

    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")
    if not project:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT not set")

    client = genai.Client(vertexai=True, project=project, location=location)

    config = gtypes.GenerateContentConfig(
        system_instruction=NONPARTISAN_SYSTEM,
        tools=[gtypes.Tool(google_search=gtypes.GoogleSearch())],
        temperature=0.2,
    )

    start = time.perf_counter()
    response = await asyncio.wait_for(
        client.aio.models.generate_content(
            model="gemini-3.1-pro-preview",
            contents=prompt,
            config=config,
        ),
        timeout=timeout,
    )
    elapsed = time.perf_counter() - start

    answer = response.text or ""

    # Normalize grounding chunks to the same {url, title, date} shape as Perplexity sources
    sources: list[dict[str, Any]] = []
    for candidate in response.candidates or []:
        meta = getattr(candidate, "grounding_metadata", None)
        if not meta:
            continue
        for chunk in getattr(meta, "grounding_chunks", []) or []:
            web = getattr(chunk, "web", None)
            if web:
                sources.append({
                    "url": getattr(web, "uri", "") or "",
                    "title": getattr(web, "title", "") or "",
                    "date": "",  # Gemini grounding chunks don't include source dates
                })

    return {
        "answer": answer,
        "sources": sources,
        "latency_s": round(elapsed, 2),
        "model": "gemini-search-grounding",
    }


def score_result(result: dict[str, Any], candidate_name: str) -> dict[str, Any]:
    answer = result["answer"].lower()
    sources = result["sources"]

    direct_statement = "no direct statement found" not in answer
    civic_sources = sum(
        1 for s in sources
        if any(d in s.get("url", "") for d in CIVIC_DOMAINS)
    )
    total_sources = len(sources)
    fresh_sources = sum(
        1 for s in sources
        if s.get("date", "") and ("2025" in s.get("date", "") or "2026" in s.get("date", ""))
    )

    return {
        "direct_statement": direct_statement,
        "total_sources": total_sources,
        "civic_sources": civic_sources,
        "fresh_sources": fresh_sources,
        "latency_s": result["latency_s"],
        "answer_preview": result["answer"][:200].replace("\n", " "),
    }


async def run_single_test(
    candidate: str,
    state: str,
    issue: str,
    model: str,
) -> dict[str, Any]:
    prompt = build_position_prompt(candidate, state, issue)
    try:
        if model == "gemini-search-grounding":
            result = await query_gemini_grounding(prompt)
        else:
            result = await query_perplexity(prompt, model)
        score = score_result(result, candidate)
        return {"candidate": candidate, "state": state, "issue": issue, "model": model, **score}
    except Exception as exc:
        return {
            "candidate": candidate,
            "state": state,
            "issue": issue,
            "model": model,
            "error": str(exc),
            "direct_statement": False,
            "total_sources": 0,
            "civic_sources": 0,
            "fresh_sources": 0,
            "latency_s": -1,
            "answer_preview": "",
        }


async def main() -> None:
    parser = argparse.ArgumentParser(description="Test candidate position search APIs")
    parser.add_argument(
        "--models",
        nargs="+",
        default=["sonar-pro", "sonar-deep-research", "gemini-search-grounding"],
        choices=["sonar-pro", "sonar-deep-research", "gemini-search-grounding"],
        metavar="MODEL",
        help=(
            "Which models to test. Choices: sonar-pro, sonar-deep-research, "
            "gemini-search-grounding. Default: all three."
        ),
    )
    args = parser.parse_args()
    models: list[str] = args.models

    all_results: list[dict[str, Any]] = []

    for model in models:
        print(f"\n{'='*60}")
        print(f"Testing model: {model}")
        print(f"{'='*60}")

        # Sequential to avoid rate limits — sonar-deep-research and Gemini are slow
        for candidate, state, issue in TEST_CASES:
            print(f"  {candidate} ({state}) | {issue}...", end=" ", flush=True)
            result = await run_single_test(candidate, state, issue, model)
            all_results.append(result)

            if "error" in result:
                print(f"❌ ERROR: {result['error'][:60]}")
            else:
                status = "✅ DIRECT" if result.get("direct_statement") else "⚠️  NO DIRECT"
                sources = f"{result.get('civic_sources', 0)}/{result.get('total_sources', 0)} civic"
                latency = f"{result.get('latency_s', -1):.1f}s"
                print(f"{status} | {sources} | {latency}")

            await asyncio.sleep(1.0)

    print(f"\n{'='*60}")
    print("SUMMARY COMPARISON")
    print(f"{'='*60}")

    for model in models:
        model_results = [r for r in all_results if r.get("model") == model and "error" not in r]
        if not model_results:
            errors = [r for r in all_results if r.get("model") == model and "error" in r]
            print(f"\n{model}: no valid results ({len(errors)} errors)")
            continue

        hit_rate = sum(1 for r in model_results if r["direct_statement"]) / len(model_results) * 100
        avg_civic = sum(r["civic_sources"] for r in model_results) / len(model_results)
        avg_fresh = sum(r["fresh_sources"] for r in model_results) / len(model_results)
        avg_latency = sum(r["latency_s"] for r in model_results) / len(model_results)

        note = " (dates not provided by API)" if model == "gemini-search-grounding" else ""
        print(f"\n{model}:")
        print(f"  Hit rate (direct statement found): {hit_rate:.0f}%")
        print(f"  Avg civic sources per query:       {avg_civic:.1f}")
        print(f"  Avg fresh sources (2025-2026):     {avg_fresh:.1f}{note}")
        print(f"  Avg latency:                       {avg_latency:.1f}s")

    output_path = "scripts/position_search_test_results.json"
    with open(output_path, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"\nFull results saved to {output_path}")


if __name__ == "__main__":
    asyncio.run(main())
