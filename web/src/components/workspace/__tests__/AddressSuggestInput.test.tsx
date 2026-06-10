import { test, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AddressSuggestInput } from "@/components/workspace/AddressSuggestInput";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stubSuggest(suggestions: string[]) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ suggestions }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

test("submits the typed address", () => {
  stubSuggest([]);
  const onSubmit = vi.fn();
  render(<AddressSuggestInput onSubmit={onSubmit} />);
  const input = screen.getByLabelText("Street address or ZIP code");
  fireEvent.change(input, { target: { value: "53202" } });
  fireEvent.submit(input.closest("form")!);
  expect(onSubmit).toHaveBeenCalledWith("53202");
});

test("empty input never submits", () => {
  stubSuggest([]);
  const onSubmit = vi.fn();
  render(<AddressSuggestInput onSubmit={onSubmit} />);
  fireEvent.submit(screen.getByLabelText("Street address or ZIP code").closest("form")!);
  expect(onSubmit).not.toHaveBeenCalled();
});

test("fetches debounced suggestions for 5+ characters and shows them", async () => {
  vi.useFakeTimers();
  const fetchMock = stubSuggest(["123 N Water St, Milwaukee, WI 53202"]);
  render(<AddressSuggestInput onSubmit={() => {}} />);
  const input = screen.getByLabelText("Street address or ZIP code");
  fireEvent.change(input, { target: { value: "123 N Water" } });
  await act(async () => {
    vi.advanceTimersByTime(350);
  });
  expect(fetchMock).toHaveBeenCalledWith(
    `/api/district/suggest?q=${encodeURIComponent("123 N Water")}`,
  );
  expect(screen.getByText("123 N Water St, Milwaukee, WI 53202")).toBeDefined();
});

test("short input does not fetch suggestions", async () => {
  vi.useFakeTimers();
  const fetchMock = stubSuggest([]);
  render(<AddressSuggestInput onSubmit={() => {}} />);
  fireEvent.change(screen.getByLabelText("Street address or ZIP code"), {
    target: { value: "532" },
  });
  await act(async () => {
    vi.advanceTimersByTime(350);
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("clicking a suggestion submits it", async () => {
  vi.useFakeTimers();
  stubSuggest(["500 W Main St, Madison, WI 53703"]);
  const onSubmit = vi.fn();
  render(<AddressSuggestInput onSubmit={onSubmit} />);
  fireEvent.change(screen.getByLabelText("Street address or ZIP code"), {
    target: { value: "500 W Main" },
  });
  await act(async () => {
    vi.advanceTimersByTime(350);
  });
  fireEvent.mouseDown(screen.getByText("500 W Main St, Madison, WI 53703"));
  expect(onSubmit).toHaveBeenCalledWith("500 W Main St, Madison, WI 53703");
});

test("custom button label renders", () => {
  stubSuggest([]);
  render(<AddressSuggestInput onSubmit={() => {}} buttonLabel="Build brief" />);
  expect(screen.getByRole("button", { name: "Build brief" })).toBeDefined();
});
