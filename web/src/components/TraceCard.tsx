"use client";

/**
 * TraceCard — inline activity trace card rendered inside the CopilotKit chat.
 *
 * Appears in the message stream when the agent calls a tool, giving judges
 * real-time visibility into: district resolution, finance retrieval,
 * legislation lookup, MCP use, and MongoDB queries.
 *
 * CLAUDE.md: "Add an activity trace panel or logs showing race resolution,
 * finance retrieval, issue evidence search, MCP use, and citation generation."
 */

interface TraceCardProps {
  icon: string;
  label: string;
  detail: string;
  status: "inProgress" | "executing" | "complete";
  result?: string;
  source?: string;
}

export function TraceCard({ icon, label, detail, status, result, source }: TraceCardProps) {
  const isLoading = status === "inProgress" || status === "executing";

  return (
    <div className="my-1 rounded-[2px] border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <span className="text-base">{icon}</span>
        <span className="font-semibold text-slate-700">{label}</span>
        {isLoading ? (
          <span className="ml-auto animate-spin text-slate-400">⟳</span>
        ) : (
          <span className="ml-auto text-green-600">✓</span>
        )}
      </div>

      {/* Detail */}
      <div className="mt-0.5 text-slate-500 truncate" title={detail}>
        {detail}
      </div>

      {/* Result summary — shown on complete */}
      {status === "complete" && result && (
        <div className="mt-1 border-t border-slate-200 pt-1 text-slate-600 line-clamp-2">
          {result}
        </div>
      )}

      {/* Source citation */}
      {source && (
        <div className="mt-0.5 text-slate-400 italic">{source}</div>
      )}
    </div>
  );
}
