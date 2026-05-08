# DistrictLens UI Tooling Decision: OpenUI vs CopilotKit

> **Note:** Some sections superseded by 2026-05-08 grilling decisions — HeroUI Pro references should be read as **OSS HeroUI** (`@heroui/react`, MIT). CopilotKit is wired through a Next.js proxy to the Python ADK service via AG-UI (not directly). See [DECISIONS_LOG.md](./DECISIONS_LOG.md) §1.1 and §2.2.

**Author:** Manus AI  
**Date:** May 07, 2026

## Recommendation

DistrictLens should use **CopilotKit** for the hackathon MVP’s engaging agent experience and should not add OpenUI as a primary dependency right now. OpenUI is interesting for future dynamic dashboard generation, but CopilotKit is the better fit for the immediate DistrictLens architecture because it directly supports React agent interfaces, ADK-oriented integration, tool rendering, frontend tools, shared state, and human-in-the-loop interactions.

> Decision: Adopt CopilotKit as the right-side agent panel and generative UI layer. Treat OpenUI as a post-MVP experiment for compact streaming dashboard composition, not as core infrastructure for the hackathon build.

## Why CopilotKit fits DistrictLens better

DistrictLens is not just trying to generate arbitrary UI. It needs to make an agent’s work visible, trustworthy, and interactive inside a civic research dashboard. CopilotKit’s documentation describes it as the **frontend stack for agents and generative UI**, connecting agent frameworks or models to React apps for chat, generative UI, canvas apps, and human-in-the-loop workflows.[1] Its ADK documentation specifically positions CopilotKit as a way to bring ADK agents to users through interactive applications, with generative UI, shared state, and human-in-the-loop support.[4]

CopilotKit also maps neatly to DistrictLens’s required UX moments. The agent can render candidate comparison cards, finance charts, ambiguity prompts, and evidence drawers as React components through `useComponent`.[3] It can also call browser-side UI actions through `useFrontendTool`, which is useful for selecting a race, opening an evidence drawer, focusing a candidate card, or prompting the user for a full address when ZIP-only district lookup is ambiguous.[5]

| Criterion | CopilotKit | OpenUI | DistrictLens implication |
|---|---|---|---|
| ADK/Gemini fit | Strong: docs include ADK-specific pages and AG-UI forwarding for frontend tools.[4] [5] | Indirect: model must emit OpenUI Lang and the app must add an OpenUI renderer.[6] | CopilotKit better supports the current Google Agents CLI/ADK direction. |
| Hackathon speed | Strong: prebuilt sidebar, hooks, runtime endpoint, and React component rendering.[1] [2] | Moderate: powerful, but requires teaching the model OpenUI Lang and curating a component library.[6] | CopilotKit reduces integration risk. |
| Visible agent workflow | Strong: chat, tool rendering, shared state, and human-in-the-loop patterns.[3] [4] | Strong for generated UI, less specifically tied to agent workflow state. | CopilotKit makes the partner MCP/tool trace easier to show. |
| Dynamic UI | Strong for registered React components and interactive app control. | Very strong for open-ended compositional UI. | OpenUI is better for future dynamic dashboards, but not necessary for MVP. |
| Civic safety | Easier to constrain because the agent renders approved components with typed props.[3] | Requires strict prompt and renderer validation around generated layouts.[6] | CopilotKit is safer for a nonpartisan civic app. |

## Where CopilotKit should be used

CopilotKit should not replace the main DistrictLens dashboard. It should power the **right-side DistrictLens copilot panel** and selected generative UI surfaces inside the evidence workspace. The main product should remain a structured React dashboard with deterministic components for district lookup, race overview, candidate comparison, campaign finance, issue evidence, and source trace.

The recommended implementation scope is intentionally narrow. First, embed `CopilotKit` and `CopilotSidebar` or a custom headless chat panel. Second, register display components for `DistrictBriefCard`, `CandidateCompareCard`, `FinanceSnapshotChart`, `IssueEvidenceCard`, `ToolTraceTimeline`, and `DistrictAmbiguityPrompt`. Third, add frontend tools for `selectRace`, `openEvidenceDrawer`, `focusCandidate`, `setIssueFilter`, and `requestFullAddress`. Fourth, connect the CopilotKit runtime to the ADK/Gemini backend rather than introducing a separate model path.

## Where OpenUI should not be used yet

OpenUI’s core idea is compelling: the LLM emits a compact, streaming-first language that the frontend renders progressively from a constrained component library.[6] Its documentation claims OpenUI Lang can be up to **67% more token-efficient** than JSON and is designed to render progressively as lines stream.[6] That is useful for rich dashboards, but it adds a second interface protocol to a project that already needs ADK, MongoDB MCP, Geocod.io, FEC, Congress.gov, source discovery, citation guardrails, and a three-minute demo.

For DistrictLens, the biggest MVP risk is not whether the UI can be arbitrarily generated. The risk is whether judges can see a reliable agent workflow using real data, partner MCP, citations, and civic safety. OpenUI would be valuable later if DistrictLens wants the agent to compose custom voter briefs, interactive dashboards, or exploratory visual reports from a component library. For the hackathon, this should remain a stretch experiment.

## Implementation decision

Adopt CopilotKit with the following rule: **all agent-rendered UI must use registered, typed, civic-safe components**. The agent can choose and populate components, but it should not generate arbitrary political persuasion UI or unsourced candidate claims. Every generated card must carry source IDs, confidence labels, and freshness metadata where relevant.

## References

[1]: https://docs.copilotkit.ai/ "CopilotKit Docs"  
[2]: https://docs.copilotkit.ai/quickstart "CopilotKit Quickstart"  
[3]: https://docs.copilotkit.ai/generative-ui "CopilotKit Generative UI"  
[4]: https://docs.copilotkit.ai/adk "CopilotKit ADK Integration"  
[5]: https://docs.copilotkit.ai/adk/frontend-tools "CopilotKit ADK Frontend Tools"  
[6]: https://www.openui.com/docs/openui-lang "OpenUI Introduction"
