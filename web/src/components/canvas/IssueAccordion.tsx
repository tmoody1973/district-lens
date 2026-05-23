"use client";
import type { EvidenceCard as EvidenceCardType } from "@/types/agent-state";
import { EvidenceCard } from "./EvidenceCard";

interface Props {
  issue: string;
  cards: EvidenceCardType[];
  defaultOpen?: boolean;
}

export function IssueAccordion({ issue, cards, defaultOpen = false }: Props) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-[2px] border border-slate-200 bg-white open:bg-slate-50/40"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 select-none">
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-purple-700">
            {issue.toUpperCase()}
          </span>
          <span className="text-xs text-slate-400">
            {cards.length} {cards.length === 1 ? "candidate" : "candidates"}
          </span>
        </span>
        <span className="text-slate-400 transition-transform group-open:rotate-180">⌄</span>
      </summary>

      <div className="border-t border-slate-100 p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {cards.map((card, index) => (
            <EvidenceCard key={`${card.candidateName}-${index}`} evidence={card} compact />
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Evidence from public sources only. DistrictLens never recommends how to vote.
        </p>
      </div>
    </details>
  );
}
