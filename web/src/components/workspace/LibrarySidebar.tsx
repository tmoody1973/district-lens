"use client";

import type { ReactNode } from "react";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { useWorkspaceLayout } from "./WorkspaceLayoutContext";

/**
 * Claude-anatomy sidebar: "+ New chat" pinned at the top, sections (threads,
 * ballot) in the middle, auth anchored at the bottom — the workspace itself
 * must always offer a way into (and out of) an account.
 */
export function LibrarySidebar({
  children,
  onNewChat,
}: {
  children?: ReactNode;
  onNewChat?: () => void;
}) {
  const { layout, toggleLibrary } = useWorkspaceLayout();

  if (layout.libraryCollapsed) {
    return (
      <aside
        aria-label="Library"
        className="hidden h-full w-12 shrink-0 flex-col items-center border-r border-zinc-800 bg-zinc-950 py-3 lg:flex"
      >
        <button
          type="button"
          onClick={toggleLibrary}
          aria-label="Expand library"
          className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onNewChat}
          aria-label="New chat"
          className="mt-2 rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
        <div className="mt-auto flex w-full flex-col items-center">
          <Show
            when="signed-in"
            fallback={
              <SignInButton mode="modal">
                <button
                  type="button"
                  aria-label="Sign in"
                  className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </button>
              </SignInButton>
            }
          >
            <UserButton />
          </Show>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Library"
      className="hidden h-full w-[260px] shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 lg:flex"
    >
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2.5">
        <span className="text-sm font-bold tracking-tight text-zinc-100">DistrictLens</span>
        <button
          type="button"
          onClick={toggleLibrary}
          aria-label="Collapse library"
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>
      <div className="shrink-0 px-3 pt-3">
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
        >
          <span aria-hidden className="text-zinc-400">+</span> New chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden pt-2">{children}</div>
      <div className="shrink-0 border-t border-zinc-800 px-3 py-3">
        <Show
          when="signed-in"
          fallback={
            <SignInButton mode="modal">
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
              >
                Sign in
              </button>
            </SignInButton>
          }
        >
          <UserButton
            showName
            appearance={{
              elements: {
                userButtonBox: "flex-row-reverse",
                userButtonOuterIdentifier: "text-xs text-zinc-300",
              },
            }}
          />
        </Show>
      </div>
    </aside>
  );
}
