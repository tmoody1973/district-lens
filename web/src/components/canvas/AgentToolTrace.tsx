"use client";

import type { ComponentType } from "react";
import { useDefaultTool, useRenderToolCall } from "@copilotkit/react-core";
import { summarizeArgs, toolMeta } from "@/lib/tool-trace";
import { unwrapMcpResult } from "@/lib/mcp-result";
import { TraceCard } from "../TraceCard";
import { DonorContributionsCard, type DonorRow } from "./DonorContributionsCard";
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

// ADK usually delivers tool results as parsed objects, but some transports
// send a JSON string — normalize so field access works either way.
function parseToolResult(result: unknown): unknown {
  if (typeof result !== "string") return result;
  try {
    return JSON.parse(result);
  } catch {
    return {};
  }
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
      const root = (parseToolResult(props.result) ?? {}) as {
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

  // Rich card for the live FEC individual-donors tool (demo moment).
  useRenderToolCall({
    name: "get_individual_donors",
    parameters: [
      { name: "candidate_name", type: "string", required: true },
      { name: "race_key", type: "string", required: true },
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render: (props: any) => {
      if (props.status !== "complete") {
        return <DonorContributionsCard loading donors={[]} />;
      }
      const data =
        ((parseToolResult(props.result) ?? {}) as {
          data?: {
            candidate?: string;
            donors?: DonorRow[];
            coverage_note?: string;
            retrieved_at?: string;
          };
        }).data ?? {};
      return (
        <DonorContributionsCard
          candidate={data.candidate}
          donors={data.donors ?? []}
          coverageNote={data.coverage_note}
          retrievedAt={data.retrieved_at}
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
