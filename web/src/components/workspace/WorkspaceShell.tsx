"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
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
      setChatPct(pct); // context clamps to [CHAT_PCT_MIN, CHAT_PCT_MAX]
    }
    function onMouseUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
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
            <div style={{ width: `${layout.chatPct}%` }} className="min-w-0 shrink-0">
              {chat}
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={startDrag}
              className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-zinc-800 transition-colors hover:bg-zinc-700"
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
