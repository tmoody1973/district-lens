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

import { buildHeaderFacts } from "../brief-layout";
import type { DistrictLensState } from "@/types/agent-state";

const baseState = (over: Partial<DistrictLensState>): DistrictLensState => ({
  mode: "voter", mapFocus: null, currentRaceKey: "2026-H-WI-03", stage: "complete",
  briefStartedAt: null, status_message: null, candidates: [], finance: [],
  legislation: [], news: [], positions: [], stateRaces: [], comparisons: [],
  briefMarkdown: null, briefReady: true, ...over,
});

test("header title, office, and stakes for a House race", () => {
  const h = buildHeaderFacts(baseState({}), null);
  expect(h.officeLabel).toBe("U.S. House");
  expect(h.title).toBe("U.S. House — Wisconsin District 3");
  expect(h.stakesLabel).toBe("1 of 435 U.S. House seats");
  expect(h.competitivenessAvailable).toBe(false);
});

test("header for a Senate race omits the district", () => {
  const h = buildHeaderFacts(baseState({ currentRaceKey: "2026-S-WI" }), null);
  expect(h.title).toBe("U.S. Senate — Wisconsin");
  expect(h.stakesLabel).toBe("1 of 100 — chamber control + judicial confirmations");
});

test("seat label names the incumbent", () => {
  const h = buildHeaderFacts(baseState({
    candidates: [{ candidateId: "1", name: "Gwen Moore", party: "DEM", status: "incumbent", photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-03" }],
  }), null);
  expect(h.seatType).toBe("incumbent");
  expect(h.seatLabel).toBe("Incumbent — Gwen Moore (DEM)");
});

test("open seat + primary field summary counts by party", () => {
  const mk = (id: string, party: string) => ({ candidateId: id, name: id, party, status: "open_seat", photoUrl: "", photoSource: "placeholder" as const, raceKey: "2026-H-WI-03" });
  const h = buildHeaderFacts(baseState({ candidates: [mk("a","DEM"), mk("b","DEM"), mk("c","REP")] }), null);
  expect(h.seatLabel).toBe("Open seat");
  expect(h.fieldSummary).toBe("2 Democrats · 1 Republican");
  expect(h.phaseLabel).toBe("Primary · winner advances to November");
});

test("money summary sums receipts and names top fundraiser", () => {
  const h = buildHeaderFacts(baseState({
    finance: [
      { candidateId: "1", name: "Jane Smith", party: "DEM", receipts: 2_100_000, disbursements: null, cashOnHand: null, individualContributions: null, pacContributions: null, coverageEndDate: null },
      { candidateId: "2", name: "Bob Jones", party: "REP", receipts: 2_200_000, disbursements: null, cashOnHand: null, individualContributions: null, pacContributions: null, coverageEndDate: null },
    ],
  }), null);
  expect(h.moneySummary).toBe("$4.3M raised · top Jones $2.2M");
});

test("money summary falls back when no finance", () => {
  expect(buildHeaderFacts(baseState({}), null).moneySummary).toBe("Finance data not yet available");
});

test("unparseable race key degrades gracefully", () => {
  const h = buildHeaderFacts(baseState({ currentRaceKey: "garbage" }), null);
  expect(h.title).toBe("Race");
  expect(h.officeLabel).toBe("Race");
});

import { buildSections } from "../brief-layout";

const ids = (s: { id: string }[]) => s.map((x) => x.id);

test("voter incumbent with bills: record present, money/news collapsed", () => {
  const s = buildSections("voter", "incumbent",
    baseState({ legislation: [{ billId: "1", title: "t", introducedDate: null, latestAction: null, memberName: "x" }], finance: [{ candidateId: "1", name: "n", party: "DEM", receipts: 1, disbursements: null, cashOnHand: null, individualContributions: null, pacContributions: null, coverageEndDate: null }], candidates: [{ candidateId: "1", name: "n", party: "DEM", status: "incumbent", photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-03" }] }));
  expect(ids(s)).toEqual(["candidates", "record", "positions", "money", "news"]);
  expect(s.find((x) => x.id === "money")!.defaultOpen).toBe(false);
  expect(s.find((x) => x.id === "positions")!.defaultOpen).toBe(true);
});

test("voter open seat: no record section, news still included", () => {
  const s = buildSections("voter", "open",
    baseState({ candidates: [{ candidateId: "1", name: "n", party: "DEM", status: "open_seat", photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-03" }] }));
  expect(ids(s)).toEqual(["candidates", "positions", "news"]);
  expect(s.find((x) => x.id === "news")!.defaultOpen).toBe(false);
});

test("incumbent without bills omits the record section", () => {
  const s = buildSections("voter", "incumbent",
    baseState({ legislation: [], candidates: [{ candidateId: "1", name: "n", party: "DEM", status: "incumbent", photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-03" }] }));
  expect(ids(s)).not.toContain("record");
});

test("journalist leads with money, open by default", () => {
  const s = buildSections("journalist", "incumbent",
    baseState({ legislation: [{ billId: "1", title: "t", introducedDate: null, latestAction: null, memberName: "x" }], finance: [{ candidateId: "1", name: "n", party: "DEM", receipts: 1, disbursements: null, cashOnHand: null, individualContributions: null, pacContributions: null, coverageEndDate: null }], candidates: [{ candidateId: "1", name: "n", party: "DEM", status: "incumbent", photoUrl: "", photoSource: "placeholder", raceKey: "2026-H-WI-03" }] }));
  expect(ids(s)).toEqual(["candidates", "money", "record", "positions", "news"]);
  expect(s.find((x) => x.id === "money")!.defaultOpen).toBe(true);
});
