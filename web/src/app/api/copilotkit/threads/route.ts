/**
 * GET /api/copilotkit/threads
 * CopilotKit polls this for conversation thread history.
 * Returns empty list until thread persistence is wired in Phase 1B.
 */

export function GET() {
  return Response.json([]);
}
