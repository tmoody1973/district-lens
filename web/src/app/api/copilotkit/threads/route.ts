/**
 * GET /api/copilotkit/threads
 * CopilotKit polls this for conversation thread history.
 * Returns the expected { threads: [] } format until persistence is wired.
 */

export function GET() {
  return Response.json({ threads: [] });
}
