"use client";
import type { DistrictLensState, EvidenceCard } from "@/types/agent-state";
import { DecisionHeader } from "./DecisionHeader";
import { NomineeStatusBanner } from "./NomineeStatusBanner";
import { CandidateField } from "./CandidateField";
import { CollapsibleSection } from "./CollapsibleSection";
import { FinanceChart } from "./FinanceChart";
import { BillFeed } from "./BillFeed";
import { VotingRecordCard } from "./VotingRecordCard";
import { NewsCard } from "./NewsCard";
import { NewsAccordion } from "./NewsAccordion";
import { IssueAccordion } from "./IssueAccordion";
import { CanVoteStrip } from "./CanVoteStrip";
import { buildBriefLayout, type SectionPlan } from "@/lib/brief-layout";
import { sortByEvidenceStrength } from "@/lib/evidence-strength";
import { useRaceStatus } from "@/lib/useRaceStatus";
import { stateCodeFromRaceKey } from "@/lib/states";

interface Props {
  state: DistrictLensState;
}

function groupByIssue(positions: EvidenceCard[]): Array<[string, EvidenceCard[]]> {
  const groups = new Map<string, EvidenceCard[]>();
  for (const position of positions) {
    groups.set(position.issue, [...(groups.get(position.issue) ?? []), position]);
  }
  return Array.from(groups.entries());
}

export function RaceCanvas({ state }: Props) {
  const raceStatus = useRaceStatus(state.currentRaceKey);

  if (state.stage === "idle" || !state.currentRaceKey) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-slate-400">
        Enter an address or click a state on the map to get started.
      </div>
    );
  }

  const layout = buildBriefLayout(state, raceStatus);
  const financeByCandidate = Object.fromEntries(state.finance.map((s) => [s.candidateId, s]));
  const stateCode = stateCodeFromRaceKey(state.currentRaceKey);
  const isVoter = state.mode === "voter";

  const renderSection = (plan: SectionPlan) => {
    switch (plan.id) {
      case "candidates":
        return (
          <div key="candidates" className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-widest text-slate-500">Candidates · FEC 2026</p>
            <CandidateField candidates={state.candidates} financeByCandidate={financeByCandidate} phase={layout.header.phase} />
          </div>
        );
      case "record": {
        const memberName = state.votingRecord?.memberName ?? state.legislation[0]?.memberName;
        return (
          <CollapsibleSection key="record" title={memberName ? `Legislative record · ${memberName}` : "Legislative record"} defaultOpen={plan.defaultOpen}>
            <div className="space-y-3">
              <VotingRecordCard record={state.votingRecord} />
              <BillFeed legislation={state.legislation} memberName={memberName} />
            </div>
          </CollapsibleSection>
        );
      }
      case "positions":
        return (
          <CollapsibleSection key="positions" title="Issue positions · Perplexity" defaultOpen={plan.defaultOpen}>
            {state.positions.length === 0 ? (
              <p className="text-sm text-slate-500">No position evidence found in indexed sources.</p>
            ) : (
              <div className="space-y-2">
                {groupByIssue(state.positions).map(([issue, cards], index) => (
                  <IssueAccordion key={issue} issue={issue} cards={sortByEvidenceStrength(cards)} defaultOpen={index === 0} />
                ))}
              </div>
            )}
          </CollapsibleSection>
        );
      case "money":
        return (
          <CollapsibleSection key="money" title="Campaign finance · FEC" defaultOpen={plan.defaultOpen}>
            <FinanceChart finance={state.finance} />
          </CollapsibleSection>
        );
      case "news":
        return (
          <CollapsibleSection key="news" title="Recent news · Perplexity" defaultOpen={plan.defaultOpen}>
            {state.news.length > 0 && <NewsCard news={state.news} />}
            <div className="mt-2 space-y-2">
              {state.candidates.map((c) => (
                <NewsAccordion key={c.candidateId} candidateName={c.name} />
              ))}
            </div>
          </CollapsibleSection>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
      <DecisionHeader facts={layout.header} />
      <NomineeStatusBanner status={raceStatus} />
      {isVoter && stateCode && <CanVoteStrip stateCode={stateCode} />}
      {layout.sections.map(renderSection)}
    </div>
  );
}
