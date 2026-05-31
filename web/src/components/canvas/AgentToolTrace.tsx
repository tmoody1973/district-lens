"use client";

import { useDefaultTool, useRenderToolCall } from "@copilotkit/react-core";
import { summarizeArgs, toolMeta } from "@/lib/tool-trace";
import { TraceCard } from "../TraceCard";
import { FinanceToolCard, type FinanceToolCandidate } from "./FinanceToolCard";

/**
 * Renders every agent tool call inline in the CopilotKit chat as a TraceCard,
 * so a reader (and a hackathon judge) sees the agent working — including the
 * partner MongoDB MCP calls. Catch-all via useDefaultTool; the brief pipeline
 * has its own deterministic receipt and is unaffected.
 *
 * Specific tools (e.g. get_race_finance_brief) override the generic TraceCard
 * with a rich generative-UI card via useRenderToolCall.
 *
 * Mount once inside the CopilotKit provider. Renders nothing itself.
 */
export function AgentToolTrace() {
  // Rich card for the finance tool — wins over the catch-all below for this
  // tool name; every other tool still falls through to the generic TraceCard.
  useRenderToolCall({
    name: "get_race_finance_brief",
    parameters: [{ name: "race_key", type: "string", required: true }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render: (props: any) => {
      const { status, args } = props;
      const raceKey: string | undefined = args?.race_key;
      if (status !== "complete") {
        return <FinanceToolCard loading candidates={[]} raceKey={raceKey} />;
      }
      // ADK usually delivers the result as a parsed object, but some transports
      // send a JSON string — normalize so field access works either way.
      let parsed: unknown = props.result;
      if (typeof parsed === "string") {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          parsed = {};
        }
      }
      const root = (parsed ?? {}) as {
        data?: { race_key?: string; candidates?: FinanceToolCandidate[] };
        source?: string;
      };
      const data = root.data ?? {};
      return (
        <FinanceToolCard
          raceKey={data.race_key ?? raceKey}
          candidates={data.candidates ?? []}
          source={root.source}
        />
      );
    },
  });

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
