import type { EvidenceCard } from "@/types/agent-state";

const TYPE_RANK: Record<string, number> = {
  direct_quote: 0, questionnaire: 1, voting_record: 2, reported: 3,
};

const SHORT_ANSWER_THRESHOLD = 80;

// Heuristic for cards that predate the structured evidenceType field.
function heuristicRank(answer: string): number {
  if (answer.includes('"') || answer.includes("“") || answer.includes("”")) return 0;
  if (answer.length < SHORT_ANSWER_THRESHOLD || answer.toLowerCase().includes("no direct statement")) return 4;
  return 3;
}

export function evidenceRank(card: EvidenceCard): number {
  if (card.evidenceType && card.evidenceType in TYPE_RANK) return TYPE_RANK[card.evidenceType];
  return heuristicRank(card.answer);
}

// Returns a new array sorted strongest-evidence-first (stable for ties).
export function sortByEvidenceStrength(cards: EvidenceCard[]): EvidenceCard[] {
  return [...cards].sort((a, b) => evidenceRank(a) - evidenceRank(b));
}
