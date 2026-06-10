import { test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ArtifactChip } from "../ArtifactChip";

test("shows the brief title with kind label and opens on click", () => {
  const onOpen = vi.fn();
  render(<ArtifactChip title="U.S. House · WI-04 · 2026" onOpen={onOpen} />);
  expect(screen.getByText("U.S. House · WI-04 · 2026")).toBeInTheDocument();
  expect(screen.getByText(/Brief/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button"));
  expect(onOpen).toHaveBeenCalledTimes(1);
});
