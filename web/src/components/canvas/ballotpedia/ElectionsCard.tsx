"use client";

import { BallotpediaCardShell, BallotpediaEmpty, LinkOrSpan } from "./BallotpediaCardShell";

export interface ElectionPreviewCandidate {
  name: string;
  url?: string;
}

export interface ElectionRace {
  title: string;
  url?: string;
  date?: string;
  office_type?: string;
  candidates_preview?: ElectionPreviewCandidate[];
}

export interface ElectionsData {
  state?: string;
  year?: number;
  elections: ElectionRace[];
}

// Ballotpedia's elections page leaks navigation/section links into the row list
// (e.g. "Statewide election dates", "Sample Ballot Lookup", "List of candidates").
// These are page furniture, not races. Match as substrings — the live rows are
// prefixed/suffixed ("Statewide election dates"), so an exact/startsWith check
// misses them. Patterns are specific multi-word phrases so real race titles
// (office names) never match.
const NOISE_PATTERNS = [
  "election dates",
  "offices on the ballot",
  "ballot measure",
  "see also",
  "how to vote",
  "how to run for office",
  "sample ballot",
  "list of candidates",
  "local election official",
  "noteworthy election",
  "on your ballot",
  "voter registration",
  "absentee",
  "polling place",
];

function isRealRace(race: ElectionRace): boolean {
  const title = race.title?.trim().toLowerCase() ?? "";
  if (!title) return false;
  return !NOISE_PATTERNS.some((noise) => title.includes(noise));
}

export function ElectionsCard({ data }: { data: ElectionsData | null }) {
  const title = "Elections";
  const races = (data?.elections ?? []).filter(isRealRace);
  if (races.length === 0) {
    return <BallotpediaEmpty title={title} />;
  }

  const subtitle = [data?.state, data?.year].filter(Boolean).join(" · ") || undefined;

  return (
    <BallotpediaCardShell title={title} subtitle={subtitle}>
      {races.map((race) => {
        const previews = race.candidates_preview ?? [];
        return (
          <div key={race.title} className="space-y-1 border-t border-amber-100 pt-2 first:border-t-0 first:pt-0">
            <div className="flex items-baseline justify-between gap-2">
              <LinkOrSpan
                href={race.url}
                className="truncate text-sm font-medium text-slate-900 underline-offset-2 hover:underline"
              >
                {race.title}
              </LinkOrSpan>
              {race.office_type && (
                <span className="shrink-0 rounded-[2px] border border-slate-300 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-slate-600">
                  {race.office_type}
                </span>
              )}
            </div>
            {race.date && <p className="text-[10px] text-slate-500">{race.date}</p>}
            {previews.length > 0 && (
              <p className="text-[11px] text-slate-600">
                {previews.map((c) => c.name).join(" · ")}
              </p>
            )}
          </div>
        );
      })}
    </BallotpediaCardShell>
  );
}
