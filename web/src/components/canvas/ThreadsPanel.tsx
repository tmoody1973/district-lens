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
    <div className="mt-1 rounded-[2px] border border-slate-300 bg-slate-50 p-2">
      <input
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={() => {
          const next = titleDraft.trim();
          if (next && next !== thread.title) onRename(thread.thread_id, next);
          else setTitleDraft(thread.title);
        }}
        className="mb-2 w-full rounded-[2px] border-2 border-slate-200 px-2 py-1 text-xs font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
      />
      <textarea
        value={notesDraft}
        onChange={(e) => setNotesDraft(e.target.value)}
        onBlur={() => {
          if (notesDraft !== thread.notes) onSaveNotes(thread.thread_id, notesDraft);
        }}
        placeholder="Notes / leads…"
        rows={3}
        className="mb-2 w-full resize-none rounded-[2px] border-2 border-slate-200 px-2 py-1 text-[11px] text-slate-700 focus:border-slate-900 focus:outline-none"
      />
      <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">
        Briefs ({briefs.length})
      </p>
      {briefs.length === 0 ? (
        <p className="text-[10px] text-slate-400">Drill into a race and Save to file it here.</p>
      ) : (
        <ul className="space-y-1">
          {briefs.map((b) => (
            <li key={b.brief_id}>
              <button
                onClick={() => onReopenBrief(b.brief_id)}
                className="block w-full rounded-[2px] border border-slate-200 bg-white px-2 py-1 text-left text-[11px] text-slate-800 hover:border-slate-400"
              >
                {b.race_key}
                <span className="block text-[9px] text-slate-400">
                  {new Date(b.created_at).toLocaleDateString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {messages.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">
            Conversation
          </p>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-[2px] border border-slate-200 bg-white p-1.5">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                <span
                  className={[
                    "inline-block max-w-[90%] rounded-[2px] px-1.5 py-1 text-[10px]",
                    m.role === "user" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-800",
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
        className="mt-2 text-[9px] font-medium text-red-600 hover:text-red-800"
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
    <div className="p-3 border-b border-slate-200">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Threads</p>
        <button
          onClick={onNew}
          className="rounded-[2px] border border-slate-900 px-1.5 py-0.5 text-[9px] font-semibold text-slate-900 hover:bg-slate-100"
        >
          + New
        </button>
      </div>

      {threads.length === 0 ? (
        <p className="text-[10px] text-slate-400">
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
                      ? "border-slate-900 bg-slate-100"
                      : "border-slate-200 bg-white hover:border-slate-400",
                  ].join(" ")}
                >
                  <span className="block truncate text-xs font-semibold text-slate-900">
                    {t.title}
                  </span>
                  <span className="block text-[9px] text-slate-400">
                    {t.briefCount} brief{t.briefCount === 1 ? "" : "s"} ·{" "}
                    {new Date(t.updatedAt).toLocaleDateString()}
                  </span>
                </button>
                {isActive && active && (
                  <ThreadDetail
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
