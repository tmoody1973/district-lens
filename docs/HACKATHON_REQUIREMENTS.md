# Hackathon Requirements and Judging Alignment: DistrictLens

**Author:** Manus AI  
**Date:** May 07, 2026  
**Recommended submission track:** MongoDB primary track, with Elastic as an alternate track option  
**Status:** Claude Code-ready requirement mapping

## 1. Why this document exists

DistrictLens should be built specifically for the **Google Cloud Rapid Agent Hackathon**, not as a generic civic-data application. The hackathon asks teams to build functional agents that solve real-world challenges, use Gemini and Google Cloud Agent Builder, and integrate at least one participating partner’s MCP server. DistrictLens addresses the real-world challenge of fragmented election information by creating a nonpartisan agent that can assemble cited race briefs, campaign-finance summaries, incumbent legislative context, and candidate issue evidence for upcoming congressional races.[1]

> **Hackathon positioning:** DistrictLens is not a voter persuasion product. It is an evidence-grounded civic transparency agent that performs multi-step research tasks under user control and produces source-backed election briefs.

## 2. Official hackathon requirements mapped to DistrictLens

| Hackathon requirement | DistrictLens implementation decision | Evidence to show in demo |
|---|---|---|
| Build a functional agent that solves a real-world challenge. | The agent helps voters, journalists, educators, and civic researchers understand congressional races using structured public data and cited source evidence. | Ask the agent to build a race brief for a selected district and show it retrieving data, checking evidence, and producing a cited answer. |
| Move beyond chat. | The agent uses tools for FEC ingestion, race construction, Congress.gov enrichment, source discovery, page fetching, claim extraction, search retrieval, and answer generation. | Show the agent taking a user goal such as “Create a finance and issue brief for NY-04” and executing multiple steps. |
| Handle a multi-step mission. | The core mission flow is: resolve race, fetch candidates, classify incumbents and challengers, retrieve finance totals, enrich incumbents, discover issue sources, extract claims, and write a cited brief. | Show an execution trace or UI activity feed with each tool call and its result. |
| Use Gemini and Google Cloud Agent Builder. | Use Gemini as the reasoning and answer-generation model. Use Google Cloud Agent Builder or the Agent Starter Pack as the orchestration/deployment foundation, with Cloud Run for custom services. | Show environment configuration, agent service deployment, and model/tool orchestration. |
| Integrate a participating partner’s MCP server. | Default track: integrate **MongoDB MCP Server** to let the agent query operational memory, candidate records, source documents, issue claims, and brief cache. Alternate track: integrate **Elastic MCP Server** for hybrid retrieval over evidence documents. | Show the agent using the selected partner MCP server during the demo, not just storing data passively. |
| Submit hosted project URL. | Deploy the web app and agent API to Cloud Run or equivalent hosted infrastructure. | Include the live app URL in Devpost. |
| Submit public open-source code repository with license. | Repository must be public before submission and include a complete open-source license file visible in GitHub repository metadata. | Include GitHub URL and verify license detection. |
| Submit roughly three-minute demo video. | Demo should focus on one compelling race and one agent mission. | Video script should show problem, agent mission, tool execution, cited answer, and partner integration. |
| Select track on Devpost. | Select MongoDB if using MongoDB MCP as the required partner integration. Select Elastic only if Elastic MCP is the visible partner tool in the final demo. | Devpost form track matches the architecture and demo. |

## 3. Judging criteria alignment

DistrictLens should be framed around a clear judging narrative. The project’s strength is not that it has election data; it is that it transforms fragmented public information into a transparent, auditable, nonpartisan agent workflow.

