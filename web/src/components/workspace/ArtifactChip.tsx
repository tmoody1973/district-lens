"use client";

/**
 * The conversation's artifact, pinned inside the chat column (Claude-style
 * chip). The brief pipeline completes via state deltas — not tool calls — so
 * this renders chat-adjacent rather than inside a message; a true in-message
 * chip needs the backend to invoke its (currently uncalled) finish_brief tool.
 */
export function ArtifactChip({
  title,
  kindLabel = "Brief",
  onOpen,
}: {
  title: string;
  kindLabel?: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-lg border border-edge bg-surface-raised px-3 py-2 text-left transition-colors hover:border-edge-strong hover:bg-surface-hover"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-400">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.8}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-zinc-200">{title}</span>
        <span className="block text-[11px] text-zinc-500">{kindLabel} · Click to open</span>
      </span>
      <svg
        className="h-3.5 w-3.5 shrink-0 text-zinc-600"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}
