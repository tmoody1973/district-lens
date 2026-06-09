import { test, expect } from "vitest";
import {
  CHAT_PCT_MAX,
  CHAT_PCT_MIN,
  clampChatPct,
  parseLayout,
  presetFor,
  serializeLayout,
} from "@/lib/workspace/layout";

test("voter preset: library railed, chat docked at 28%", () => {
  expect(presetFor("voter")).toEqual({
    persona: "voter",
    libraryCollapsed: true,
    chatCollapsed: false,
    chatPct: 28,
  });
});

test("journalist preset: library open, chat at 40%", () => {
  expect(presetFor("journalist")).toEqual({
    persona: "journalist",
    libraryCollapsed: false,
    chatCollapsed: false,
    chatPct: 40,
  });
});

test("presetFor returns a fresh object each call (no shared mutation)", () => {
  const a = presetFor("voter");
  a.chatPct = 99;
  expect(presetFor("voter").chatPct).toBe(28);
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

test("parseLayout(null) falls back to the persona preset", () => {
  expect(parseLayout(null, "journalist")).toEqual(presetFor("journalist"));
});

test("parseLayout on corrupt JSON falls back to the preset", () => {
  expect(parseLayout("{not json", "voter")).toEqual(presetFor("voter"));
});

test("parseLayout on wrong field types falls back to the preset", () => {
  const raw = JSON.stringify({
    persona: "voter",
    libraryCollapsed: "yes",
    chatCollapsed: false,
    chatPct: 30,
  });
  expect(parseLayout(raw, "voter")).toEqual(presetFor("voter"));
});

test("parseLayout on unknown persona falls back to the preset", () => {
  const raw = JSON.stringify({
    persona: "admin",
    libraryCollapsed: false,
    chatCollapsed: false,
    chatPct: 30,
  });
  expect(parseLayout(raw, "voter")).toEqual(presetFor("voter"));
});

test("parseLayout clamps a stored out-of-range chatPct", () => {
  const raw = JSON.stringify({
    persona: "voter",
    libraryCollapsed: true,
    chatCollapsed: false,
    chatPct: 90,
  });
  expect(parseLayout(raw, "voter").chatPct).toBe(CHAT_PCT_MAX);
});

test("serialize → parse round-trips a valid layout", () => {
  const layout = {
    persona: "journalist" as const,
    libraryCollapsed: true,
    chatCollapsed: true,
    chatPct: 35,
  };
  expect(parseLayout(serializeLayout(layout), "voter")).toEqual(layout);
});
