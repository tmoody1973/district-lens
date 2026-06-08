"use client";

import {
  BallotpediaCardShell,
  BallotpediaEmpty,
  LinkOrSpan,
  partyDot,
  truncate,
} from "./BallotpediaCardShell";

export interface CandidateHit {
  name: string;
  url?: string;
  party?: string;
  office?: string;
  state?: string;
  status?: string;
  snippet?: string;
}

export interface CandidateSearchData {
  candidates: CandidateHit[];
}

export function CandidateSearchCard({ data }: { data: CandidateSearchData | null }) {
  const title = "Candidate Search";
  const candidates = data?.candidates ?? [];
  if (candidates.length === 0) {
    return <BallotpediaEmpty title={title} />;
  }

  return (
    <BallotpediaCardShell title={title}>
      {candidates.map((candidate) => {
        const where = [candidate.office, candidate.state].filter(Boolean).join(" · ");
        return (
          <div key={candidate.name + (candidate.url ?? "")} className="space-y-0.5">
            <span className="flex items-center gap-1.5 text-sm text-slate-900">
              <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${partyDot(candidate.party)}`} />
              <LinkOrSpan href={candidate.url} className="truncate font-medium underline-offset-2 hover:underline">
                {candidate.name}
              </LinkOrSpan>
            </span>
            {where && <p className="text-[11px] text-slate-500">{where}</p>}
            {candidate.snippet && (
              <p className="text-[11px] text-slate-600">{truncate(candidate.snippet, 160)}</p>
            )}
          </div>
        );
      })}
    </BallotpediaCardShell>
  );
}
