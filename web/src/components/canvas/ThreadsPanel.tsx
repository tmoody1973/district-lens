"use client";

import { useEffect, useState } from "react";

import type { AgentThreadDoc, ThreadSummary } from "@/lib/threads/schema";
import type { SavedBriefDoc } from "@/lib/saved-briefs/schema";

interface ThreadsPanelProps {
  threads: ThreadSummary[];
  active: { thread: AgentThreadDoc; briefs: SavedBriefDoc[] } | null;
  onNew: () => void;
  onOpen: (threadId: string) => void;
  onClose: () => void;
  onRename: (threadId: string, title: string) => void;
  onSaveNotes: (threadId: string, notes: string) => void;
  onDelete: (threadId: string) => void;
  onReopenBrief: (briefId: string) => void;
}

// The detail that expands inline under the selected thread row.
function ThreadDetail({
  thread,
  briefs,
  onRename,
  onSaveNotes,
  onDelete,
  onReopenBrief,
}: {
  thread: AgentThreadDoc;
  briefs: SavedBriefDoc[];
  onRename: (threadId: string, title: string) => void;
  onSaveNotes: (threadId: string, notes: string) => void;
  onDelete: (threadId: string) => void;
  onReopenBrief: (briefId: string) => void;
}) {
  const [titleDraft, setTitleDraft] = useState(thread.title);
  const [notesDraft, setNotesDraft] = useState(thread.notes ?? "");
  // Threads created before these fields existed won't have them — default safely.
  const messages = thread.messages ?? [];

  // Re-sync drafts when the selected thread (or its persisted values) changes.
  useEffect(() => {
    setTitleDraft(thread.title);
    setNotesDraft(thread.notes ?? "");
  }, [thread.thread_id, thread.title, thread.notes]);

  return (
    <div className="mt-1 rounded-[2px] border border-edge bg-surface-raised p-2">
      <input
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={() => {
          const next = titleDraft.trim();
          if (next && next !== thread.title) onRename(thread.thread_id, next);
          else setTitleDraft(thread.title);
        }}
        className="mb-2 w-full rounded-[2px] border-2 border-edge px-2 py-1 text-xs font-semibold text-ink bg-surface-raised focus:border-edge-strong focus:outline-none placeholder:text-ink-faint"
      />
      <textarea
        value={notesDraft}
        onChange={(e) => setNotesDraft(e.target.value)}
        onBlur={() => {
          if (notesDraft !== thread.notes) onSaveNotes(thread.thread_id, notesDraft);
        }}
        placeholder="Notes / leads…"
        rows={3}
        className="mb-2 w-full resize-none rounded-[2px] border-2 border-edge px-2 py-1 text-[11px] text-ink-muted bg-surface-raised focus:border-edge-strong focus:outline-none placeholder:text-ink-faint"
      />
      <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-ink-faint">
        Artifacts ({briefs.length})
      </p>
      {briefs.length === 0 ? (
        <p className="text-[10px] text-ink-faint">Briefs auto-captured here when a race completes.</p>
      ) : (
        <ul className="space-y-1">
          {briefs.map((b) => {
            const mode = b.answer_snapshot?.mode ?? "voter";
            return (
              <li key={b.brief_id}>
                <button
                  onClick={() => onReopenBrief(b.brief_id)}
                  className="block w-full rounded-[2px] border border-edge bg-surface-raised px-2 py-1 text-left text-[11px] text-ink-muted hover:border-edge-strong hover:bg-surface-hover"
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={[
                        "shrink-0 rounded-[2px] px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide",
                        mode === "journalist"
                          ? "bg-ink text-surface"
                          : "bg-surface-hover text-ink-muted",
                      ].join(" ")}
                    >
                      {mode === "journalist" ? "press" : "voter"}
                    </span>
                    <span className="truncate">{b.race_key}</span>
                  </span>
                  <span className="block text-[9px] text-ink-faint mt-0.5">
                    {new Date(b.updated_at ?? b.created_at).toLocaleDateString()}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {messages.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-ink-faint">
            Conversation
          </p>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-[2px] border border-edge bg-surface-raised p-1.5">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                <span
                  className={[
                    "inline-block max-w-[90%] rounded-[2px] px-1.5 py-1 text-[10px]",
                    m.role === "user" ? "bg-ink text-surface" : "bg-surface-hover text-ink-muted",
                  ].join(" ")}
                >
                  {m.content}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <button
        onClick={() => onDelete(thread.thread_id)}
        className="mt-2 text-[9px] font-medium text-red-400 hover:text-red-300"
      >
        Delete thread
      </button>
    </div>
  );
}

export function ThreadsPanel({
  threads,
  active,
  onNew,
  onOpen,
  onClose,
  onRename,
  onSaveNotes,
  onDelete,
  onReopenBrief,
}: ThreadsPanelProps) {
  const activeId = active?.thread.thread_id ?? null;

  return (
    <div className="p-3 border-b border-edge">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[9px] font-bold uppercase tracking-widest text-ink-faint">Threads</p>
        <button
          onClick={onNew}
          className="rounded-[2px] border border-edge-strong px-1.5 py-0.5 text-[9px] font-semibold text-ink-muted hover:bg-surface-hover"
        >
          + New
        </button>
      </div>

      {threads.length === 0 ? (
        <p className="text-[10px] text-ink-faint">
          No threads yet. Start one to group your race briefs.
        </p>
      ) : (
        <ul className="space-y-1">
          {threads.map((t) => {
            const isActive = t.threadId === activeId;
            return (
              <li key={t.threadId}>
                <button
                  onClick={() => (isActive ? onClose() : onOpen(t.threadId))}
                  className={[
                    "block w-full rounded-[2px] border px-2 py-1.5 text-left transition-colors",
                    isActive
                      ? "border-edge-strong bg-surface-hover"
                      : "border-edge bg-surface-raised hover:border-edge-strong hover:bg-surface-hover",
                  ].join(" ")}
                >
                  <span className="block truncate text-xs font-semibold text-ink">
                    {t.title}
                  </span>
                  <span className="block text-[9px] text-ink-faint">
                    {t.briefCount} brief{t.briefCount === 1 ? "" : "s"} ·{" "}
                    {new Date(t.updatedAt).toLocaleDateString()}
                  </span>
                </button>
                {isActive && active && (
                  <ThreadDetail
                    key={active.thread.thread_id}
                    thread={active.thread}
                    briefs={active.briefs}
                    onRename={onRename}
                    onSaveNotes={onSaveNotes}
                    onDelete={onDelete}
                    onReopenBrief={onReopenBrief}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
