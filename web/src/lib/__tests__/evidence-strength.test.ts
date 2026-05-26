import { test, expect } from "vitest";
import { sortByEvidenceStrength } from "../evidence-strength";
import type { EvidenceCard } from "@/types/agent-state";

const card = (name: string, over: Partial<EvidenceCard>): EvidenceCard => ({
  candidateName: name, issue: "housing", answer: "an answer long enough to be a paraphrase here", sources: [], ...over,
});

test("orders by evidence strength, strongest first", () => {
  const input = [
    card("reported", { evidenceType: "reported" }),
    card("direct", { evidenceType: "direct_quote" }),
    card("voting", { evidenceType: "voting_record" }),
    card("quest", { evidenceType: "questionnaire" }),
  ];
  expect(sortByEvidenceStrength(input).map((c) => c.candidateName))
    .toEqual(["direct", "quest", "voting", "reported"]);
});

test("does not mutate the input array", () => {
  const input = [card("a", { evidenceType: "reported" }), card("b", { evidenceType: "direct_quote" })];
  sortByEvidenceStrength(input);
  expect(input.map((c) => c.candidateName)).toEqual(["a", "b"]);
});

test("cards without evidenceType fall back to a heuristic", () => {
  const quoted = card("quoted", { answer: '"I firmly support this measure for our district"' });
  const none = card("none", { answer: "No direct statement found." });
  const sorted = sortByEvidenceStrength([none, quoted]);
  expect(sorted.map((c) => c.candidateName)).toEqual(["quoted", "none"]);
});
