"use client";

interface Props { raceKey: string; }

export function RaceHeader({ raceKey }: Props) {
  const [, office, state, district] = raceKey.split("-");
  const officeLabel = office === "H" ? "House" : "Senate";
  return (
    <div className="border-b-2 border-slate-900 pb-4 mb-6">
      <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
        2026 Congressional Race
      </p>
      <p className="mt-1 font-mono text-3xl font-bold text-blue-700">{raceKey}</p>
      <p className="text-sm text-slate-600">
        {state} — {officeLabel}{district !== "00" ? ` District ${parseInt(district, 10)}` : ""}
      </p>
    </div>
  );
}
