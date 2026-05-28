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
  const [titleDraft, setTitleDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");

  useEffect(() => {
    setTitleDraft(active?.thread.title ?? "");
    setNotesDraft(active?.thread.notes ?? "");
  }, [active?.thread.thread_id, active?.thread.title, active?.thread.notes]);

  if (active) {
    const { thread, briefs } = active;
    return (
      <div className="p-3 border-b border-slate-200">
        <button
          onClick={onClose}
          className="mb-2 text-[9px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-700"
        >
          ‹ Threads
        </button>
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
          <p className="text-[10px] text-slate-400">
            Drill into a race and Save to file it here.
          </p>
        ) : (
          <ul className="space-y-1">
            {briefs.map((b) => (
              <li key={b.brief_id}>
                <button
                  onClick={() => onReopenBrief(b.brief_id)}
                  className="block w-full rounded-[2px] border border-slate-200 px-2 py-1 text-left text-[11px] text-slate-800 hover:border-slate-400"
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
        <button
          onClick={() => onDelete(thread.thread_id)}
          className="mt-2 text-[9px] font-medium text-red-600 hover:text-red-800"
        >
          Delete thread
        </button>
      </div>
    );
  }

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
        <p className="text-[10px] text-slate-400">No threads yet. Start one to group your race briefs.</p>
      ) : (
        <ul className="space-y-1">
          {threads.map((t) => (
            <li key={t.threadId}>
              <button
                onClick={() => onOpen(t.threadId)}
                className="block w-full rounded-[2px] border border-slate-200 bg-white px-2 py-1.5 text-left hover:border-slate-400"
              >
                <span className="block truncate text-xs font-semibold text-slate-900">{t.title}</span>
                <span className="block text-[9px] text-slate-400">
                  {t.briefCount} brief{t.briefCount === 1 ? "" : "s"} ·{" "}
                  {new Date(t.updatedAt).toLocaleDateString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
