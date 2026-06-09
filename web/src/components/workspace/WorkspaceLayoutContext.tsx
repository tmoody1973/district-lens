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
  parseLayout,
  presetFor,
  serializeLayout,
  type Persona,
  type WorkspaceLayoutState,
} from "@/lib/workspace/layout";

interface WorkspaceLayoutContextValue {
  layout: WorkspaceLayoutState;
  setPersona: (persona: Persona) => void;
  toggleLibrary: () => void;
  toggleChat: () => void;
  setChatPct: (pct: number) => void;
  resetToPreset: () => void;
}

const WorkspaceLayoutContext = createContext<WorkspaceLayoutContextValue | null>(null);

export function WorkspaceLayoutProvider({
  children,
  initialPersona = "voter",
}: {
  children: ReactNode;
  initialPersona?: Persona;
}) {
  // Server render uses the preset; the stored layout loads after mount so the
  // server and client first paint match (no hydration mismatch).
  const [layout, setLayout] = useState<WorkspaceLayoutState>(() => presetFor(initialPersona));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    } catch {
      // localStorage unavailable — session-only layout (spec §Error handling)
    }
    setLayout(parseLayout(stored, initialPersona));
    setHydrated(true);
    // intentional: mount-only; initialPersona changes after mount are not supported
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, serializeLayout(layout));
    } catch {
      // quota or unavailable — degrade silently to session-only
    }
  }, [layout, hydrated]);

  const setPersona = useCallback((persona: Persona) => setLayout(presetFor(persona)), []);
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
  const resetToPreset = useCallback(() => setLayout((l) => presetFor(l.persona)), []);

  return (
    <WorkspaceLayoutContext.Provider
      value={{ layout, setPersona, toggleLibrary, toggleChat, setChatPct, resetToPreset }}
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
