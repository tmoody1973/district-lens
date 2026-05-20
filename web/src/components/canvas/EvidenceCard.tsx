"use client";
import type { EvidenceCard as EvidenceCardType } from "@/types/agent-state";

interface Props { evidence: EvidenceCardType; }

export function EvidenceCard({ evidence }: Props) {
  return (
    <div className="rounded-[2px] border-2 border-amber-400 bg-amber-50 p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-widest text-amber-700">
          Position Evidence · Perplexity Sonar
        </p>
        <span className="text-xs text-amber-600 font-medium">{evidence.issue}</span>
      </div>
      <p className="text-sm font-semibold text-slate-900">{evidence.candidateName}</p>
      <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
        {evidence.answer}
      </p>
      {evidence.sources.length > 0 && (
        <div className="space-y-1 border-t border-amber-200 pt-2">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Sources</p>
          {evidence.sources.slice(0, 4).map((s, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="text-xs font-mono text-amber-600 shrink-0">[{i + 1}]</span>
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
      <p className="text-xs text-amber-700 border-t border-amber-200 pt-2">
        Evidence from public sources. Direct statements distinguished from characterizations.
        DistrictLens never recommends how to vote.
      </p>
    </div>
  );
}
