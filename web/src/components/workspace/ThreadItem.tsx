"use client";

import { useEffect, useState } from "react";
import { fmtDate } from "@/lib/format";
import type { ThreadSummary } from "@/lib/threads/schema";

/**
 * One thread row — Claude-session idiom: the row is JUST a row (title, brief
 * count, date). Opening it swaps the main chat pane and artifact panel;
 * nothing (conversation, artifact lists) renders inline in the sidebar.
 * Rename and delete are hover actions; notes are a small disclosure that
 * only exists on the active row.
 */
export function ThreadItem({
  thread,
  active,
  notes = "",
  onOpen,
  onRename,
  onDelete,
  onSaveNotes,
}: {
  thread: ThreadSummary;
  active: boolean;
  notes?: string;
  onOpen: (threadId: string) => void;
  onRename: (threadId: string, title: string) => void;
  onDelete: (threadId: string) => void;
  onSaveNotes?: (threadId: string, notes: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(thread.title);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState(notes);

  // Re-sync drafts when the underlying thread changes (rename elsewhere,
  // switching threads re-using this row position, etc.).
  useEffect(() => setTitleDraft(thread.title), [thread.threadId, thread.title]);
  useEffect(() => setNotesDraft(notes), [thread.threadId, notes]);

  const commitRename = () => {
    setEditing(false);
    const next = titleDraft.trim();
    if (next && next !== thread.title) onRename(thread.threadId, next);
    else setTitleDraft(thread.title);
  };

  return (
    <div
      className={`group rounded-md px-2 py-1.5 transition-colors ${
        active ? "bg-zinc-800" : "hover:bg-zinc-900"
      }`}
    >
      <div className="flex items-center gap-1">
        {editing ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setTitleDraft(thread.title);
                setEditing(false);
              }
            }}
            className="min-w-0 flex-1 rounded border border-edge-strong bg-surface-raised px-1 py-0.5 text-sm text-ink focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => onOpen(thread.threadId)}
            className="min-w-0 flex-1 text-left"
          >
            <span
              className={`block truncate text-sm ${active ? "font-semibold text-white" : "text-zinc-400 group-hover:text-zinc-200"}`}
            >
              {thread.title}
            </span>
            <span className="block text-[10px] text-zinc-600">
              {thread.briefCount} brief{thread.briefCount === 1 ? "" : "s"} ·{" "}
              {fmtDate(thread.updatedAt)}
            </span>
          </button>
        )}
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            aria-label="Rename thread"
            onClick={() => setEditing(true)}
            className="rounded p-1 text-zinc-600 hover:text-zinc-200"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
          {active && onSaveNotes && (
            <button
              type="button"
              aria-label="Notes"
              aria-expanded={notesOpen}
              onClick={() => setNotesOpen((o) => !o)}
              className="rounded p-1 text-zinc-600 hover:text-zinc-200"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6M7 4h10a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2z"
                />
              </svg>
            </button>
          )}
          <button
            type="button"
            aria-label="Delete thread"
            onClick={() => onDelete(thread.threadId)}
            className="rounded p-1 text-zinc-600 hover:text-red-400"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </span>
      </div>
      {active && notesOpen && onSaveNotes && (
        <textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={() => {
            if (notesDraft !== notes) onSaveNotes(thread.threadId, notesDraft);
          }}
          placeholder="Notes / leads…"
          rows={3}
          className="mt-1.5 w-full resize-none rounded border border-edge bg-surface-raised px-2 py-1 text-[11px] text-ink-muted placeholder:text-ink-faint focus:border-edge-strong focus:outline-none"
        />
      )}
    </div>
  );
}
