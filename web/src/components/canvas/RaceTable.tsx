"use client";
import { useState } from "react";
import type { RaceRow } from "@/types/agent-state";

type SortKey = "financeGap" | "pacPct" | "state";
type SortDir = "asc" | "desc";

function fmtMoney(val: number | null): string {
  if (val == null) return "—";
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(val / 1_000)}K`;
  return `$${val}`;
}

interface Props {
  races: RaceRow[];
  onRaceClick: (raceKey: string) => void;
}

export function RaceTable({ races, onRaceClick }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("financeGap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = [...races].sort((a, b) => {
    const av = sortKey === "state" ? a.state : (a[sortKey] ?? 0);
    const bv = sortKey === "state" ? b.state : (b[sortKey] ?? 0);
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "desc" ? " ↓" : " ↑") : "";

  return (
    <div className="flex flex-col h-full overflow-auto p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">
        {races.length} races · click to build brief
      </p>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-900 text-xs font-semibold uppercase tracking-widest text-slate-500">
            <th className="text-left py-2 pr-3">Race</th>
            <th
              className="text-left py-2 pr-3 cursor-pointer hover:text-slate-900"
              onClick={() => toggleSort("state")}
            >
              State{arrow("state")}
            </th>
            <th
              className="text-right py-2 pr-3 cursor-pointer hover:text-slate-900"
              onClick={() => toggleSort("financeGap")}
            >
              Gap{arrow("financeGap")}
            </th>
            <th
              className="text-right py-2 cursor-pointer hover:text-slate-900"
              onClick={() => toggleSort("pacPct")}
            >
              PAC%{arrow("pacPct")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((race) => (
            <tr
              key={race.raceKey}
              onClick={() => onRaceClick(race.raceKey)}
              className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
            >
              <td className="py-2 pr-3 font-medium text-slate-900">
                {race.incumbentName ?? race.raceKey}
              </td>
              <td className="py-2 pr-3 text-slate-500">
                {race.state}-{race.district}
              </td>
              <td className="py-2 pr-3 text-right font-mono text-slate-700">
                {fmtMoney(race.financeGap)}
              </td>
              <td
                className={`py-2 text-right font-mono ${
                  (race.pacPct ?? 0) > 60
                    ? "text-amber-600 font-semibold"
                    : "text-slate-500"
                }`}
              >
                {race.pacPct != null ? `${race.pacPct}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