| Judging criterion | DistrictLens scoring strategy | Build implication |
|---|---|---|
| Technological Implementation | Demonstrate a reliable multi-tool agent with clear data pipelines, schema validation, partner MCP use, citations, caching, and failure handling. | Prioritize visible tool execution, tests, trace logs, and partner MCP integration over cosmetic features. |
| Design | Present a simple civic brief experience with race search, candidate cards, finance summary, issue evidence, and “why this answer is supported” panels. | UI should make source evidence visible and use plain-language explanations. |
| Potential Impact | Midterm election information affects voters, journalists, educators, and civic organizations. The impact story is strongest when the agent helps users evaluate evidence without telling them how to vote. | Demo should focus on voter trust, local journalism support, and media-literacy education. |
| Quality of the Idea | DistrictLens is timely because it combines campaign finance, congressional behavior, district context, and candidate statements into one agentic workflow. | Avoid generic “AI voter guide” language; emphasize evidence reconciliation and civic guardrails. |

## 4. Recommended partner-track choice

The package recommends **MongoDB as the primary hackathon track** because DistrictLens depends on trustworthy operational memory. MongoDB Atlas can store normalized races, candidate records, FEC snapshots, source documents, extracted claims, user-visible evidence cards, and cached briefs. The MongoDB hackathon resource page explicitly positions MongoDB Atlas as a unified operational foundation and persistent memory layer for AI and agentic workloads, and lists MongoDB MCP Server, Atlas Search, Vector Search, aggregations, and data modeling resources.[3]

Elastic is the best alternate track if the team wants to emphasize **search relevance** and hybrid retrieval as the project’s core technical advantage. If Elastic is selected, Elastic should become the main evidence-retrieval layer and the Elastic MCP server should be the visible partner integration. MongoDB may still be used for app persistence, but it should not be the partner story unless MongoDB is the selected Devpost track.

| Track choice | Best story | Recommended if |
|---|---|---|
| MongoDB primary | “Persistent civic memory for trustworthy election agents.” | You want the cleanest schema, cache, issue-claim, and agent-memory story. |
| Elastic primary | “Hybrid search over civic evidence for explainable election intelligence.” | You want to compete on retrieval quality, source ranking, and evidence discovery. |
| Both | “MongoDB stores civic memory; Elastic retrieves evidence.” | Acceptable technically, but only one partner track should be the clear submission story. |

## 5. Demo mission requirements

The demo should show a real agent mission rather than a static dashboard. The recommended three-minute flow is:

| Minute | Demo beat | What the judge should see |
|---|---|---|
| 0:00–0:30 | Problem and target race | Election information is public but fragmented across FEC, Congress.gov, campaign pages, and local sources. |
| 0:30–1:20 | Agent mission | User asks: “Build a neutral brief for this House race, including who is running, money flows, incumbent record, and what candidates say about housing or health care.” |
| 1:20–2:10 | Tool execution | The agent resolves the race, queries MongoDB through MCP, retrieves FEC-derived records, enriches with Congress.gov, searches stored issue evidence, and identifies missing evidence. |
| 2:10–2:45 | Cited answer | The UI displays candidate cards, finance summary, issue claims with quotes, source links, confidence labels, and limitations. |
| 2:45–3:00 | Impact and guardrails | The agent refuses a vote recommendation and explains that it provides evidence, not persuasion. |

## 6. Submission checklist

| Submission item | Required action | Owner |
|---|---|---|
| Hosted project URL | Deploy frontend and backend to a public URL. | Engineering |
| Public code repository | Make the repository public before submission. | Engineering |
| Open-source license | Add `LICENSE` and verify GitHub detects it. | Engineering |
| Demo video | Record roughly three minutes with the recommended mission. | Product/demo lead |
| Partner track | Select MongoDB unless the final demo visibly uses Elastic MCP as the required partner integration. | Team lead |
| Devpost form | Complete project description, technologies, screenshots, and video link. | Team lead |
| Data limitations | State that DistrictLens is nonpartisan, evidence-based, and not an official election authority. | Product/demo lead |

## 7. References

[1]: https://rapid-agent.devpost.com/ "Google Cloud Rapid Agent Hackathon Overview"  
[2]: https://rapid-agent.devpost.com/resources "Google Cloud Rapid Agent Hackathon Resources"  
[3]: https://rapid-agent.devpost.com/details/mongodb-resources "MongoDB Resources for Google Cloud Rapid Agent Hackathon"  
[4]: https://github.com/GoogleCloudPlatform/agent-starter-pack "Google Cloud Agent Starter Pack"
