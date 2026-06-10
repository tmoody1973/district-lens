"use client";
import { deriveProjectedWinners, type RaceStatus } from "@/lib/brief-layout";
import type { CandidateCard } from "@/types/agent-state";

const PARTY_DOT: Record<string, string> = {
  DEM: "bg-party-dem",
  REP: "bg-party-rep",
  IND: "bg-zinc-500",
};

const TONE: Record<string, { box: string; label: string }> = {
  green: { box: "border-green-700/40 bg-green-900/30", label: "text-evidence-direct" },
  amber: { box: "border-amber-700/40 bg-amber-900/30", label: "text-evidence-reported" },
  indigo: { box: "border-indigo-700/40 bg-indigo-900/30", label: "text-evidence-voting" },
  slate: { box: "border-edge bg-surface-raised", label: "text-ink-muted" },
};

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function WinnerList({ winners }: { winners: Record<string, string> }) {
  const entries = Object.entries(winners);
  if (entries.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-1">
      {entries.map(([party, name]) => (
        <li key={party} className="flex items-center gap-2 text-sm text-ink">
          <span className={`h-2 w-2 shrink-0 rounded-full ${PARTY_DOT[party.toUpperCase()] ?? "bg-zinc-500"}`} />
          <span className="font-medium">{name}</span>
          <span className="text-xs text-ink-muted">({party.toUpperCase()})</span>
        </li>
      ))}
    </ul>
  );
}

function SourceLine({
  source,
  date,
  citation,
}: {
  source: string;
  date: string | null;
  citation: { url: string; publisher: string } | null;
}) {
  return (
    <p className="mt-1.5 text-xs text-ink-muted">
      via {source}
      {date && ` · ${date}`}
      {citation?.url && (
        <>
          {" · "}
          <a
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-evidence-questionnaire hover:underline"
          >
            source
          </a>
        </>
      )}
    </p>
  );
}

function Banner({
  tone,
  label,
  children,
}: {
  tone: keyof typeof TONE;
  label: string;
  children: React.ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div className={`rounded-[2px] border ${t.box} px-4 py-3`}>
      <p className={`text-xs font-semibold uppercase tracking-widest ${t.label}`}>{label}</p>
      {children}
    </div>
  );
}

export function NomineeStatusBanner({
  status,
  candidates = [],
}: {
  status: RaceStatus | null;
  candidates?: CandidateCard[];
}) {
  if (!status) return null;
  const data = status;

  const date = fmtDate(data.resolvedAt);
  const hasWinners = Object.keys(data.winners ?? {}).length > 0;
  const isProjected = (data.flaggedReason ?? "").includes("projected");
  const viaNbc = data.confirmationBasis?.includes("nbc_decision_desk");
  const cardWinners = deriveProjectedWinners(candidates);

  if (data.status === "confirmed") {
    return (
      <Banner tone="green" label="✓ Nominee called">
        <WinnerList winners={data.winners} />
        <SourceLine source={viaNbc ? "NBC Decision Desk" : "official results"} date={date} citation={data.citation} />
      </Banner>
    );
  }

  if (data.status === "runoff_pending") {
    return (
      <Banner tone="amber" label="Runoff pending">
        <p className="mt-1 text-sm text-evidence-reported">No nominee yet — this race advances to a runoff.</p>
      </Banner>
    );
  }

  if (data.status === "provisional" && isProjected && hasWinners) {
    return (
      <Banner tone="indigo" label="Projected · unofficial">
        <WinnerList winners={data.winners} />
        <SourceLine source="news projection — not an official call" date={date} citation={data.citation} />
      </Banner>
    );
  }

  if (data.status === "provisional" && Object.keys(cardWinners).length > 0) {
    return (
      <Banner tone="indigo" label="Projected · unofficial">
        <WinnerList winners={cardWinners} />
        <SourceLine source="NBC Decision Desk — not an official call" date={date} citation={data.citation} />
      </Banner>
    );
  }

  if (data.status === "provisional") {
    return (
      <Banner tone="slate" label="Not yet called">
        <p className="mt-1 text-sm text-ink-muted">Official primary results aren’t available yet.</p>
      </Banner>
    );
  }

  if (data.status === "contested") {
    return (
      <Banner tone="amber" label="Contested">
        <p className="mt-1 text-sm text-evidence-reported">Sources disagree on the outcome — flagged for review.</p>
      </Banner>
    );
  }

  return null;
}
