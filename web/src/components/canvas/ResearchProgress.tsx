"use client";
import type { ResearchStage } from "@/types/agent-state";

const STAGES: ResearchStage[] = [
  "district",
  "candidates",
  "finance",
  "legislation",
  "news",
  "complete",
];

const LABELS: Record<ResearchStage, string> = {
  idle: "Idle",
  district: "District",
  candidates: "Candidates",
  finance: "Finance",
  legislation: "Record",
  news: "News",
  complete: "Done",
};

interface Props { stage: ResearchStage; }

export function ResearchProgress({ stage }: Props) {
  if (stage === "idle") return null;
  const currentIndex = STAGES.indexOf(stage);

  return (
    <div className="flex items-center gap-1 text-xs font-medium flex-wrap">
      {STAGES.map((s, i) => {
        const done = i < currentIndex || stage === "complete";
        const active = s === stage && stage !== "complete";
        return (
          <div key={s} className="flex items-center gap-1">
            <span
              className={[
                "px-2 py-0.5 rounded-[2px] border transition-colors",
                done ? "bg-slate-900 text-white border-slate-900" : "",
                active ? "bg-blue-700 text-white border-blue-700 animate-pulse" : "",
                !done && !active ? "bg-white text-slate-400 border-slate-300" : "",
              ].join(" ")}
            >
              {LABELS[s]}
            </span>
            {i < STAGES.length - 1 && (
              <span className="text-slate-300">→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
