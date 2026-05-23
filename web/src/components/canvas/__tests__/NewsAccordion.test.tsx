import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { NewsAccordion } from "../NewsAccordion";

afterEach(() => {
  vi.restoreAllMocks();
});

test("does not fetch news on mount (lazy)", () => {
  const fetchSpy = vi.spyOn(global, "fetch");
  render(<NewsAccordion candidateName="Gwen Moore" />);
  expect(screen.getByText(/Recent news · Gwen Moore/)).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("fetches once on first expand and renders the returned sources", async () => {
  const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        answer: "summary",
        sources: [
          { title: "Local coverage", url: "https://news.example/1", date: "2026-05-20", snippet: "snip" },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );

  render(<NewsAccordion candidateName="Gwen Moore" />);
  const details = screen.getByText(/Recent news · Gwen Moore/).closest("details") as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event("toggle"));

  await waitFor(() => expect(screen.getByText("Local coverage")).toBeInTheDocument());
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy).toHaveBeenCalledWith(
    "/api/search/news",
    expect.objectContaining({ method: "POST" })
  );
});
