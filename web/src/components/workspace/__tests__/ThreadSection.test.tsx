import { test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThreadSection } from "../ThreadSection";
import type { ThreadSummary } from "@/lib/threads/schema";

const threads: ThreadSummary[] = [
  { threadId: "t-1", title: "Investigation · ND", raceKeys: [], briefCount: 0, updatedAt: "2026-06-10T12:00:00Z" },
  { threadId: "t-2", title: "WI-04 follow-ups", raceKeys: ["2026-H-WI-04"], briefCount: 3, updatedAt: "2026-06-09T12:00:00Z" },
];

function renderSection(over: Partial<Parameters<typeof ThreadSection>[0]> = {}) {
  const handlers = {
    onNew: vi.fn(),
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onSaveNotes: vi.fn(),
  };
  render(
    <ThreadSection
      threads={threads}
      activeThreadId={null}
      notes=""
      {...handlers}
      {...over}
    />,
  );
  return handlers;
}

test("lists threads and fires onNew", () => {
  const h = renderSection();
  expect(screen.getByText("Investigation · ND")).toBeInTheDocument();
  expect(screen.getByText("WI-04 follow-ups")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /new thread/i }));
  expect(h.onNew).toHaveBeenCalled();
});

test("empty state explains what threads are", () => {
  renderSection({ threads: [] });
  expect(
    screen.getByText(/threads keep a conversation and its briefs together/i),
  ).toBeInTheDocument();
});
