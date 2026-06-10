"use client";
import { getVoterLinks } from "@/lib/states";
import type { KeyDate } from "@/lib/election-dates";

interface Props {
  stateCode: string;
  keyDates?: KeyDate[];
}

const LINK_CLASS = "text-evidence-questionnaire hover:underline";

function KeyDatesLine({ keyDates }: { keyDates: KeyDate[] }) {
  if (keyDates.length === 0) return null;
  return (
    <p className="mt-2 text-sm text-ink">
      <span className="font-semibold text-ink">Key dates:</span>{" "}
      {keyDates.map((d, i) => (
        <span key={d.label}>
          {i > 0 && <span className="text-ink-faint"> · </span>}
          {d.label} {d.dateText}
          {d.completed && <span className="text-ink-faint"> (completed)</span>}
        </span>
      ))}
    </p>
  );
}

export function CanVoteStrip({ stateCode, keyDates = [] }: Props) {
  const links = getVoterLinks(stateCode);

  return (
    <div className="rounded-[2px] border border-blue-700/40 bg-blue-900/30 px-4 py-3">
      <p className="text-sm text-ink">
        <span className="font-semibold text-ink">Can you vote in {links.stateName}?</span>{" "}
        <a className={LINK_CLASS} href={links.registration} target="_blank" rel="noopener noreferrer">
          Check registration
        </a>
        {" · "}
        <a className={LINK_CLASS} href={links.pollingAndDeadlines} target="_blank" rel="noopener noreferrer">
          Polling place &amp; deadlines
        </a>
        {" · "}
        <a className={LINK_CLASS} href={links.fullBallot} target="_blank" rel="noopener noreferrer">
          See your full ballot →
        </a>
      </p>
      <KeyDatesLine keyDates={keyDates} />
      <p className="mt-1 text-[11px] text-ink-faint">
        Official, nonpartisan sources. You&apos;ll confirm your address on each site.
      </p>
    </div>
  );
}
