"use client";

import {
  BallotpediaCardShell,
  BallotpediaEmpty,
  CardSection,
  LinkOrSpan,
  partyDot,
  truncate,
} from "./BallotpediaCardShell";

export interface CandidateKeyVote {
  bill?: string;
  position?: string;
  description?: string;
}

export interface CandidateProfileData {
  name?: string;
  url?: string;
  party?: string;
  office?: string;
  state?: string;
  bio?: string;
  campaign_themes?: string;
  key_votes?: CandidateKeyVote[];
  endorsements?: string[];
}

// Ballotpedia returns a placeholder string when a section is empty; treat it as absent.
function hasContent(value: string | undefined): boolean {
  return !!value && !value.startsWith("(No");
}

export function CandidateProfileCard({ data }: { data: CandidateProfileData | null }) {
  const title = "Candidate Profile";
  if (!data?.name) {
    return <BallotpediaEmpty title={title} governanceStrength="strong" />;
  }

  const where = [data.party, data.office, data.state].filter(Boolean).join(" · ");
  const keyVotes = data.key_votes ?? [];
  const endorsements = data.endorsements ?? [];

  return (
    <BallotpediaCardShell title={title} governanceStrength="strong">
      <div className="space-y-0.5">
        <span className="flex items-center gap-1.5 text-base font-semibold text-slate-900">
          <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${partyDot(data.party)}`} />
          <LinkOrSpan href={data.url} className="underline-offset-2 hover:underline">
            {data.name}
          </LinkOrSpan>
        </span>
        {where && <p className="text-[11px] text-slate-500">{where}</p>}
      </div>

      {hasContent(data.bio) && <p className="text-xs text-slate-700">{truncate(data.bio, 220)}</p>}

      <CardSection title="Campaign themes" show={hasContent(data.campaign_themes)}>
        <p className="text-[11px] text-slate-600">{truncate(data.campaign_themes, 200)}</p>
      </CardSection>

      <CardSection title="Key votes" show={keyVotes.length > 0}>
        <ul className="space-y-0.5">
          {keyVotes.slice(0, 5).map((vote, i) => (
            <li key={`${vote.bill ?? "vote"}-${i}`} className="text-[11px] text-slate-600">
              <span className="font-medium text-slate-800">{vote.bill}</span>
              {vote.position ? ` — ${vote.position}` : ""}
            </li>
          ))}
        </ul>
      </CardSection>

      <CardSection title="Endorsements" show={endorsements.length > 0}>
        <p className="text-[11px] text-slate-600">{endorsements.slice(0, 8).join(" · ")}</p>
      </CardSection>
    </BallotpediaCardShell>
  );
}
