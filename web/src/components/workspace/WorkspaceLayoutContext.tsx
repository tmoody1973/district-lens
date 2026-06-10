"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  LAYOUT_STORAGE_KEY,
  clampChatPct,
  defaultLayout,
  parseLayout,
  serializeLayout,
  type WorkspaceLayoutState,
} from "@/lib/workspace/layout";

interface WorkspaceLayoutContextValue {
  layout: WorkspaceLayoutState;
  toggleLibrary: () => void;
  toggleChat: () => void;
  setChatPct: (pct: number) => void;
  resetLayout: () => void;
}

const WorkspaceLayoutContext = createContext<WorkspaceLayoutContextValue | null>(null);

export function WorkspaceLayoutProvider({ children }: { children: ReactNode }) {
  // Server render uses the default; the stored layout loads after mount so the
  // server and client first paint match (no hydration mismatch).
  const [layout, setLayout] = useState<WorkspaceLayoutState>(defaultLayout);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    } catch {
      // localStorage unavailable — session-only layout (spec §Error handling)
    }
    setLayout(parseLayout(stored));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, serializeLayout(layout));
    } catch {
      // quota or unavailable — degrade silently to session-only
    }
  }, [layout, hydrated]);

  const toggleLibrary = useCallback(
    () => setLayout((l) => ({ ...l, libraryCollapsed: !l.libraryCollapsed })),
    [],
  );
  const toggleChat = useCallback(
    () => setLayout((l) => ({ ...l, chatCollapsed: !l.chatCollapsed })),
    [],
  );
  const setChatPct = useCallback(
    (pct: number) => setLayout((l) => ({ ...l, chatPct: clampChatPct(pct) })),
    [],
  );
  const resetLayout = useCallback(() => setLayout(defaultLayout()), []);

  return (
    <WorkspaceLayoutContext.Provider
      value={{ layout, toggleLibrary, toggleChat, setChatPct, resetLayout }}
    >
      {children}
    </WorkspaceLayoutContext.Provider>
  );
}

export function useWorkspaceLayout(): WorkspaceLayoutContextValue {
  const ctx = useContext(WorkspaceLayoutContext);
  if (!ctx) throw new Error("useWorkspaceLayout must be used inside WorkspaceLayoutProvider");
  return ctx;
}
