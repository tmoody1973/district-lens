// Normalizes the result of a Ballotpedia MCP tool call into a plain object.
//
// MCP tools return their payload wrapped in an envelope —
// `{ content: [{ type: "text", text: "<json-string>" }], isError?: boolean }` —
// unlike the FEC backend tool, which delivers a plain object (or a JSON string,
// depending on transport). This helper collapses every shape the chat can
// receive into one object, or `null` when the result is unusable so each card
// can degrade to a "no results" shell instead of crashing.

type JsonObject = Record<string, unknown>;

interface McpTextEnvelope {
  content: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTextEnvelope(value: unknown): value is McpTextEnvelope {
  return isPlainObject(value) && Array.isArray((value as { content?: unknown }).content);
}

function parseJsonObject(raw: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function unwrapMcpResult(result: unknown): JsonObject | null {
  if (result == null) return null;

  if (typeof result === "string") {
    return parseJsonObject(result);
  }

  if (isTextEnvelope(result)) {
    if (result.isError) return null;
    const text = result.content.find((part) => part?.type === "text")?.text;
    return typeof text === "string" ? parseJsonObject(text) : null;
  }

  if (isPlainObject(result)) {
    return result;
  }

  return null;
}
