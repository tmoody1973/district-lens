import { test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LibraryItem } from "../LibraryItem";
import type { ArtifactRecord } from "@/lib/artifacts/types";

const artifact: ArtifactRecord = {
  artifactId: "art-1",
  type: "brief",
  name: "U.S. House · WI-04 · 2026",
  raceKey: "2026-H-WI-04",
  createdAt: "2026-06-09T12:00:00Z",
  updatedAt: "2026-06-09T12:00:00Z",
  versions: [],
};

test("shows name and saved date, fires onOpen", () => {
  const onOpen = vi.fn();
  render(<LibraryItem artifact={artifact} active={false} onOpen={onOpen} onDelete={vi.fn()} />);
  const buttons = screen.getAllByRole("button");
  fireEvent.click(buttons[0]); // First button is the open button
  expect(onOpen).toHaveBeenCalledWith("art-1");
});

test("active item is visually marked", () => {
  render(<LibraryItem artifact={artifact} active onOpen={vi.fn()} onDelete={vi.fn()} />);
  const buttons = screen.getAllByRole("button");
  expect(buttons[0].className).toContain("bg-zinc-800");
});

test("version count chip appears when there is more than one version", () => {
  const versioned = {
    ...artifact,
    versions: [
      { versionId: "v1", savedAt: "2026-06-01T00:00:00Z", snapshot: {} as never, fingerprint: {} as never, sourceRefs: [] },
      { versionId: "v2", savedAt: "2026-06-09T00:00:00Z", snapshot: {} as never, fingerprint: {} as never, sourceRefs: [] },
    ],
  };
  render(<LibraryItem artifact={versioned} active={false} onOpen={vi.fn()} onDelete={vi.fn()} />);
  expect(screen.getByText("v2")).toBeInTheDocument();
});
