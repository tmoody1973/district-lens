import { test, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceLayoutProvider } from "../WorkspaceLayoutContext";
import { WorkspaceShell } from "../WorkspaceShell";
import { LAYOUT_STORAGE_KEY } from "@/lib/workspace/layout";

beforeEach(() => window.localStorage.clear());

function renderShell() {
  return render(
    <WorkspaceLayoutProvider>
      <WorkspaceShell
        library={<aside>LIB</aside>}
        chat={<div>CHAT</div>}
        artifact={<div>ARTIFACT</div>}
      />
    </WorkspaceLayoutProvider>,
  );
}

test("renders all three panes and the divider", () => {
  renderShell();
  expect(screen.getByText("LIB")).toBeInTheDocument();
  expect(screen.getByText("CHAT")).toBeInTheDocument();
  expect(screen.getByText("ARTIFACT")).toBeInTheDocument();
  expect(screen.getByRole("separator")).toBeInTheDocument();
});

test("no divider when the chat is collapsed", () => {
  window.localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    JSON.stringify({ persona: "journalist", libraryCollapsed: false, chatCollapsed: true, chatPct: 40 }),
  );
  renderShell();
  expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  expect(screen.getByText("ARTIFACT")).toBeInTheDocument();
});

test("dragging the divider updates the persisted chat width within bounds", () => {
  renderShell();
  const container = screen.getByTestId("workspace-split");
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
    left: 0, right: 1000, top: 0, bottom: 800, width: 1000, height: 800, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);

  fireEvent.mouseDown(screen.getByRole("separator"));
  fireEvent.mouseMove(window, { clientX: 300 }); // 30% of 1000px
  fireEvent.mouseUp(window);

  const stored = JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY)!);
  expect(stored.chatPct).toBe(30);
});
