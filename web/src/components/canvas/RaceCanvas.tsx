"use client";
import type { DistrictLensState } from "@/types/agent-state";
import { RaceHeader } from "./RaceHeader";
import { CandidateCard } from "./CandidateCard";
import { FinanceChart } from "./FinanceChart";
import { ResearchProgress } from "./ResearchProgress";
import { BillFeed } from "./BillFeed";
import { NewsCard } from "./NewsCard";
import { EvidenceCard } from "./EvidenceCard";

interface Props { state: DistrictLensState; }

export function RaceCanvas({ state }: Props) {
  if (state.stage === "idle" || !state.currentRaceKey) {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-400 text-sm p-8">
        Enter an address or click a state on the map to get started.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 overflow-y-auto">
      <ResearchProgress stage={state.stage} />
      <RaceHeader raceKey={state.currentRaceKey} />

      {state.candidates.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
            Candidates · FEC 2026
          </p>
          {state.candidates.map((c) => (
            <CandidateCard key={c.candidateId} candidate={c} />
          ))}
        </div>
      )}

      {state.finance.length > 0 && (
        <FinanceChart finance={state.finance} />
      )}

      {state.legislation.length > 0 && (
        <BillFeed
          legislation={state.legislation}
          memberName={state.legislation[0]?.memberName}
        />
      )}

      {state.news.length > 0 && (
        <NewsCard news={state.news} />
      )}

      {state.positions.length > 0 && (
        <div className="space-y-4">
          {state.positions.map((ev, i) => (
            <EvidenceCard key={i} evidence={ev} />
          ))}
        </div>
      )}
    </div>
  );
}
