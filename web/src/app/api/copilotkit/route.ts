/**
 * CopilotKit runtime endpoint.
 *
 * Phase 1B: wire to the Python ADK agent via AGENT_URL + INTERNAL_API_TOKEN.
 * DECISIONS_LOG §2.2: Next.js API routes own Clerk verification (saved-features
 * only) and Upstash rate-limiting (public agent path). ADK service has
 * internal-only ingress; this route holds the INTERNAL_API_TOKEN.
 *
 * TODO (Phase 1B):
 *   1. Add CopilotRuntime with remoteEndpoints pointing at process.env.AGENT_URL
 *   2. Add Upstash rate-limiting middleware
 *   3. Add Clerk verification for saved-feature endpoints
 */

export async function POST() {
  return new Response(
    JSON.stringify({ error: "Agent endpoint not yet wired (Phase 1B)" }),
    { status: 503, headers: { "Content-Type": "application/json" } }
  );
}
