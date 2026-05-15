/**
 * CopilotKit runtime — Phase 1C.
 *
 * LLM: Vertex AI via ADC (DECISIONS_LOG §2.9), no API key.
 * Tools: server-side CopilotKit actions backed by MongoDB Atlas data.
 *   - lookup_district         → Geocod.io cd120/cd compound request
 *   - get_race_brief          → candidates + finance for a race_key
 *   - get_incumbent_legislation → sponsored bills from the 119th Congress
 *   - find_candidate          → name search across 2026 FEC filers
 *
 * Phase 2B TODO: add Clerk auth for saved features + Upstash rate-limit.
 * Phase 2A TODO: replace VertexServiceAdapter with ADK → AG-UI bridge so
 *   civic-safety middleware (check_input / check_output) is active.
 */

import { createVertex } from "@ai-sdk/google-vertex";
import type { LanguageModel } from "ai";
import {
  CopilotRuntime,
  copilotRuntimeNextJSAppRouterEndpoint,
  type CopilotServiceAdapter,
  type CopilotRuntimeChatCompletionRequest,
  type CopilotRuntimeChatCompletionResponse,
} from "@copilotkit/runtime";
import { allActions } from "@/lib/server-actions";

// ---------------------------------------------------------------------------
// Vertex AI adapter (ADC, no API key) — DECISIONS_LOG §2.9
// ---------------------------------------------------------------------------

class VertexServiceAdapter implements CopilotServiceAdapter {
  readonly name = "VertexAdapter";
  private readonly _lm: LanguageModel;

  constructor() {
    const vertex = createVertex({
      project: process.env.GOOGLE_CLOUD_PROJECT ?? "civicsync-440613",
      location: process.env.GOOGLE_CLOUD_LOCATION ?? "global",
    });
    // gemini-2.5-pro is stable GA and works correctly with the AI SDK tool loop.
    this._lm = vertex("gemini-2.5-pro");
  }

  getLanguageModel(): LanguageModel {
    return this._lm;
  }

  async process(
    request: CopilotRuntimeChatCompletionRequest
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    return { threadId: request.threadId ?? crypto.randomUUID() };
  }
}

// ---------------------------------------------------------------------------
// CopilotKit runtime — server-side actions registered here.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runtime = new CopilotRuntime({ actions: allActions as any });

const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
  runtime,
  serviceAdapter: new VertexServiceAdapter(),
  endpoint: "/api/copilotkit",
});

export { handleRequest as GET, handleRequest as POST };
