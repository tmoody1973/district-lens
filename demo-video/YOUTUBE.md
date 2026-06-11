# YouTube upload — title & description

## Title

DistrictLens — A Nonpartisan AI Agent for Congressional Races | Gemini 3 + MongoDB MCP (Google Cloud Rapid Agent Hackathon)

*(Alternate, shorter:)* DistrictLens: Evidence-First Election Intelligence, Built on Gemini 3 + MongoDB MCP

## Description

```text
Election information is public — FEC filings, Congress.gov, campaign websites — but it's scattered across a dozen sources. DistrictLens is a nonpartisan AI agent that assembles it in seconds: cited, dated, and evidence-first. It compares what candidates have actually said and done, shows where every claim came from — and refuses to tell you how to vote.

Built for the Google Cloud Rapid Agent Hackathon (MongoDB partner track).

WHAT'S IN THE DEMO
0:00 Intro
0:08 The problem — public data, scattered everywhere
0:28 A voter brief builds live: district resolution, candidates, finance, voting record, and cited issue positions — verified through the MongoDB MCP server in the default path
1:01 Follow the money — live FEC API call renders a donor card, with the guardrail printed on the data itself
1:21 "Who should I vote for?" — the agent refuses, and offers cited comparison instead (three-layer civic-safety architecture)
1:38 Take it with you — copy the brief as cited markdown, export it, share a permalink that rebuilds the race on demand
1:47 The stack

HOW IT'S BUILT
• Gemini 3.1 Pro (reasoning + answers) and Gemini 3.5 Flash with Google Search grounding (evidence research) via the Gemini agent platform Developer SDK (ADK, code-first)
• MongoDB MCP server — the partner integration: 3,000+ candidates, 470 races, campaign finance, voting records, and an archived evidence store live in MongoDB; the agent reads, writes back, and verifies through MCP on every brief
• Deployed on Google Cloud Run; civic-safety evals gate every change via the Agents CLI

CIVIC SAFETY
DistrictLens never recommends a candidate, never infers positions from party or donors, and says so plainly when evidence is missing. Every factual claim links to a stored, dated source.

LINKS
Live app: https://districtlens-web-655022470154.us-central1.run.app
Source code: https://github.com/tmoody1973/district-lens

Data sources: FEC, Congress.gov, candidate campaign materials, and archived public web sources. DistrictLens is nonpartisan civic infrastructure — evidence in, decision yours.

#GoogleCloud #Gemini #MongoDB #MCP #AIAgents #CivicTech #Elections2026 #Hackathon
```

## Thumbnail

`out/youtube-thumbnail.png` (1280×720) — regenerate with:
`node -e` snippet in git history, or edit `thumbnail.html` and re-screenshot.

## Upload settings suggestions

- Category: Science & Technology
- Visibility: Public or Unlisted (Devpost accepts both; judges need the link to work)
- Add the chapter timestamps above to enable YouTube chapters (already formatted)
