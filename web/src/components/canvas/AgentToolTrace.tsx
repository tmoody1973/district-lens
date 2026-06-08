"use client";

import type { ComponentType } from "react";
import { useDefaultTool, useRenderToolCall } from "@copilotkit/react-core";
import { summarizeArgs, toolMeta } from "@/lib/tool-trace";
import { unwrapMcpResult } from "@/lib/mcp-result";
import { TraceCard } from "../TraceCard";
import { FinanceToolCard, type FinanceToolCandidate } from "./FinanceToolCard";
import { BallotpediaSkeleton } from "./ballotpedia/BallotpediaCardShell";
import { BallotMeasuresCard } from "./ballotpedia/BallotMeasuresCard";
import { ElectionsCard } from "./ballotpedia/ElectionsCard";
import { CandidateSearchCard } from "./ballotpedia/CandidateSearchCard";
import { CandidateProfileCard } from "./ballotpedia/CandidateProfileCard";

// Declarative registry for the Ballotpedia discovery cards. Each card accepts
// the loosely-shaped object that unwrapMcpResult returns (or null); the card
// itself narrows the fields it renders.
interface BallotpediaToolConfig {
  name: string;
  title: string;
  message: string;
  Card: ComponentType<{ data: ReturnType<typeof unwrapMcpResult> }>;
}

const BALLOTPEDIA_TOOLS: BallotpediaToolConfig[] = [
  {
    name: "ballotpedia_get_ballot_measures",
    title: "Ballot Measures",
    message: "Searching Ballotpedia for ballot measures…",
    Card: BallotMeasuresCard as BallotpediaToolConfig["Card"],
  },
  {
    name: "ballotpedia_get_elections_by_state",
    title: "Elections",
    message: "Searching Ballotpedia for elections…",
    Card: ElectionsCard as BallotpediaToolConfig["Card"],
  },
  {
    name: "ballotpedia_search_candidates",
    title: "Candidate Search",
    message: "Searching Ballotpedia for candidates…",
    Card: CandidateSearchCard as BallotpediaToolConfig["Card"],
  },
  {
    name: "ballotpedia_summarize_candidate_platform",
    title: "Candidate Profile",
    message: "Reading the candidate's Ballotpedia profile…",
    Card: CandidateProfileCard as BallotpediaToolConfig["Card"],
  },
];

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

  // Ballotpedia discovery tools (MCP, vendored, namespaced under "ballotpedia").
  // Each upgrades the raw {"content":[{"type":"text"…}]} blob to a styled
  // discovery card; the shell carries the DISCOVERY-ONLY governance. The four
  // registrations differ only by tool name, title, message, and card, so they
  // share one declarative table. The list is module-constant, so iterating it
  // with a hook inside is stable across renders (rules-of-hooks safe).
  for (const tool of BALLOTPEDIA_TOOLS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useRenderToolCall({
      name: tool.name,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render: (props: any) =>
        props.status !== "complete" ? (
          <BallotpediaSkeleton title={tool.title} message={tool.message} />
        ) : (
          <tool.Card data={unwrapMcpResult(props.result)} />
        ),
    });
  }

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
