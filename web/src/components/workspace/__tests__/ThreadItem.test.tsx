import { test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThreadItem } from "../ThreadItem";
import type { ThreadSummary } from "@/lib/threads/schema";

const thread: ThreadSummary = {
  threadId: "t-1",
  title: "Investigation · ND",
  raceKeys: ["2026-S-ND-00"],
  briefCount: 2,
  updatedAt: "2026-06-10T12:00:00Z",
};

function renderItem(over: Partial<Parameters<typeof ThreadItem>[0]> = {}) {
  const handlers = {
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onSaveNotes: vi.fn(),
  };
  render(
    <ThreadItem
      thread={thread}
      active={false}
      notes=""
      {...handlers}
      {...over}
    />,
  );
  return handlers;
}

test("renders title, brief count and date; click opens", () => {
  const h = renderItem();
  expect(screen.getByText("Investigation · ND")).toBeInTheDocument();
  expect(screen.getByText(/2 briefs/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Investigation · ND"));
  expect(h.onOpen).toHaveBeenCalledWith("t-1");
});

test("active row is visually marked and shows no inline conversation", () => {
  renderItem({ active: true });
  const row = screen.getByText("Investigation · ND").closest("div[class*='rounded']");
  expect(row?.className).toContain("bg-zinc-800");
  // The old panel rendered a CONVERSATION block inline — the new row never does.
  expect(screen.queryByText(/conversation/i)).not.toBeInTheDocument();
});

test("rename: pencil swaps to input, Enter commits", () => {
  const h = renderItem({ active: true });
  fireEvent.click(screen.getByRole("button", { name: /rename thread/i }));
  const input = screen.getByDisplayValue("Investigation · ND");
  fireEvent.change(input, { target: { value: "ND deep dive" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(h.onRename).toHaveBeenCalledWith("t-1", "ND deep dive");
});

test("delete fires from hover action", () => {
  const h = renderItem();
  fireEvent.click(screen.getByRole("button", { name: /delete thread/i }));
  expect(h.onDelete).toHaveBeenCalledWith("t-1");
});

test("notes: collapsed by default on active row, toggle reveals textarea, blur saves", () => {
  const h = renderItem({ active: true, notes: "lead: county clerk" });
  expect(screen.queryByPlaceholderText(/notes/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /notes/i }));
  const area = screen.getByDisplayValue("lead: county clerk");
  fireEvent.change(area, { target: { value: "lead: county clerk; FEC filing" } });
  fireEvent.blur(area);
  expect(h.onSaveNotes).toHaveBeenCalledWith("t-1", "lead: county clerk; FEC filing");
});
