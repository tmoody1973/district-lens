// web/src/lib/workspace/useThreads.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCopilotChat, useCopilotMessagesContext } from "@copilotkit/react-core";
import { saveBriefSnapshot } from "@/lib/artifacts/sync";
import type { AgentThreadDoc, ThreadSummary } from "@/lib/threads/schema";
import type { SavedBriefDoc } from "@/lib/saved-briefs/schema";
import type { DistrictLensState } from "@/types/agent-state";

export interface UseThreadsArgs {
  agentState: DistrictLensState;
  /** Restores a saved brief into the artifact panel (replaces setOpenedBrief). */
  onRestoreBrief: (state: DistrictLensState) => void;
  /** Clears all displayed-brief state on thread switch. */
  onClearBrief: () => void;
  /** Refresh My Ballot after an auto-capture lands. */
  onBallotChanged?: () => void;
}

export function useThreads({
  agentState,
  onRestoreBrief,
  onClearBrief,
  onBallotChanged,
}: UseThreadsArgs) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThread, setActiveThread] = useState<{
    thread: AgentThreadDoc;
    briefs: SavedBriefDoc[];
  } | null>(null);
  const { visibleMessages } = useCopilotChat();
  const { setMessages } = useCopilotMessagesContext();
  const lastSavedTranscriptRef = useRef<string>("");
  // Tracks the raceKey:threadId pair already auto-saved this run so we don't
  // double-capture the same brief if stage stays "complete" across renders.
  const autoSavedRef = useRef<string | null>(null);
  // Tracks the last requested threadId so stale async fetches don't clobber.
  const openThreadIdRef = useRef<string | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/threads");
      if (!res.ok) { setThreads([]); return; }
      const data = await res.json();
      setThreads(data.threads ?? []);
    } catch {
      setThreads([]);
    }
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  const openThread = useCallback(async (threadId: string) => {
    openThreadIdRef.current = threadId;
    try {
      const res = await fetch(`/api/threads/${threadId}`);
      if (!res.ok) return;
      // Stale-write guard: bail if user switched to a different thread while
      // this fetch was in flight.
      if (openThreadIdRef.current !== threadId) return;
      const data = await res.json();
      setActiveThread({ thread: data.thread, briefs: data.briefs ?? [] });
      // Restore chat synchronously from the already-loaded thread doc — no
      // second round-trip needed. We do NOT call setThreadId(): switching
      // CopilotKit's thread flips it into explicit-threadId mode, which makes
      // it reconnect the agent and reset coagent state (mode → voter) on every
      // thread open. ADK is stateless and we own message history here, so the
      // runtime threadId is not load-bearing.
      setMessages(data.thread?.messages ?? []);
    } catch {
      /* ignore */
    }
  }, [setMessages]);

  // Auto-capture: when a brief completes and a thread is open, silently file
  // it as an artifact. Dedup via autoSavedRef prevents re-saving the same
  // raceKey+threadId pair if stage stays "complete" across renders.
  useEffect(() => {
    if (agentState.stage !== "complete") return;
    if (!agentState.currentRaceKey || !activeThread) return;
    const threadId = activeThread.thread.thread_id;
    const dedupKey = `${agentState.currentRaceKey}:${threadId}`;
    if (autoSavedRef.current === dedupKey) return;
    autoSavedRef.current = dedupKey;
    const state = agentState;
    saveBriefSnapshot(state, threadId, fetch)
      .then(async (ok) => {
        if (!ok) return;
        onBallotChanged?.();
        loadThreads();
        // Refresh the active thread's briefs list without disturbing the live chat.
        // Calling openThread here would also reset messages, clobbering the conversation.
        try {
          const refresh = await fetch(`/api/threads/${threadId}`);
          if (refresh.ok) {
            const { briefs } = await refresh.json();
            setActiveThread((prev) =>
              prev && prev.thread.thread_id === threadId
                ? { ...prev, briefs: briefs ?? [] }
                : prev,
            );
          }
        } catch { /* ignore */ }
      })
      .catch(() => {});
    // agentState used in body but only stage/raceKey are reactive triggers;
    // dedup key prevents stale captures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentState.stage, agentState.currentRaceKey, activeThread?.thread.thread_id, onBallotChanged, loadThreads]);

  const createThread = useCallback(async () => {
    try {
      const seed = agentState.currentRaceKey ? { raceKey: agentState.currentRaceKey } : {};
      const res = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(seed),
      });
      if (!res.ok) return;
      const data = await res.json();
      // Open via the GET path so the active thread has the same clean shape as
      // every other opened thread (projected, defaults applied).
      await Promise.all([
        loadThreads(),
        ...(data.thread?.thread_id ? [openThread(data.thread.thread_id)] : []),
      ]);
    } catch {
      /* ignore */
    }
  }, [agentState.currentRaceKey, loadThreads, openThread]);

  const renameThread = useCallback(async (threadId: string, title: string) => {
    await fetch(`/api/threads/${threadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    await loadThreads();
    setActiveThread((prev) =>
      prev && prev.thread.thread_id === threadId
        ? { ...prev, thread: { ...prev.thread, title } }
        : prev,
    );
  }, [loadThreads]);

  const saveThreadNotes = useCallback(async (threadId: string, notes: string) => {
    await fetch(`/api/threads/${threadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    setActiveThread((prev) =>
      prev && prev.thread.thread_id === threadId
        ? { ...prev, thread: { ...prev.thread, notes } }
        : prev,
    );
  }, []);

  const deleteThread = useCallback(async (threadId: string) => {
    await fetch(`/api/threads/${threadId}`, { method: "DELETE" });
    setActiveThread((prev) => (prev && prev.thread.thread_id === threadId ? null : prev));
    await loadThreads();
  }, [loadThreads]);

  const closeThread = useCallback(() => setActiveThread(null), []);

  // While a thread is open, capture the chat conversation onto it as a read-only
  // transcript (debounced). The flatMap + JSON.stringify run inside the 1200ms
  // timer so they don't run on every streaming tick — only when the stream
  // settles. Sig-dedupe against lastSavedTranscriptRef prevents redundant PATCHes.
  const activeThreadId = activeThread?.thread.thread_id ?? null;
  const visibleMessagesRef = useRef(visibleMessages);
  visibleMessagesRef.current = visibleMessages;
  useEffect(() => {
    if (!activeThreadId) return;
    const timer = setTimeout(() => {
      const transcript = (visibleMessagesRef.current ?? []).flatMap((m) => {
        const role = (m as { role?: unknown }).role;
        const content = (m as { content?: unknown }).content;
        return typeof content === "string" && (role === "user" || role === "assistant")
          ? [{ role, content }]
          : [];
      });
      if (transcript.length === 0) return;
      const sig = activeThreadId + JSON.stringify(transcript);
      if (sig === lastSavedTranscriptRef.current) return;
      lastSavedTranscriptRef.current = sig;
      fetch(`/api/threads/${activeThreadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: transcript }),
      })
        .then(() =>
          setActiveThread((prev) =>
            prev && prev.thread.thread_id === activeThreadId
              ? { ...prev, thread: { ...prev.thread, messages: transcript } }
              : prev,
          ),
        )
        .catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [visibleMessages, activeThreadId]);

  // Reopen a saved snapshot into the artifact panel.
  const openSavedBrief = useCallback(async (briefId: string) => {
    try {
      const res = await fetch(`/api/saved/brief/${briefId}`);
      if (!res.ok) return;
      const { brief } = await res.json();
      onRestoreBrief(brief.answer_snapshot as DistrictLensState);
    } catch {
      /* ignore — reopening is best-effort */
    }
  }, [onRestoreBrief]);

  // On thread switch: wipe ALL state that feeds the artifact panel and chat,
  // then restore the new thread's brief if it has one.
  useEffect(() => {
    setMessages([]);
    onClearBrief();
    autoSavedRef.current = null; // reset dedup so new thread can auto-capture
    if (activeThread && activeThread.briefs.length > 0) {
      openSavedBrief(activeThread.briefs[0].brief_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.thread.thread_id]);

  return {
    threads,
    activeThread,
    loadThreads,
    openThread,
    closeThread,
    createThread,
    renameThread,
    saveThreadNotes,
    deleteThread,
    openSavedBrief,
  };
}
