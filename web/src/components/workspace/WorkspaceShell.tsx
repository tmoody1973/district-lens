"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { clampChatPct } from "@/lib/workspace/layout";
import { useWorkspaceLayout } from "./WorkspaceLayoutContext";

/**
 * Three-pane frame: Library · Chat · Artifact, with a draggable divider
 * between chat and artifact (Crate resizable-split pattern). Pane state
 * lives in WorkspaceLayoutContext and persists to localStorage.
 */
export function WorkspaceShell({
  library,
  chat,
  artifact,
}: {
  library: ReactNode;
  chat: ReactNode;
  artifact: ReactNode;
}) {
  const { layout, setChatPct } = useWorkspaceLayout();
  const splitRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  // Live width during a drag; committed to context (and localStorage) once on mouseup.
  const [liveChatPct, setLiveChatPct] = useState<number | null>(null);
  const liveChatPctRef = useRef<number | null>(null);

  const startDrag = useCallback(() => {
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      if (!isDragging.current || !splitRef.current) return;
      const rect = splitRef.current.getBoundingClientRect();
      if (rect.width === 0) return;
      const pct = ((event.clientX - rect.left) / rect.width) * 100;
      const clamped = clampChatPct(pct);
      liveChatPctRef.current = clamped;
      setLiveChatPct(clamped); // visual feedback only — no persistence per move
    }
    function onMouseUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (liveChatPctRef.current !== null) {
        setChatPct(liveChatPctRef.current); // single persisted commit
        liveChatPctRef.current = null;
        setLiveChatPct(null);
      }
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (isDragging.current) {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
  }, [setChatPct]);

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      {library}
      <div ref={splitRef} data-testid="workspace-split" className="flex min-w-0 flex-1">
        {layout.chatCollapsed ? (
          <>
            {chat}
            <div className="min-w-0 flex-1">{artifact}</div>
          </>
        ) : (
          <>
            <div
              style={{ width: `${liveChatPct ?? layout.chatPct}%` }}
              className="hidden min-w-0 shrink-0 lg:block"
            >
              {chat}
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={startDrag}
              className="hidden w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-zinc-800 transition-colors hover:bg-zinc-700 lg:flex"
            >
              <div className="h-8 w-0.5 rounded-full bg-zinc-600" />
            </div>
            <div className="min-w-0 flex-1">{artifact}</div>
          </>
        )}
      </div>
    </div>
  );
}
