import { test, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
import {
  WorkspaceLayoutProvider,
  useWorkspaceLayout,
} from "../WorkspaceLayoutContext";
import { CHAT_PCT_MAX, LAYOUT_STORAGE_KEY } from "@/lib/workspace/layout";

let api: ReturnType<typeof useWorkspaceLayout>;

function Probe() {
  api = useWorkspaceLayout();
  return <span data-testid="persona">{api.layout.persona}</span>;
}

test("starts from the initialPersona preset", () => {
  render(
    <WorkspaceLayoutProvider initialPersona="journalist">
      <Probe />
    </WorkspaceLayoutProvider>,
  );
  expect(screen.getByTestId("persona").textContent).toBe("journalist");
  expect(api.layout.chatPct).toBe(40);
});

test("setPersona applies the full preset", () => {
  render(
    <WorkspaceLayoutProvider initialPersona="journalist">
      <Probe />
    </WorkspaceLayoutProvider>,
  );
  act(() => api.setPersona("voter"));
  expect(api.layout).toMatchObject({ persona: "voter", libraryCollapsed: true, chatPct: 28 });
});

test("toggleLibrary flips only libraryCollapsed", () => {
  render(
    <WorkspaceLayoutProvider initialPersona="journalist">
      <Probe />
    </WorkspaceLayoutProvider>,
  );
  act(() => api.toggleLibrary());
  expect(api.layout.libraryCollapsed).toBe(true);
  expect(api.layout.chatPct).toBe(40);
});

test("setChatPct clamps and persists to localStorage", () => {
  render(
    <WorkspaceLayoutProvider initialPersona="voter">
      <Probe />
    </WorkspaceLayoutProvider>,
  );
  act(() => api.setChatPct(99));
  expect(api.layout.chatPct).toBe(CHAT_PCT_MAX);
  const stored = JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY)!);
  expect(stored.chatPct).toBe(CHAT_PCT_MAX);
});

test("restores a previously stored layout on mount", () => {
  window.localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    JSON.stringify({ persona: "journalist", libraryCollapsed: true, chatCollapsed: true, chatPct: 33 }),
  );
  render(
    <WorkspaceLayoutProvider initialPersona="voter">
      <Probe />
    </WorkspaceLayoutProvider>,
  );
  expect(api.layout).toEqual({ persona: "journalist", libraryCollapsed: true, chatCollapsed: true, chatPct: 33 });
});

test("corrupt stored layout resets to the initialPersona preset", () => {
  window.localStorage.setItem(LAYOUT_STORAGE_KEY, "{nope");
  render(
    <WorkspaceLayoutProvider initialPersona="voter">
      <Probe />
    </WorkspaceLayoutProvider>,
  );
  expect(api.layout.persona).toBe("voter");
  expect(api.layout.chatPct).toBe(28);
});
