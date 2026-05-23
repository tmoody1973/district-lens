"use client";

import { useState } from "react";

interface Props {
  onSubmit: (address: string) => void;
}

export function CanvasEmptyState({ onSubmit }: Props) {
  const [address, setAddress] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (address.trim()) onSubmit(address.trim());
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-10 text-center gap-6">
      <div className="max-w-md space-y-3">
        <h1 className="text-2xl font-bold text-slate-900 leading-tight">
          What congressional race do you need to understand?
        </h1>
        <p className="text-sm text-slate-500">
          The nonpartisan voter brief for every 2026 congressional race.
        </p>
      </div>

      <ul className="text-left space-y-2 text-sm text-slate-600 max-w-xs">
        <li className="flex items-start gap-2">
          <span className="text-blue-600 font-bold shrink-0">✓</span>
          Direct candidate quotes on issues you care about
        </li>
        <li className="flex items-start gap-2">
          <span className="text-blue-600 font-bold shrink-0">✓</span>
          FEC fundraising — who funds whom
        </li>
        <li className="flex items-start gap-2">
          <span className="text-blue-600 font-bold shrink-0">✓</span>
          {"Incumbent's actual voting record"}
        </li>
        <li className="flex items-start gap-2">
          <span className="text-blue-600 font-bold shrink-0">✓</span>
          Every claim cited
        </li>
      </ul>

      <form onSubmit={handleSubmit} className="flex gap-2 w-full max-w-sm">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Your street address or ZIP code"
          className="flex-1 rounded-[2px] border-2 border-slate-900 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700"
        />
        <button
          type="submit"
          disabled={!address.trim()}
          className="rounded-[2px] border-2 border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 hover:bg-slate-700 transition-colors whitespace-nowrap"
        >
          Find My Race →
        </button>
      </form>

      <p className="text-xs text-slate-400">or ask anything in the chat →</p>
    </div>
  );
}
