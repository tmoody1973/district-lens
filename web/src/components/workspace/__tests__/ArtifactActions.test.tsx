import { test, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ArtifactActions } from "../ArtifactActions";
import { DEFAULT_STATE, type DistrictLensState } from "@/types/agent-state";

const state: DistrictLensState = { ...DEFAULT_STATE, currentRaceKey: "2026-H-WI-04" };

test("copy button writes the brief markdown to the clipboard", async () => {
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  render(<ArtifactActions state={state} />);
  fireEvent.click(screen.getByRole("button", { name: /copy brief/i }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  expect(writeText.mock.calls[0][0]).toContain("2026-H-WI-04");
});

test("share button copies the per-race permalink", async () => {
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  render(<ArtifactActions state={state} />);
  fireEvent.click(screen.getByRole("button", { name: /share/i }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  expect(writeText.mock.calls[0][0]).toContain("/w?race=2026-H-WI-04");
});

test("export button is present for download", () => {
  render(<ArtifactActions state={state} />);
  expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
});

test("renders nothing without a race key", () => {
  const { container } = render(<ArtifactActions state={{ ...DEFAULT_STATE }} />);
  expect(container).toBeEmptyDOMElement();
});
