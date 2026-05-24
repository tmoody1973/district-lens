"use client";
import type { DistrictLensState, EvidenceCard } from "@/types/agent-state";
import { RaceHeader } from "./RaceHeader";
import { CandidateCard } from "./CandidateCard";
import { FinanceChart } from "./FinanceChart";
import { BillFeed } from "./BillFeed";
import { NewsCard } from "./NewsCard";
import { NewsAccordion } from "./NewsAccordion";
import { IssueAccordion } from "./IssueAccordion";
import { CanVoteStrip } from "./CanVoteStrip";
import { stateCodeFromRaceKey } from "@/lib/states";

interface Props {
  state: DistrictLensState;
}

function groupByIssue(positions: EvidenceCard[]): Array<[string, EvidenceCard[]]> {
  const groups = new Map<string, EvidenceCard[]>();
  for (const position of positions) {
    const existing = groups.get(position.issue);
    groups.set(position.issue, existing ? [...existing, position] : [position]);
  }
  return Array.from(groups.entries());
}

export function RaceCanvas({ state }: Props) {
  if (state.stage === "idle" || !state.currentRaceKey) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-slate-400">
        Enter an address or click a state on the map to get started.
      </div>
    );
  }

  const financeByCandidate = Object.fromEntries(
    state.finance.map((summary) => [summary.candidateId, summary])
  );

  const issueGroups = groupByIssue(state.positions);
  const stateCode = stateCodeFromRaceKey(state.currentRaceKey);
  const isJournalist = state.mode === "journalist";

  const positionsSection = issueGroups.length > 0 && (
    <div key="positions" className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
        Issue Positions · Perplexity
      </p>
      {issueGroups.map(([issue, cards], index) => (
        <IssueAccordion key={issue} issue={issue} cards={cards} defaultOpen={index === 0} />
      ))}
    </div>
  );

  const candidatesSection = state.candidates.length > 0 && (
    <div key="candidates" className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
        Candidates · FEC 2026
      </p>
      {state.candidates.map((candidate) => (
        <CandidateCard
          key={candidate.candidateId}
          candidate={candidate}
          finance={financeByCandidate[candidate.candidateId] ?? null}
        />
      ))}
    </div>
  );

  const financeSection = state.finance.length > 0 && (
    <FinanceChart key="finance" finance={state.finance} />
  );

  const legislationSection = state.legislation.length > 0 && (
    <BillFeed
      key="legislation"
      legislation={state.legislation}
      memberName={state.legislation[0]?.memberName}
    />
  );

  const newsSection = state.candidates.length > 0 && (
    <div key="news" className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
        Recent News · Perplexity
      </p>
      {state.candidates.map((candidate) => (
        <NewsAccordion key={candidate.candidateId} candidateName={candidate.name} />
      ))}
    </div>
  );

  // Journalist leads with the money (candidates + finance) and drops the
  // voter-only logistics strip; voter leads with evidence (stances) first.
  const sections = isJournalist
    ? [candidatesSection, financeSection, positionsSection, legislationSection, newsSection]
    : [positionsSection, candidatesSection, financeSection, legislationSection, newsSection];

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
      <RaceHeader raceKey={state.currentRaceKey} />

      {!isJournalist && stateCode && <CanVoteStrip stateCode={stateCode} />}

      {state.news.length > 0 && <NewsCard news={state.news} />}

      {sections}
    </div>
  );
}
