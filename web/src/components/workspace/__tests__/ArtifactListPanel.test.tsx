import { test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ArtifactListPanel } from "../ArtifactListPanel";

const items = [
  { id: "b-1", name: "U.S. House · WI-04 · 2026", savedAt: "2026-06-10T12:00:00Z", kindLabel: "Brief" },
  { id: "b-2", name: "U.S. House · ND-00 · 2026", savedAt: "2026-06-09T12:00:00Z", kindLabel: "Brief" },
];

test("lists artifacts as cards with name and kind, click opens", () => {
  const onOpen = vi.fn();
  render(<ArtifactListPanel items={items} onOpen={onOpen} />);
  expect(screen.getByText("Artifacts")).toBeInTheDocument();
  expect(screen.getByText("U.S. House · WI-04 · 2026")).toBeInTheDocument();
  expect(screen.getAllByText(/Brief ·/)).toHaveLength(2);
  fireEvent.click(screen.getByText("U.S. House · ND-00 · 2026"));
  expect(onOpen).toHaveBeenCalledWith("b-2");
});

test("shows the count and renders children (persona explore surface) beneath", () => {
  render(
    <ArtifactListPanel items={items} onOpen={vi.fn()}>
      <p>explore surface</p>
    </ArtifactListPanel>,
  );
  expect(screen.getByText("2")).toBeInTheDocument();
  expect(screen.getByText("explore surface")).toBeInTheDocument();
});

test("C6: caps at 8 cards with a Show all expander", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    id: `b-${i}`,
    name: `Brief ${i}`,
    kindLabel: "Brief",
  }));
  render(<ArtifactListPanel items={many} onOpen={vi.fn()} />);
  expect(screen.getByText("Brief 7")).toBeInTheDocument();
  expect(screen.queryByText("Brief 8")).not.toBeInTheDocument();
  expect(screen.getByText("12")).toBeInTheDocument(); // count badge shows the real total
  fireEvent.click(screen.getByRole("button", { name: "Show all (12)" }));
  expect(screen.getByText("Brief 11")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
});

test("no Show all expander at 8 items or fewer", () => {
  render(<ArtifactListPanel items={items} onOpen={vi.fn()} />);
  expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
});

test("empty list hides the list chrome but keeps children", () => {
  render(
    <ArtifactListPanel items={[]} onOpen={vi.fn()}>
      <p>explore surface</p>
    </ArtifactListPanel>,
  );
  expect(screen.queryByText("Artifacts")).not.toBeInTheDocument();
  expect(screen.getByText("explore surface")).toBeInTheDocument();
});
