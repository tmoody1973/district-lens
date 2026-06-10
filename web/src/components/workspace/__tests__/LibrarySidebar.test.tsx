import { test, expect, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceLayoutProvider } from "../WorkspaceLayoutContext";
import { LibrarySidebar } from "../LibrarySidebar";
import { LAYOUT_STORAGE_KEY } from "@/lib/workspace/layout";

beforeEach(() => window.localStorage.clear());

test("renders the expanded sidebar with brand — no persona switch (U1)", () => {
  render(
    <WorkspaceLayoutProvider>
      <LibrarySidebar>
        <p>section content</p>
      </LibrarySidebar>
    </WorkspaceLayoutProvider>,
  );
  expect(screen.getByText("DistrictLens")).toBeInTheDocument();
  expect(screen.queryByRole("radiogroup", { name: "Persona" })).not.toBeInTheDocument();
  expect(screen.getByText("section content")).toBeInTheDocument();
});

test("stored collapsed layout renders the icon rail", () => {
  window.localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    JSON.stringify({ libraryCollapsed: true, chatCollapsed: false, chatPct: 32 }),
  );
  render(
    <WorkspaceLayoutProvider>
      <LibrarySidebar>
        <p>section content</p>
      </LibrarySidebar>
    </WorkspaceLayoutProvider>,
  );
  expect(screen.queryByText("section content")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Expand library" })).toBeInTheDocument();
});

test("collapse and expand round-trip", () => {
  render(
    <WorkspaceLayoutProvider>
      <LibrarySidebar />
    </WorkspaceLayoutProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Collapse library" }));
  fireEvent.click(screen.getByRole("button", { name: "Expand library" }));
  expect(screen.getByText("DistrictLens")).toBeInTheDocument();
});
