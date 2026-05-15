/**
 * CopilotKit runtime endpoint — Phase 1A scaffold.
 *
 * VertexServiceAdapter gives CopilotKit a getLanguageModel() method so it
 * auto-creates a BuiltInAgent backed by Vertex AI / ADC (DECISIONS_LOG §2.9).
 * No Gemini API key needed.
 *
 * Phase 1B: replace with proper ADK → AG-UI streaming bridge so the full
 * civic-safety callbacks and lookup_district tool are active.
 * DECISIONS_LOG §2.2: add Clerk + Upstash rate-limiting in Phase 1B.
 *
 * copilotRuntimeNextJSAppRouterEndpoint() returns { handleRequest: HonoHandler }
 * where HonoHandler is { GET, POST, ... }. Export POST specifically.
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

class VertexServiceAdapter implements CopilotServiceAdapter {
  readonly name = "VertexAdapter";
  private readonly model: LanguageModel;

  constructor() {
    const vertex = createVertex({
      project: process.env.GOOGLE_CLOUD_PROJECT ?? "civicsync-440613",
      location: process.env.GOOGLE_CLOUD_LOCATION ?? "global",
    });
    this.model = vertex("gemini-3.1-pro-preview");
  }

  getLanguageModel(): LanguageModel {
    return this.model;
  }

  async process(
    request: CopilotRuntimeChatCompletionRequest
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    // Scaffold stub — CopilotKit uses getLanguageModel() → BuiltInAgent for
    // actual responses. Phase 1B: full streaming via ADK bridge.
    return { threadId: request.threadId ?? crypto.randomUUID() };
  }
}

const runtime = new CopilotRuntime();

// copilotRuntimeNextJSAppRouterEndpoint returns { handleRequest: fetch-handler }.
// Export it for all HTTP methods the CopilotKit client uses (GET + POST).
const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
  runtime,
  serviceAdapter: new VertexServiceAdapter(),
  endpoint: "/api/copilotkit",
});

export { handleRequest as GET, handleRequest as POST };
