"use client";

import type { ReactNode } from "react";
import { fmtDate } from "@/lib/format";

export interface ArtifactListItem {
  id: string;
  name: string;
  savedAt?: string;
  /** e.g. "Brief" — shown as "Brief · Jun 10" under the name. */
  kindLabel?: string;
}

/**
 * The artifact rail's REST state — Claude-style: a list of this session's
 * artifacts as compact cards. Clicking one focuses it in the panel; the
 * persona's explore surface (address entry / state map) renders beneath as
 * children. A build in progress replaces this view entirely (the caller
 * switches to the live draft), and a completed build auto-focuses the new
 * artifact — the conversation drives the panel.
 */
export function ArtifactListPanel({
  items,
  onOpen,
  children,
}: {
  items: ArtifactListItem[];
  onOpen: (id: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto">
      {items.length > 0 && (
        <div className="shrink-0 px-4 pt-4">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-200">Artifacts</h2>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
              {items.length}
            </span>
          </div>
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpen(item.id)}
                  className="flex w-full items-center gap-3 rounded-lg border border-edge bg-surface-raised px-3 py-2.5 text-left transition-colors hover:border-edge-strong hover:bg-surface-hover"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-500">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.8}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-zinc-200">
                      {item.name}
                    </span>
                    <span className="block text-[11px] text-zinc-500">
                      {item.kindLabel ?? "Brief"}
                      {item.savedAt ? ` · ${fmtDate(item.savedAt)}` : ""}
                    </span>
                  </span>
                  <svg
                    className="h-3.5 w-3.5 shrink-0 text-zinc-600"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
