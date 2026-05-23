"use client";
import type { DistrictLensState } from "@/types/agent-state";
import { RaceHeader } from "./RaceHeader";
import { CandidateCard } from "./CandidateCard";
import { FinanceChart } from "./FinanceChart";
import { BillFeed } from "./BillFeed";
import { NewsCard } from "./NewsCard";
import { EvidenceCard } from "./EvidenceCard";

interface Props {
  state: DistrictLensState;
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

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
      <RaceHeader raceKey={state.currentRaceKey} />

      {/* Evidence FIRST */}
      {state.positions.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
            Issue Positions · Perplexity
          </p>
          {state.positions.map((evidence, index) => (
            <EvidenceCard key={index} evidence={evidence} />
          ))}
        </div>
      )}

      {/* Candidates */}
      {state.candidates.length > 0 && (
        <div className="space-y-2">
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
      )}

      {state.finance.length > 0 && <FinanceChart finance={state.finance} />}

      {state.legislation.length > 0 && (
        <BillFeed
          legislation={state.legislation}
          memberName={state.legislation[0]?.memberName}
        />
      )}

      {state.news.length > 0 && <NewsCard news={state.news} />}
    </div>
  );
}
