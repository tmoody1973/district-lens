"use client";

import { ThreadItem } from "./ThreadItem";
import type { ThreadSummary } from "@/lib/threads/schema";

/**
 * The threads list for the library sidebar — both personas, signed-in only
 * (the caller wraps in Clerk's `<Show when="signed-in">`). "+ New thread"
 * creates a clean session: empty chat, empty artifact panel; the conversation
 * and its briefs then accumulate on the thread.
 */
export function ThreadSection({
  threads,
  activeThreadId,
  notes = "",
  onNew,
  onOpen,
  onRename,
  onDelete,
  onSaveNotes,
}: {
  threads: ThreadSummary[];
  activeThreadId: string | null;
  /** Notes of the ACTIVE thread (only the active row shows the disclosure). */
  notes?: string;
  onNew: () => void;
  onOpen: (threadId: string) => void;
  onRename: (threadId: string, title: string) => void;
  onDelete: (threadId: string) => void;
  onSaveNotes?: (threadId: string, notes: string) => void;
}) {
  return (
    <div className="border-b border-edge px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase text-zinc-500">Threads</p>
        <button
          type="button"
          aria-label="New thread"
          onClick={onNew}
          className="rounded-md border border-edge-strong px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
        >
          + New
        </button>
      </div>
      {threads.length === 0 ? (
        <p className="py-1 text-[11px] text-zinc-600">
          Threads keep a conversation and its briefs together.
        </p>
      ) : (
        <div className="space-y-0.5">
          {threads.map((t) => (
            <ThreadItem
              key={t.threadId}
              thread={t}
              active={t.threadId === activeThreadId}
              notes={t.threadId === activeThreadId ? notes : ""}
              onOpen={onOpen}
              onRename={onRename}
              onDelete={onDelete}
              onSaveNotes={onSaveNotes}
            />
          ))}
        </div>
      )}
    </div>
  );
}
