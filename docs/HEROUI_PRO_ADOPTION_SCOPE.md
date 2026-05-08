# HeroUI Pro Adoption Scope for DistrictLens

> **STATUS: SUPERSEDED 2026-05-08** — DistrictLens now uses **OSS HeroUI** (`@heroui/react`, MIT). The Pro adoption scope, MCP setup, and `HEROUI_PERSONAL_TOKEN` guidance below do not apply. The Civic Brutal theme rules and component map are still useful as design guidance — implement them against `@heroui/react` (OSS) component names. See [DECISIONS_LOG.md](./DECISIONS_LOG.md) §1.1.

**Author:** Manus AI  
**Date:** May 07, 2026

## Scope decision

DistrictLens should adopt **HeroUI Pro** as the front-end design system for the hackathon MVP and use the **Brutalism** theme as the starting point for a restrained **Civic Brutal** visual language. HeroUI Pro should not alter the agent architecture or civic data-source hierarchy. It should accelerate the React implementation and make the product feel polished, distinctive, and demo-ready.

## Runtime versus development-time responsibilities

| Layer | Responsibility | DistrictLens usage |
|---|---|---|
| HeroUI Pro runtime components | Deterministic React UI components, templates, theme variables, layout primitives, cards, tables, charts, sheets, sidebars, and command surfaces. | Build the main dashboard, ballot/race pages, candidate comparison, finance summaries, evidence drawers, and source trace views. |
| CopilotKit runtime | Agent panel, frontend actions, typed generative UI, visible tool activity, and human-in-the-loop prompts. | Render the right-side DistrictLens analyst panel and allow the agent to call approved UI actions. |
| HeroUI Pro MCP | Development-time documentation and CSS/theme lookup for Claude Code or another AI coding assistant. | Use while building; do not require the deployed app to call the MCP. |
| HeroUI OSS MCP | Development-time docs for base `@heroui/react` components. | Optional companion for base components such as Button, Card, Modal, and Input. |

## Civic Brutal theme rules

The Brutalism theme should be adapted into a civic research aesthetic. The app should use hard-edged structure, bold borders, high-contrast labels, and compact information density. However, DistrictLens should avoid exaggerated campaign colors, chaotic type treatments, or playful political motifs. The visual system should communicate: **evidence first, agent assisted, nonpartisan by design**.

| Token area | Recommendation |
|---|---|
| Base background | White or off-white workspace with black/slate structural borders. |
| Accent | One restrained civic accent such as cyan, gold, or electric blue for active states. |
| Party colors | Use only as small metadata pills; never as dominant backgrounds. |
| Typography | Strong sans-serif hierarchy with readable body copy and compact table labels. |
| Borders | Strong 1–2 px borders and clear card separation. |
| Motion | Subtle transitions only; avoid flashy animation during evidence review. |
| Accessibility | Preserve high contrast, focus rings, keyboard navigation, and readable table density. |

## Recommended MVP component map

| DistrictLens screen | HeroUI Pro components/patterns | Notes |
|---|---|---|
| Landing / district lookup | Command Palette, input, card grid, sample district buttons | Keep lookup fast; show nonpartisan disclaimer. |
| App shell | Sidebar, top bar, responsive layout, theme toggle if useful | Use three-column desktop layout: nav, workspace, agent. |
| Race overview | KPI cards, charts, summary cards, badges | Show office, district, cycle, incumbent/open-seat status, candidate count, freshness. |
| Candidate compare | Data Grid, candidate cards, chips, expandable rows | This should remain the hero component. |
| Money flow | KPI cards, horizontal bars, compact tables, charts | Tie every finance number to FEC timestamp/source metadata. |
| Issue evidence | Sheet/drawer, evidence cards, source timeline, confidence tags | Must show quote, source URL, source type, date, and confidence. |
| Ballot layer | Grouped cards, filters, Data Grid, ballot-measure cards | Support federal, state, local, and ballot-measure groupings. |
| Agent panel | HeroUI shell around CopilotKit panel | CopilotKit should render approved HeroUI-based components through typed props. |

## MCP setup guidance for Claude Code

The package should include a `.mcp.example.json` snippet for the HeroUI Pro MCP but not include secrets. The user should obtain `HEROUI_PERSONAL_TOKEN` from the HeroUI Pro dashboard and configure it locally. The setup should also mention that the Pro MCP is for `@heroui-pro/react` docs and CSS/theme variants, while the separate OSS HeroUI MCP covers base `@heroui/react` components.

```json
{
  "mcpServers": {
    "heroui-pro": {
      "type": "http",
      "url": "https://mcp.heroui.pro/mcp",
      "headers": {
        "x-heroui-personal-token": "HEROUI_PERSONAL_TOKEN"
      }
    },
    "heroui": {
      "command": "npx",
      "args": ["-y", "@heroui/mcp"]
    }
  }
}
```

## Implementation guardrails

The project should remain private if copied HeroUI Pro component source is included. Public project descriptions can describe the design system and show screenshots, but should not redistribute Pro source code. The actual personal token must never be checked into `.env`, `.mcp.json`, GitHub, the ZIP package, or any public demo artifact.

Claude Code should be instructed to ask the HeroUI Pro MCP for exact component APIs, theme variables, and Brutalism CSS before implementing major UI surfaces. It should avoid inventing component names or props when the MCP is available.
