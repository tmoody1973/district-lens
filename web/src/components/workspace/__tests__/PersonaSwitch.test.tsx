import { test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceLayoutProvider } from "../WorkspaceLayoutContext";
import { PersonaSwitch } from "../PersonaSwitch";

beforeEach(() => window.localStorage.clear());

function renderSwitch(onPersonaChange = vi.fn()) {
  render(
    <WorkspaceLayoutProvider initialPersona="voter">
      <PersonaSwitch onPersonaChange={onPersonaChange} />
    </WorkspaceLayoutProvider>,
  );
  return onPersonaChange;
}

test("renders both personas with the active one checked", () => {
  renderSwitch();
  expect(screen.getByRole("radio", { name: /voter/i })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("radio", { name: /journalist/i })).toHaveAttribute("aria-checked", "false");
});

test("clicking the other persona checks it and fires the callback", () => {
  const cb = renderSwitch();
  fireEvent.click(screen.getByRole("radio", { name: /journalist/i }));
  expect(screen.getByRole("radio", { name: /journalist/i })).toHaveAttribute("aria-checked", "true");
  expect(cb).toHaveBeenCalledWith("journalist");
});
