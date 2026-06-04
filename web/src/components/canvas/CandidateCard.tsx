"use client";
import { useState } from "react";
import type { CandidateCard as CandidateCardType, FinanceSummary } from "@/types/agent-state";
import { placeholderAvatarUrl } from "@/lib/bioguide";
import { fmtMoney } from "@/lib/format";
export { fmtMoney };

const PARTY_BORDER: Record<string, string> = {
  DEM: "border-l-blue-600",
  REP: "border-l-red-600",
  IND: "border-l-slate-400",
};

const PARTY_BADGE: Record<string, string> = {
  DEM: "bg-blue-100 text-blue-800 border-blue-300",
  REP: "bg-red-100 text-red-800 border-red-300",
  IND: "bg-slate-100 text-slate-800 border-slate-300",
};

const STATUS_LABELS: Record<string, string> = {
  incumbent: "Incumbent",
  challenger: "Challenger",
  open_seat: "Open Seat",
};

interface Props {
  candidate: CandidateCardType;
  finance?: FinanceSummary | null;
}

export function CandidateCard({ candidate, finance }: Props) {
  const [imgSrc, setImgSrc] = useState(() =>
    candidate.photoUrl || placeholderAvatarUrl(candidate.name, candidate.party)
  );
  const partyKey = candidate.party.toUpperCase();
  const borderClass = PARTY_BORDER[partyKey] ?? "border-l-slate-400";
  const badgeClass = PARTY_BADGE[partyKey] ?? PARTY_BADGE.IND;
  const statusLabel = STATUS_LABELS[candidate.status] ?? candidate.status;

  const total = finance?.receipts ?? null;
  const pac = finance?.pacContributions ?? null;
  const pacPct = total !== null && total > 0 && pac !== null
    ? Math.round((pac / total) * 100)
    : null;

  return (
    <div className={`flex items-center gap-4 rounded-[2px] border-2 border-slate-200 border-l-4 ${borderClass} bg-white p-4`}>
      <img
        src={imgSrc}
        alt={candidate.name}
        width={48}
        height={48}
        className="rounded-full border-2 border-slate-200 object-cover shrink-0"
        onError={() => setImgSrc(placeholderAvatarUrl(candidate.name, candidate.party))}
      />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-900 truncate">{candidate.name}</p>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
            {candidate.party}
          </span>
          <span className="text-xs text-slate-500">{statusLabel}</span>
          {candidate.voteSharePct != null && (
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                candidate.isPrimaryWinner
                  ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                  : "bg-slate-100 text-slate-600 border-slate-200"
              }`}
              title="Primary result · NBC Decision Desk"
            >
              {candidate.isPrimaryWinner ? "✓ Won primary" : "Primary"} ·{" "}
              {candidate.voteSharePct.toFixed(1)}%
            </span>
          )}
        </div>
      </div>
      {total !== null && (
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-slate-900">{fmtMoney(total)}</p>
          {pacPct !== null && (
            <p className="text-xs text-slate-500">{pacPct}% PAC</p>
          )}
        </div>
      )}
    </div>
  );
}
