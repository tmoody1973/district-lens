import { test, expect } from "vitest";
import {
  CHAT_PCT_MAX,
  CHAT_PCT_MIN,
  DEFAULT_LAYOUT,
  clampChatPct,
  parseLayout,
  serializeLayout,
} from "@/lib/workspace/layout";

test("default layout: library expanded, chat docked at 32%", () => {
  expect(DEFAULT_LAYOUT).toEqual({
    libraryCollapsed: false,
    chatCollapsed: false,
    chatPct: 32,
  });
});

test("parseLayout returns a fresh object each call (no shared mutation)", () => {
  const a = parseLayout(null);
  a.chatPct = 99;
  expect(parseLayout(null).chatPct).toBe(32);
});

test("clampChatPct clamps below the minimum", () => {
  expect(clampChatPct(5)).toBe(CHAT_PCT_MIN);
});

test("clampChatPct clamps above the maximum", () => {
  expect(clampChatPct(95)).toBe(CHAT_PCT_MAX);
});

test("clampChatPct passes through in-range values", () => {
  expect(clampChatPct(33)).toBe(33);
});

test("parseLayout(null) falls back to the default layout", () => {
  expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
});

test("parseLayout on corrupt JSON falls back to the default", () => {
  expect(parseLayout("{not json")).toEqual(DEFAULT_LAYOUT);
});

test("parseLayout on wrong field types falls back to the default", () => {
  const raw = JSON.stringify({
    libraryCollapsed: "yes",
    chatCollapsed: false,
    chatPct: 30,
  });
  expect(parseLayout(raw)).toEqual(DEFAULT_LAYOUT);
});

test("R2: a persona-era stored blob still parses, persona ignored", () => {
  // Layouts persisted before the unified workspace carry a persona field —
  // the parser must tolerate (and drop) it rather than resetting the user's
  // pane sizes.
  const raw = JSON.stringify({
    persona: "journalist",
    libraryCollapsed: true,
    chatCollapsed: false,
    chatPct: 40,
  });
  expect(parseLayout(raw)).toEqual({
    libraryCollapsed: true,
    chatCollapsed: false,
    chatPct: 40,
  });
});

test("parseLayout clamps a stored out-of-range chatPct", () => {
  const raw = JSON.stringify({
    libraryCollapsed: true,
    chatCollapsed: false,
    chatPct: 90,
  });
  expect(parseLayout(raw).chatPct).toBe(CHAT_PCT_MAX);
});

test("serialize → parse round-trips a valid layout", () => {
  const layout = {
    libraryCollapsed: true,
    chatCollapsed: true,
    chatPct: 35,
  };
  expect(parseLayout(serializeLayout(layout))).toEqual(layout);
});
