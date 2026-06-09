"use client";

import { CopilotChat } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { useWorkspaceLayout } from "./WorkspaceLayoutContext";
import { CHAT_LABELS, SYSTEM_PROMPT } from "@/lib/workspace/chat-config";

/**
 * Dockable CopilotKit chat. Collapsed it becomes a slim strip that still
 * surfaces the agent's live status — the build must never be hidden
 * (judging + trust requirement, spec §Agent visibility).
 */
export function ChatPane({ statusMessage }: { statusMessage?: string | null }) {
  const { layout, toggleChat } = useWorkspaceLayout();

  if (layout.chatCollapsed) {
    return (
      <div className="flex h-full w-10 shrink-0 flex-col items-center border-r border-zinc-800 bg-zinc-950 py-3">
        <button
          type="button"
          onClick={toggleChat}
          aria-label="Expand chat"
          className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </button>
        {statusMessage && (
          <span className="mt-3 max-h-64 truncate text-[10px] text-zinc-500 [writing-mode:vertical-rl]">
            {statusMessage}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Chat</span>
        <button
          type="button"
          onClick={toggleChat}
          aria-label="Collapse chat"
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <CopilotChat instructions={SYSTEM_PROMPT} labels={CHAT_LABELS} className="h-full" />
      </div>
    </div>
  );
}
