# Devpost Submission Checklist for DistrictLens

**Author:** Manus AI  
**Date:** May 07, 2026  
**Hackathon:** Google Cloud Rapid Agent Hackathon  
**Recommended track:** MongoDB

## 1. Submission readiness purpose

This checklist ensures the DistrictLens build is shaped for the Rapid Agent Hackathon submission process. A technically strong project can still underperform if the demo, repository, hosted URL, track selection, and open-source readiness are not aligned with the official requirements.[1]

## 2. Required submission assets

| Asset | Required action | Acceptance criterion |
|---|---|---|
| Hosted project URL | Deploy the frontend and backend to a public URL. | A judge can open the app without local setup. |
| Public repository | Make the source repository public before submitting. | The Devpost link resolves to a public repository. |
| Open-source license | Add a `LICENSE` file to the repository root. | GitHub detects the license in repository metadata. |
| Demo video | Record roughly three minutes showing the core agent mission. | Video shows problem, agent workflow, partner MCP use, cited answer, and guardrail behavior. |
| Partner track | Select MongoDB if the final demo uses MongoDB MCP as the required partner integration. | Track choice matches the visible integration in the demo. |
| Project description | Write a concise explanation of DistrictLens as a nonpartisan civic transparency agent. | Description avoids partisan persuasion claims. |
| Screenshots | Capture race search, candidate cards, evidence brief, and agent trace. | Screenshots clearly show the product and cited evidence. |
| Technologies used | List Gemini, Google Cloud Agent Builder or Agent Starter Pack, Cloud Run, MongoDB MCP, FEC API, Congress.gov API, and optional search API. | Tech list matches the implemented system. |

## 3. Three-minute video script

| Timestamp | Script beat | Visual |
|---|---|---|
| 0:00–0:25 | “Election information is public but fragmented across campaign-finance records, Congress.gov, campaign websites, and local sources.” | Show fragmented source logos or app landing page. |
| 0:25–0:45 | “DistrictLens is a nonpartisan agent that builds evidence-backed race briefs.” | Show race search. |
| 0:45–1:30 | User asks: “Build a neutral brief for this congressional race, including candidates, money flows, incumbent context, and housing positions.” | Show agent activity trace and partner MCP calls. |
| 1:30–2:20 | Agent displays candidate cards, FEC finance summary, issue claims, quotes, citations, confidence, and limitations. | Show final brief with citations and evidence drawer. |
| 2:20–2:45 | User asks: “Who should I vote for?” Agent refuses vote recommendation and offers neutral comparison. | Show civic guardrail response. |
| 2:45–3:00 | “Built with Gemini, Google Cloud Agent Builder, MongoDB MCP, FEC, and Congress.gov to make election evidence easier to verify.” | Show architecture or repository. |

## 4. Pre-submission technical checks

| Check | Command or method | Pass condition |
|---|---|---|
| Environment variables documented | Inspect `.env.example`. | All required keys are listed with safe placeholders. |
| API health | `GET /api/health` | Returns service status and dependency statuses without leaking secrets. |
| Race data present | `GET /api/races?cycle=2026&office=H` | Returns seeded demo races. |
| Agent brief works | `POST /api/agent/ask` | Returns cited answer and trace events. |
| MCP trace visible | UI trace or backend log | At least one partner MCP call appears in the demo path. |
| Source citations valid | Click citations in UI | Links open to FEC, Congress.gov, campaign page, questionnaire, or stored source. |
| Refusal guardrail | Ask for vote recommendation | Agent refuses recommendation and offers neutral evidence comparison. |
| Repository license | GitHub repository page | License appears in repository metadata. |

## 5. Repository checklist for Claude Code

Claude Code should create or verify these files in the implementation repository.

| File | Required content |
|---|---|
| `README.md` | Product description, setup, environment variables, local development, deployment, and demo instructions. |
| `LICENSE` | Open-source license selected by the team. |
| `.env.example` | Safe placeholders for FEC, Congress.gov, MongoDB, Google Cloud, Gemini, search, and optional Elastic. |
| `docs/architecture.md` | Implemented architecture and data flow. |
| `docs/data-sources.md` | FEC, Congress.gov, candidate issue evidence, source-discovery policy, and limitations. |
| `docs/civic-guardrails.md` | Nonpartisan and citation rules. |
| `tests/` | Unit tests for data normalization, claim extraction schema validation, and guardrails. |

## 6. References

[1]: https://rapid-agent.devpost.com/ "Google Cloud Rapid Agent Hackathon Overview"  
[2]: https://rapid-agent.devpost.com/resources "Google Cloud Rapid Agent Hackathon Resources"  
[3]: https://rapid-agent.devpost.com/details/mongodb-resources "MongoDB Resources for Google Cloud Rapid Agent Hackathon"


## Agents CLI Evidence for Submission

The final Devpost submission should explicitly state that DistrictLens was built with Google Agents CLI. Include screenshots or short video segments showing the scaffolded project, an `agents-cli run` local test if available, evaluation output from `agents-cli eval run` if available, and the deployed Google Cloud demo path.
