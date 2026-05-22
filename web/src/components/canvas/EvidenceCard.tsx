"use client";
import type { EvidenceCard as EvidenceCardType } from "@/types/agent-state";

interface Props { evidence: EvidenceCardType; }

const SHORT_ANSWER_THRESHOLD = 80;

function confidenceLabel(answer: string): string {
  if (answer.includes('"') || answer.includes('\u201C') || answer.includes('\u201D')) {
    return "direct quote";
  }
  if (answer.length < SHORT_ANSWER_THRESHOLD || answer.toLowerCase().includes("no direct statement")) {
    return "no statement found";
  }
  return "paraphrase";
}

export function EvidenceCard({ evidence }: Props) {
  const confidence = confidenceLabel(evidence.answer);
  const confidenceColor =
    confidence === "direct quote"
      ? "text-green-700"
      : confidence === "paraphrase"
      ? "text-amber-700"
      : "text-slate-500";

  return (
    <div className="rounded-[2px] border-l-4 border-l-purple-500 border border-slate-200 bg-white p-4 space-y-2">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700 uppercase tracking-wider">
          {evidence.issue.toUpperCase()}
        </span>
        <span className={`text-xs font-medium ${confidenceColor}`}>{confidence}</span>
      </div>

      <p className="text-sm font-semibold text-slate-900">{evidence.candidateName}</p>

      <p className="text-sm text-slate-700 leading-relaxed italic whitespace-pre-wrap">
        {evidence.answer}
      </p>

      {evidence.sources.length > 0 && (
        <div className="space-y-1 border-t border-slate-100 pt-2">
          {evidence.sources.slice(0, 3).map((s, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="text-xs font-mono text-purple-400 shrink-0">[{i + 1}]</span>
              <div>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-700 hover:underline"
                >
                  {s.title}
                </a>
                {s.date && <span className="text-xs text-slate-400 ml-1">· {s.date}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400 border-t border-slate-100 pt-2">
        Evidence from public sources only. DistrictLens never recommends how to vote.
      </p>
    </div>
  );
}
