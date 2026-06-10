import { test, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// Clerk can't run in jsdom — substitute auth-state-aware stand-ins. The
// signedIn flag flips per test via setSignedIn.
let signedIn = false;
const setSignedIn = (v: boolean) => {
  signedIn = v;
};
vi.mock("@clerk/nextjs", () => ({
  Show: ({
    children,
    fallback,
  }: {
    children?: React.ReactNode;
    fallback?: React.ReactNode;
    when?: string;
  }) => <>{signedIn ? children : fallback ?? null}</>,
  SignInButton: ({ children }: { children?: React.ReactNode }) => (
    <span data-testid="sign-in-button">{children}</span>
  ),
  UserButton: () => <span data-testid="user-button" />,
}));

import { WorkspaceLayoutProvider } from "../WorkspaceLayoutContext";
import { LibrarySidebar } from "../LibrarySidebar";
import { LAYOUT_STORAGE_KEY } from "@/lib/workspace/layout";

beforeEach(() => {
  window.localStorage.clear();
  setSignedIn(false);
});

function renderSidebar(children?: React.ReactNode, onNewChat = () => {}) {
  return render(
    <WorkspaceLayoutProvider>
      <LibrarySidebar onNewChat={onNewChat}>{children}</LibrarySidebar>
    </WorkspaceLayoutProvider>,
  );
}

test("renders the expanded sidebar with brand — no persona switch (U1)", () => {
  renderSidebar(<p>section content</p>);
  expect(screen.getByText("DistrictLens")).toBeInTheDocument();
  expect(screen.queryByRole("radiogroup", { name: "Persona" })).not.toBeInTheDocument();
  expect(screen.getByText("section content")).toBeInTheDocument();
});

test("New chat is pinned at the top and fires onNewChat", () => {
  const onNewChat = vi.fn();
  renderSidebar(null, onNewChat);
  fireEvent.click(screen.getByRole("button", { name: /new chat/i }));
  expect(onNewChat).toHaveBeenCalledTimes(1);
});

test("collapsed rail keeps a New chat icon button", () => {
  window.localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    JSON.stringify({ libraryCollapsed: true, chatCollapsed: false, chatPct: 32 }),
  );
  const onNewChat = vi.fn();
  renderSidebar(null, onNewChat);
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  expect(onNewChat).toHaveBeenCalledTimes(1);
});

test("signed out: footer offers Sign in (the workspace must have an auth entry)", () => {
  renderSidebar();
  expect(screen.getByTestId("sign-in-button")).toBeInTheDocument();
  expect(screen.queryByTestId("user-button")).not.toBeInTheDocument();
});

test("signed in: footer shows the profile button", () => {
  setSignedIn(true);
  renderSidebar();
  expect(screen.getByTestId("user-button")).toBeInTheDocument();
  expect(screen.queryByTestId("sign-in-button")).not.toBeInTheDocument();
});

test("collapsed rail still surfaces the auth affordance", () => {
  window.localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    JSON.stringify({ libraryCollapsed: true, chatCollapsed: false, chatPct: 32 }),
  );
  renderSidebar();
  expect(screen.getByTestId("sign-in-button")).toBeInTheDocument();
});

test("stored collapsed layout renders the icon rail", () => {
  window.localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    JSON.stringify({ libraryCollapsed: true, chatCollapsed: false, chatPct: 32 }),
  );
  renderSidebar(<p>section content</p>);
  expect(screen.queryByText("section content")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Expand library" })).toBeInTheDocument();
});

test("collapse and expand round-trip", () => {
  renderSidebar();
  fireEvent.click(screen.getByRole("button", { name: "Collapse library" }));
  fireEvent.click(screen.getByRole("button", { name: "Expand library" }));
  expect(screen.getByText("DistrictLens")).toBeInTheDocument();
});
