"use client";

interface NoFootprintCandidate {
  candidateId: string;
  name: string;
}

interface Props {
  candidates: NoFootprintCandidate[];
  /** Whether other candidates in this race already rendered positions above. */
  hasOthers: boolean;
}

/**
 * The honest no-footprint empty state (Phase 1 T5): one crisp line per candidate
 * we searched but found no indexed positions for — so every candidate is
 * acknowledged rather than silently dropped, and the card never shows a model's
 * search monologue.
 */
export function PositionsEmptyState({ candidates, hasOthers }: Props) {
  if (candidates.length === 0) return null;
  return (
    <div className={hasOthers ? "mt-3 border-t border-edge pt-3" : undefined}>
      <ul className="space-y-1.5">
        {candidates.map((candidate) => (
          <li
            key={candidate.candidateId}
            className="flex flex-wrap items-baseline gap-x-2 text-sm"
          >
            <span className="font-medium text-ink-muted">{candidate.name}</span>
            <span className="text-ink-faint">
              — No public positions found in indexed sources yet
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
