import { test, expect } from "vitest";
import { derivePhase, deriveSeatType, type RaceStatus } from "../brief-layout";
import type { CandidateCard } from "@/types/agent-state";

const cand = (status: string): CandidateCard => ({
  candidateId: status, name: status, party: "DEM", status,
  photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-04",
});

const rs = (status: string): RaceStatus => ({
  status, winners: {}, confidence: null, confirmationBasis: [],
  flaggedReason: null, resolvedAt: null, citation: null,
});

test("derivePhase maps status values", () => {
  expect(derivePhase(rs("confirmed"))).toBe("called");
  expect(derivePhase(rs("provisional"))).toBe("primary");
  expect(derivePhase(rs("runoff_pending"))).toBe("runoff");
  expect(derivePhase(rs("contested"))).toBe("contested");
  expect(derivePhase(null)).toBe("primary");
});

test("deriveSeatType detects an incumbent", () => {
  expect(deriveSeatType([cand("incumbent"), cand("challenger")])).toBe("incumbent");
  expect(deriveSeatType([cand("open_seat"), cand("challenger")])).toBe("open");
  expect(deriveSeatType([])).toBe("open");
});
