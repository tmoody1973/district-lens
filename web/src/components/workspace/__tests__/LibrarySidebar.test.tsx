import { test, expect, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceLayoutProvider } from "../WorkspaceLayoutContext";
import { LibrarySidebar } from "../LibrarySidebar";

beforeEach(() => window.localStorage.clear());

test("journalist preset renders the expanded sidebar with brand and persona switch", () => {
  render(
    <WorkspaceLayoutProvider initialPersona="journalist">
      <LibrarySidebar>
        <p>section content</p>
      </LibrarySidebar>
    </WorkspaceLayoutProvider>,
  );
  expect(screen.getByText("DistrictLens")).toBeInTheDocument();
  expect(screen.getByRole("radiogroup", { name: "Persona" })).toBeInTheDocument();
  expect(screen.getByText("section content")).toBeInTheDocument();
});

test("voter preset renders the collapsed icon rail", () => {
  render(
    <WorkspaceLayoutProvider initialPersona="voter">
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
    <WorkspaceLayoutProvider initialPersona="journalist">
      <LibrarySidebar />
    </WorkspaceLayoutProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Collapse library" }));
  fireEvent.click(screen.getByRole("button", { name: "Expand library" }));
  expect(screen.getByText("DistrictLens")).toBeInTheDocument();
});
