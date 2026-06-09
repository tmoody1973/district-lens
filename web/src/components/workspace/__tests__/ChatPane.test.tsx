import { test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@copilotkit/react-ui", () => ({
  CopilotChat: () => <div data-testid="copilot-chat" />,
}));

import { WorkspaceLayoutProvider } from "../WorkspaceLayoutContext";
import { ChatPane } from "../ChatPane";

beforeEach(() => window.localStorage.clear());

function renderPane(initialPersona: "voter" | "journalist" = "voter", statusMessage: string | null = null) {
  render(
    <WorkspaceLayoutProvider initialPersona={initialPersona}>
      <ChatPane statusMessage={statusMessage} />
    </WorkspaceLayoutProvider>,
  );
}

test("expanded pane renders the CopilotKit chat", () => {
  renderPane();
  expect(screen.getByTestId("copilot-chat")).toBeInTheDocument();
});

test("collapsing docks the chat to a strip that keeps the agent status visible", () => {
  renderPane("voter", "Searching FEC filings…");
  fireEvent.click(screen.getByRole("button", { name: "Collapse chat" }));
  expect(screen.queryByTestId("copilot-chat")).not.toBeInTheDocument();
  expect(screen.getByText("Searching FEC filings…")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Expand chat" }));
  expect(screen.getByTestId("copilot-chat")).toBeInTheDocument();
});
