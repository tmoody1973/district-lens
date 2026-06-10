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
      className="group rounded-[2px] border border-edge bg-surface-raised open:bg-surface-raised"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 select-none">
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-purple-900/30 border border-purple-700/40 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-purple-400">
            {issue.toUpperCase()}
          </span>
          <span className="text-xs text-ink-faint">
            {cards.length} {cards.length === 1 ? "candidate" : "candidates"}
          </span>
        </span>
        <span className="text-ink-faint transition-transform group-open:rotate-180">⌄</span>
      </summary>

      <div className="border-t border-edge p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {cards.map((card, index) => (
            <EvidenceCard key={`${card.candidateName}-${index}`} evidence={card} compact />
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-faint">
          Evidence from public sources only. DistrictLens never recommends how to vote.
        </p>
      </div>
    </details>
  );
}
