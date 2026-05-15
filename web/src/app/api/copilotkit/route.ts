/**
 * CopilotKit runtime — Phase 1B.
 *
 * LLM: Vertex AI via ADC (DECISIONS_LOG §2.9), no API key.
 * Tools: server-side CopilotKit actions backed by MongoDB Atlas data.
 *   - lookup_district   → Geocod.io cd120/cd compound request
 *   - get_race_brief    → candidates + finance for a race_key
 *   - find_candidate    → name search across 2026 FEC filers
 *
 * Phase 2B TODO: add Clerk auth for saved features + Upstash rate-limit.
 * Phase 1C TODO: replace VertexServiceAdapter with ADK → AG-UI bridge so
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

// ---------------------------------------------------------------------------
// Vertex AI adapter (ADC, no API key) — DECISIONS_LOG §2.9
// ---------------------------------------------------------------------------

class VertexServiceAdapter implements CopilotServiceAdapter {
  readonly name = "VertexAdapter";
  private readonly model: LanguageModel;

  constructor() {
    const vertex = createVertex({
      project: process.env.GOOGLE_CLOUD_PROJECT ?? "civicsync-440613",
      location: process.env.GOOGLE_CLOUD_LOCATION ?? "global",
    });
    // gemini-3.1-pro-preview requires thought_signature for tool calls in
    // thinking blocks — not yet supported by @ai-sdk/google-vertex.
    // gemini-2.5-pro is stable GA and works correctly with the AI SDK tool loop.
    this.model = vertex("gemini-2.5-pro");
  }

  getLanguageModel(): LanguageModel {
    return this.model;
  }

  async process(
    request: CopilotRuntimeChatCompletionRequest
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    return { threadId: request.threadId ?? crypto.randomUUID() };
  }
}

// ---------------------------------------------------------------------------
// CopilotKit runtime — no server-side actions.
// Tools are registered as client-side useCopilotAction hooks in page.tsx,
// which call /api/district/lookup and /api/race/brief. This avoids the
// BuiltInAgent AG-UI tool-result streaming gap.
// ---------------------------------------------------------------------------

const runtime = new CopilotRuntime();

const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
  runtime,
  serviceAdapter: new VertexServiceAdapter(),
  endpoint: "/api/copilotkit",
});

export { handleRequest as GET, handleRequest as POST };
