"use client";
import { getVoterLinks } from "@/lib/states";

interface Props {
  stateCode: string;
}

const LINK_CLASS = "text-blue-700 hover:underline";

export function CanVoteStrip({ stateCode }: Props) {
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
      <p className="mt-1 text-[11px] text-slate-400">
        Official, nonpartisan sources. You&apos;ll confirm your address on each site.
      </p>
    </div>
  );
}
