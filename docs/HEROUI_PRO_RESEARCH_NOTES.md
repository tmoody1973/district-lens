# HeroUI Pro Research Notes for DistrictLens

> **STATUS: SUPERSEDED 2026-05-08** — DistrictLens uses OSS HeroUI (MIT), not HeroUI Pro. Retained for research provenance. See [DECISIONS_LOG.md](./DECISIONS_LOG.md) §1.1.

**Date:** May 07, 2026

## Verified source findings

HeroUI Pro positions itself as a premium extension of HeroUI OSS for React and React Native. Its official introduction states that it includes **47+ React components** and **404+ examples**, with components such as Command Palette, Data Grid, Sheet, Sidebar, Emoji Picker, Charts, File Tree, and KPI cards. It also includes React Native components, full-page templates, premium themes including **Brutalism** and Glass, a Theme Builder, Figma files, AI tooling, MCP server, agent skills, and design-taste support.

The HeroUI Pro landing page emphasizes that the product includes installable components and blocks for React and React Native, full-page templates, AI Skills and MCPs for tools like Cursor and Claude, and premium design systems. It also says open source end products are allowed, but the Pro component source code itself must not be redistributed or published publicly.

The official HeroUI Pro MCP Server page says the Pro MCP lets an AI agent look up `@heroui-pro/react` component docs, browse the CSS styling system including design tokens, component BEM classes, and theme variants, and read setup guides directly in the editor. It also says the separate HeroUI OSS MCP should be used for base `@heroui/react` components such as Button, Card, and Modal.

The Pro MCP setup uses HTTP transport at `https://mcp.heroui.pro/mcp` with a required `x-heroui-personal-token` header. The Claude Code setup can be added via `claude mcp add --transport http heroui-pro https://mcp.heroui.pro/mcp --header "x-heroui-personal-token: HEROUI_PERSONAL_TOKEN"` or via `.mcp.json` using type `http`, URL `https://mcp.heroui.pro/mcp`, and the personal token header.

The Pro MCP exposes tools named `list_components`, `get_component_docs`, `get_css`, and `get_docs`. The `get_css` tool supports theme-specific calls such as `get_css({ theme: "brutalism" })`, which returns the full theme variant with variables, fonts, and overrides.

The public OSS HeroUI MCP package `@heroui/mcp` supports `@heroui/react v3` only and provides base component documentation, props, examples, source code, source styles, and theme variables. It is installed through `npx -y @heroui/mcp`. This is separate from the Pro MCP.

## Initial DistrictLens implications

HeroUI Pro is a strong fit for the deterministic React dashboard layer because DistrictLens needs Sidebar, Data Grid, KPI cards, charts, command/search surfaces, Sheet/Drawer-style evidence panels, and polished dashboard templates. The Brutalism theme can help the app stand out in a hackathon, but it must be moderated for civic trust: use brutalist geometry, strong borders, and high-contrast hierarchy, while avoiding chaotic colors or novelty treatments that could make nonpartisan evidence feel unserious.

HeroUI Pro should complement, not replace, CopilotKit. HeroUI Pro should provide the base design system and components. CopilotKit should remain the agent interaction layer for chat, generative UI cards, frontend actions, and human-in-the-loop prompts.

The MCP server is useful for Claude Code implementation because it can retrieve precise component docs and Brutalism CSS/theme tokens during development. Because the Pro MCP requires the user's personal token, the package should include setup instructions and an environment placeholder, but should not include the actual token.

## Sources

[1]: https://heroui.pro/ "HeroUI Pro landing page"  
[2]: https://heroui.pro/docs/react/getting-started "HeroUI Pro React Introduction"  
[3]: https://heroui.pro/docs/react/getting-started/mcp-server "HeroUI Pro MCP Server"  
[4]: https://www.npmjs.com/package/@heroui/mcp "@heroui/mcp npm package"  
