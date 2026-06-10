// Maps an agent tool-call name to a friendly icon + label + data source for the
// inline chat activity trace (TraceCard). Keeps the chat honest about which
// real tool/source each answer drew from — including the partner MongoDB MCP.

export interface ToolMeta {
  icon: string;
  label: string;
  source?: string;
}

const TOOL_META: Record<string, ToolMeta> = {
  lookup_district: { icon: "📍", label: "District lookup", source: "Geocod.io" },
  get_state_races: { icon: "🗺️", label: "State races", source: "MongoDB" },
  get_race_candidates: { icon: "👥", label: "Candidates", source: "FEC" },
  get_race_finance_brief: { icon: "💰", label: "Race finance", source: "FEC" },
  get_candidate_finance: { icon: "💰", label: "Candidate finance", source: "FEC" },
  get_incumbent_legislation: { icon: "📜", label: "Legislation", source: "Congress.gov" },
  get_voting_record: { icon: "🗳️", label: "Voting record", source: "Congress.gov" },
  find_candidate: { icon: "🔎", label: "Find candidate", source: "FEC" },
  search_candidate_positions: { icon: "💬", label: "Issue positions", source: "Perplexity" },
  finish_brief: { icon: "✅", label: "Finalize brief" },
};

// CopilotKit-internal frontend actions that surface as tool calls but carry
// no user-meaningful trace (and never reach "complete", so they spin forever).
const HIDDEN_TOOLS = new Set(["confirm_changes"]);

export function isHiddenTool(name: string): boolean {
  return HIDDEN_TOOLS.has(name);
}

export function toolMeta(name: string): ToolMeta {
  const known = TOOL_META[name];
  if (known) return known;
  // MongoDB MCP tools are registered with a "mongodb" prefix (partner integration).
  if (name.toLowerCase().startsWith("mongodb")) {
    const op = name.replace(/^mongodb[_-]?/i, "") || "query";
    return { icon: "🍃", label: `MongoDB MCP · ${op}`, source: "MongoDB MCP" };
  }
  return { icon: "🔧", label: name, source: "Tool" };
}

const ARG_KEYS = [
  "race_key",
  "candidate_id",
  "candidate_name",
  "name",
  "state",
  "issue",
  "office_type",
  "jurisdiction",
  "collection",
];

// Compact one-line summary of a tool call's args, for the trace detail row.
export function summarizeArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  const parts: string[] = [];
  for (const key of ARG_KEYS) {
    const value = args[key];
    if (value == null) continue;
    const rendered = typeof value === "object" ? JSON.stringify(value) : String(value);
    parts.push(`${key}: ${rendered.slice(0, 40)}`);
  }
  return parts.join(" · ");
}
