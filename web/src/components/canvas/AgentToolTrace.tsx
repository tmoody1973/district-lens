"use client";

import { useDefaultTool } from "@copilotkit/react-core";
import { summarizeArgs, toolMeta } from "@/lib/tool-trace";
import { TraceCard } from "../TraceCard";

/**
 * Renders every agent tool call inline in the CopilotKit chat as a TraceCard,
 * so a reader (and a hackathon judge) sees the agent working — including the
 * partner MongoDB MCP calls. Catch-all via useDefaultTool; the brief pipeline
 * has its own deterministic receipt and is unaffected.
 *
 * Mount once inside the CopilotKit provider. Renders nothing itself.
 */
export function AgentToolTrace() {
  useDefaultTool({
    render: (props) => {
      const { name, status, args } = props;
      const meta = toolMeta(name);
      const detail = summarizeArgs(args as Record<string, unknown> | undefined) || meta.source || "";
      const result = status === "complete" ? props.result : undefined;
      const resultText =
        result != null
          ? (typeof result === "string" ? result : JSON.stringify(result)).slice(0, 180)
          : undefined;
      return (
        <TraceCard
          icon={meta.icon}
          label={meta.label}
          detail={detail}
          status={status}
          result={resultText}
          source={meta.source}
        />
      );
    },
  });
  return null;
}
