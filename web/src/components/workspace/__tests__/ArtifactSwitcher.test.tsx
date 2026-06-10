import { test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ArtifactSwitcher } from "../ArtifactSwitcher";

const items = [
  { id: "b-1", name: "U.S. House · WI-04", savedAt: "2026-06-10T12:00:00Z" },
  { id: "b-2", name: "U.S. Senate · ND", savedAt: "2026-06-09T12:00:00Z" },
];

test("renders a plain title when there is nothing to switch to", () => {
  render(<ArtifactSwitcher title="No artifact open" items={[]} onSelect={vi.fn()} />);
  expect(screen.getByText("No artifact open")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /switch artifact/i })).not.toBeInTheDocument();
});

test("opens the dropdown and selects an artifact", () => {
  const onSelect = vi.fn();
  render(<ArtifactSwitcher title="U.S. House · WI-04" items={items} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole("button", { name: /switch artifact/i }));
  fireEvent.click(screen.getByText("U.S. Senate · ND"));
  expect(onSelect).toHaveBeenCalledWith("b-2");
});

test("shows the item count on the trigger", () => {
  render(<ArtifactSwitcher title="U.S. House · WI-04" items={items} onSelect={vi.fn()} />);
  expect(screen.getByText("2")).toBeInTheDocument();
});
