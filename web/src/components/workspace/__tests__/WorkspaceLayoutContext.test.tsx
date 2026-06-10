import { test, expect, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import {
  WorkspaceLayoutProvider,
  useWorkspaceLayout,
} from "../WorkspaceLayoutContext";
import { CHAT_PCT_MAX, DEFAULT_LAYOUT, LAYOUT_STORAGE_KEY } from "@/lib/workspace/layout";

beforeEach(() => window.localStorage.clear());

let api: ReturnType<typeof useWorkspaceLayout>;

function Probe() {
  api = useWorkspaceLayout();
  return null;
}

function renderProvider() {
  return render(
    <WorkspaceLayoutProvider>
      <Probe />
    </WorkspaceLayoutProvider>,
  );
}

test("starts from the default layout", () => {
  renderProvider();
  expect(api.layout).toEqual(DEFAULT_LAYOUT);
});

test("toggleLibrary flips only libraryCollapsed", () => {
  renderProvider();
  act(() => api.toggleLibrary());
  expect(api.layout.libraryCollapsed).toBe(true);
  expect(api.layout.chatPct).toBe(DEFAULT_LAYOUT.chatPct);
});

test("setChatPct clamps and persists to localStorage", () => {
  renderProvider();
  act(() => api.setChatPct(99));
  expect(api.layout.chatPct).toBe(CHAT_PCT_MAX);
  const stored = JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY)!);
  expect(stored.chatPct).toBe(CHAT_PCT_MAX);
});

test("restores a previously stored layout on mount (persona-era blob tolerated)", () => {
  window.localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    JSON.stringify({ persona: "journalist", libraryCollapsed: true, chatCollapsed: true, chatPct: 33 }),
  );
  renderProvider();
  expect(api.layout).toEqual({ libraryCollapsed: true, chatCollapsed: true, chatPct: 33 });
});

test("corrupt stored layout resets to the default", () => {
  window.localStorage.setItem(LAYOUT_STORAGE_KEY, "{nope");
  renderProvider();
  expect(api.layout).toEqual(DEFAULT_LAYOUT);
});
