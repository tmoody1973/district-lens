"use client";
import { getVoterLinks } from "@/lib/states";
import type { KeyDate } from "@/lib/election-dates";

interface Props {
  stateCode: string;
  keyDates?: KeyDate[];
}

const LINK_CLASS = "text-blue-700 hover:underline";

function KeyDatesLine({ keyDates }: { keyDates: KeyDate[] }) {
  if (keyDates.length === 0) return null;
  return (
    <p className="mt-2 text-sm text-slate-700">
      <span className="font-semibold text-slate-900">Key dates:</span>{" "}
      {keyDates.map((d, i) => (
        <span key={d.label}>
          {i > 0 && <span className="text-slate-400"> · </span>}
          {d.label} {d.dateText}
          {d.completed && <span className="text-slate-400"> (completed)</span>}
        </span>
      ))}
    </p>
  );
}

export function CanVoteStrip({ stateCode, keyDates = [] }: Props) {
  const links = getVoterLinks(stateCode);

  return (
    <div className="rounded-[2px] border border-slate-200 bg-blue-50/60 px-4 py-3">
      <p className="text-sm text-slate-700">
        <span className="font-semibold text-slate-900">Can you vote in {links.stateName}?</span>{" "}
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
      <p className="mt-1 text-[11px] text-slate-400">
        Official, nonpartisan sources. You&apos;ll confirm your address on each site.
      </p>
    </div>
  );
}
