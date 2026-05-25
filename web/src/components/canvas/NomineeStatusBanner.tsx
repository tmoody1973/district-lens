"use client";
import { useEffect, useState } from "react";

interface NomineeStatus {
  status: string;
  winners: Record<string, string>;
  confidence: number | null;
  confirmationBasis: string[];
  flaggedReason: string | null;
  resolvedAt: string | null;
  citation: { url: string; publisher: string } | null;
}

const PARTY_DOT: Record<string, string> = {
  DEM: "bg-blue-600",
  REP: "bg-red-600",
  IND: "bg-slate-400",
};

const TONE: Record<string, { box: string; label: string }> = {
  green: { box: "border-green-300 bg-green-50", label: "text-green-800" },
  amber: { box: "border-amber-300 bg-amber-50", label: "text-amber-800" },
  indigo: { box: "border-indigo-300 bg-indigo-50", label: "text-indigo-800" },
  slate: { box: "border-slate-200 bg-slate-50", label: "text-slate-600" },
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
        <li key={party} className="flex items-center gap-2 text-sm text-slate-900">
          <span className={`h-2 w-2 shrink-0 rounded-full ${PARTY_DOT[party.toUpperCase()] ?? "bg-slate-400"}`} />
          <span className="font-medium">{name}</span>
          <span className="text-xs text-slate-500">({party.toUpperCase()})</span>
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
    <p className="mt-1.5 text-xs text-slate-500">
      via {source}
      {date && ` · ${date}`}
      {citation?.url && (
        <>
          {" · "}
          <a
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 hover:underline"
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

export function NomineeStatusBanner({ raceKey }: { raceKey: string }) {
  // Tag fetched data with the race it belongs to so a previous race's badge is
  // never shown for the current one (and we avoid resetting state in the effect).
  const [data, setData] = useState<(NomineeStatus & { forKey: string }) | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/race/status?race_key=${encodeURIComponent(raceKey)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json && !json.error) {
          setData({ ...(json as NomineeStatus), forKey: raceKey });
        }
      })
      .catch(() => {
        /* no status yet — render nothing */
      });
    return () => {
      cancelled = true;
    };
  }, [raceKey]);

  if (!data || data.forKey !== raceKey) return null;

  const date = fmtDate(data.resolvedAt);
  const hasWinners = Object.keys(data.winners ?? {}).length > 0;
  const isProjected = (data.flaggedReason ?? "").includes("projected");
  const viaNbc = data.confirmationBasis?.includes("nbc_decision_desk");

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
        <p className="mt-1 text-sm text-amber-800">No nominee yet — this race advances to a runoff.</p>
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

  if (data.status === "provisional") {
    return (
      <Banner tone="slate" label="Not yet called">
        <p className="mt-1 text-sm text-slate-500">Official primary results aren’t available yet.</p>
      </Banner>
    );
  }

  if (data.status === "contested") {
    return (
      <Banner tone="amber" label="Contested">
        <p className="mt-1 text-sm text-amber-800">Sources disagree on the outcome — flagged for review.</p>
      </Banner>
    );
  }

  return null;
}
