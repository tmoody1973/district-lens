import type { CandidateCard as CandidateCardType, FinanceSummary } from "@/types/agent-state";
import type { RacePhase } from "@/lib/brief-layout";
import { CandidateCard } from "./CandidateCard";

interface Props {
  candidates: CandidateCardType[];
  financeByCandidate: Record<string, FinanceSummary>;
  phase: RacePhase;
}

const PARTY_HEADING: Record<string, string> = {
  DEM: "Democratic primary", REP: "Republican primary", IND: "Independent",
};

function partyHeading(party: string): string {
  return PARTY_HEADING[party.toUpperCase()] ?? `${party} field`;
}

function groupByParty(candidates: CandidateCardType[]): Array<[string, CandidateCardType[]]> {
  const groups = new Map<string, CandidateCardType[]>();
  for (const c of candidates) {
    const key = c.party.toUpperCase();
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const order = ["DEM", "REP", ...[...groups.keys()].filter((k) => k !== "DEM" && k !== "REP").sort()];
  return order.filter((k) => groups.has(k)).map((k) => [k, groups.get(k)!]);
}

export function CandidateField({ candidates, financeByCandidate, phase }: Props) {
  if (phase === "called") {
    return (
      <div className="space-y-2">
        {candidates.map((c) => (
          <CandidateCard key={c.candidateId} candidate={c} finance={financeByCandidate[c.candidateId] ?? null} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {groupByParty(candidates).map(([party, group]) => (
        <div key={party} className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">{partyHeading(party)}</p>
          {group.map((c) => (
            <CandidateCard key={c.candidateId} candidate={c} finance={financeByCandidate[c.candidateId] ?? null} />
          ))}
        </div>
      ))}
    </div>
  );
}
