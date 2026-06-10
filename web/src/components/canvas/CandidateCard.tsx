"use client";
import { useState } from "react";
import type { CandidateCard as CandidateCardType, FinanceSummary } from "@/types/agent-state";
import { placeholderAvatarUrl } from "@/lib/bioguide";
import { fmtMoney } from "@/lib/format";
export { fmtMoney };

const PARTY_BORDER: Record<string, string> = {
  DEM: "border-l-party-dem",
  REP: "border-l-party-rep",
  IND: "border-l-zinc-500",
};

const PARTY_BADGE: Record<string, string> = {
  DEM: "bg-blue-900/30 text-blue-400 border-blue-700/40",
  REP: "bg-red-900/30 text-red-400 border-red-700/40",
  IND: "bg-zinc-800 text-zinc-300 border-zinc-600",
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
    <div className={`flex items-center gap-4 rounded-[2px] border-2 border-edge border-l-4 ${borderClass} bg-surface-raised p-4`}>
      <img
        src={imgSrc}
        alt={candidate.name}
        width={48}
        height={48}
        className="rounded-full border-2 border-edge object-cover shrink-0"
        onError={() => setImgSrc(placeholderAvatarUrl(candidate.name, candidate.party))}
      />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-ink truncate">{candidate.name}</p>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
            {candidate.party}
          </span>
          <span className="text-xs text-ink-muted">{statusLabel}</span>
          {candidate.voteSharePct != null && (
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                candidate.isPrimaryWinner
                  ? "bg-green-900/30 text-green-400 border-green-700/40"
                  : "bg-zinc-800 text-zinc-300 border-zinc-600"
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
          <p className="text-sm font-bold text-ink">{fmtMoney(total)}</p>
          {pacPct !== null && (
            <p className="text-xs text-ink-muted">{pacPct}% PAC</p>
          )}
        </div>
      )}
    </div>
  );
}
