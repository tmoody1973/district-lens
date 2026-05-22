"use client";

import { CopilotKit } from "@copilotkit/react-core";

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  /*
   * HeroUI v3 is CSS-only — no React provider needed; @heroui/styles in
   * globals.css handles theming. DECISIONS_LOG §1.1.
   *
   * CopilotKit runtimeUrl points to our Next.js proxy route → Python ADK.
   * Phase 1B: wire the /api/copilotkit route to process.env.AGENT_URL.
   * DECISIONS_LOG §2.2.
   */
  return <CopilotKit runtimeUrl="/api/copilotkit" agent="districtlens_root">{children}</CopilotKit>;
}
