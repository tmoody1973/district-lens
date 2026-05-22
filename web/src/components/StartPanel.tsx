"use client";
import type { AppMode } from "@/types/agent-state";

const MODES: { key: AppMode; label: string; icon: string }[] = [
  { key: "voter", label: "Voter Brief", icon: "📋" },
  { key: "journalist", label: "Journalist", icon: "📰" },
];

interface Props {
  mode: AppMode;
  onModeChange: (m: AppMode) => void;
  activeRaceKey: string | null;
  stage: string;
}

export function StartPanel({ mode, onModeChange, activeRaceKey, stage }: Props) {
  const isIdle = stage === "idle" || !activeRaceKey;

  return (
    <div className="flex flex-col h-full border-r-2 border-slate-900 bg-white p-4 gap-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Start</p>

      {isIdle ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center gap-2">
          <span className="text-3xl">🗳️</span>
          <p className="text-xs text-slate-400 leading-snug">Enter your address to get started</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => onModeChange(m.key)}
              className={[
                "rounded-[2px] border-2 px-3 py-2 text-sm font-semibold text-left transition-colors",
                mode === m.key
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-400",
              ].join(" ")}
            >
              {m.icon} {m.label}
            </button>
          ))}
        </div>
      )}

      {activeRaceKey && (
        <div className="mt-auto rounded-[2px] border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500 mb-0.5">Active race</p>
          <p className="text-sm font-semibold text-slate-900 truncate">{activeRaceKey}</p>
          <p className="text-xs text-slate-400 capitalize">{stage === "complete" ? "complete" : "running…"}</p>
        </div>
      )}
    </div>
  );
}
