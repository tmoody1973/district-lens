import { test, expect } from "vitest";
import { derivePhase, deriveSeatType } from "../brief-layout";
import type { CandidateCard } from "@/types/agent-state";

const cand = (status: string): CandidateCard => ({
  candidateId: status, name: status, party: "DEM", status,
  photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-04",
});

test("derivePhase maps status values", () => {
  expect(derivePhase({ status: "confirmed" } as any)).toBe("called");
  expect(derivePhase({ status: "provisional" } as any)).toBe("primary");
  expect(derivePhase({ status: "runoff_pending" } as any)).toBe("runoff");
  expect(derivePhase({ status: "contested" } as any)).toBe("contested");
  expect(derivePhase(null)).toBe("primary");
});

test("deriveSeatType detects an incumbent", () => {
  expect(deriveSeatType([cand("incumbent"), cand("challenger")])).toBe("incumbent");
  expect(deriveSeatType([cand("open_seat"), cand("challenger")])).toBe("open");
  expect(deriveSeatType([])).toBe("open");
});
