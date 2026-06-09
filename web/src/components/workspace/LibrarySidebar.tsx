"use client";

import type { ReactNode } from "react";
import { useWorkspaceLayout } from "./WorkspaceLayoutContext";
import { PersonaSwitch } from "./PersonaSwitch";
import type { Persona } from "@/lib/workspace/layout";

export function LibrarySidebar({
  children,
  onPersonaChange,
}: {
  children?: ReactNode;
  onPersonaChange?: (persona: Persona) => void;
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
      <div className="border-b border-zinc-800 px-3 py-2">
        <PersonaSwitch onPersonaChange={onPersonaChange} />
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
    </aside>
  );
}
