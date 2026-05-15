"use client";
import { useState } from "react";
import type { CandidateCard as CandidateCardType } from "@/types/agent-state";
import { placeholderAvatarUrl } from "@/lib/bioguide";

const PARTY_COLORS: Record<string, string> = {
  DEM: "bg-blue-100 text-blue-800 border-blue-300",
  REP: "bg-red-100 text-red-800 border-red-300",
  IND: "bg-slate-100 text-slate-800 border-slate-300",
};

const STATUS_LABELS: Record<string, string> = {
  incumbent: "Incumbent",
  challenger: "Challenger",
  open_seat: "Open Seat",
};

interface Props { candidate: CandidateCardType; }

export function CandidateCard({ candidate }: Props) {
  const [imgSrc, setImgSrc] = useState(candidate.photoUrl);
  const partyClass = PARTY_COLORS[candidate.party.toUpperCase()] ?? PARTY_COLORS.IND;
  const statusLabel = STATUS_LABELS[candidate.status] ?? candidate.status;

  return (
    <div className="flex items-center gap-4 rounded-[2px] border-2 border-slate-900 bg-white p-4">
      <img
        src={imgSrc}
        alt={candidate.name}
        width={64}
        height={64}
        className="rounded-full border-2 border-slate-200 object-cover"
        onError={() => setImgSrc(placeholderAvatarUrl(candidate.name, candidate.party))}
      />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-900 truncate">{candidate.name}</p>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <span className={`rounded-[2px] border px-2 py-0.5 text-xs font-medium ${partyClass}`}>
            {candidate.party}
          </span>
          <span className="rounded-[2px] border border-slate-300 px-2 py-0.5 text-xs text-slate-600">
            {statusLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
