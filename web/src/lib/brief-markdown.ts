// Serializes the visible voter brief to clean markdown — powers the journalist
// workflow actions (copy brief, .md export). Sections render only when
// populated; citations keep their URLs so the export stays evidence-first.

import type { DistrictLensState, EvidenceCard } from "@/types/agent-state";

const DISCLAIMER =
  "Evidence from public sources only. DistrictLens never recommends how to vote.";

function money(value: number | null): string {
  return value == null ? "not reported" : `$${value.toLocaleString()}`;
}

function candidateLines(state: DistrictLensState): string[] {
  if (state.candidates.length === 0) return [];
  const rows = state.candidates.map(
    (candidate) => `- ${candidate.name} (${candidate.party}, ${candidate.status})`,
  );
  return ["## Candidates", ...rows, ""];
}

function financeLines(state: DistrictLensState): string[] {
  if (state.finance.length === 0) return [];
  const rows = state.finance.map((row) => {
    const coverage = row.coverageEndDate ? ` · through ${row.coverageEndDate}` : "";
    return `- ${row.name}: raised ${money(row.receipts)}, spent ${money(row.disbursements)}, cash on hand ${money(row.cashOnHand)}${coverage}`;
  });
  return ["## Campaign finance (FEC)", ...rows, ""];
}

function positionLines(positions: EvidenceCard[]): string[] {
  if (positions.length === 0) return [];
  const lines: string[] = ["## Issue positions"];
  for (const card of positions) {
    lines.push(`### ${card.issue} — ${card.candidateName}`);
    lines.push(card.answer);
    for (const source of card.sources) {
      const archived = source.archivedAt ? ` (archived ${source.archivedAt})` : "";
      lines.push(`- ${source.title}: ${source.url}${archived}`);
    }
    lines.push("");
  }
  return lines;
}

export function briefToMarkdown(state: DistrictLensState): string {
  const title = state.currentRaceKey ?? "Voter brief";
  return [
    `# Voter brief — ${title}`,
    "",
    ...candidateLines(state),
    ...financeLines(state),
    ...positionLines(state.positions),
    DISCLAIMER,
    "",
  ].join("\n");
}
