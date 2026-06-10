"use client";

import { useEffect, useRef, useState } from "react";
import { fmtDate } from "@/lib/format";

export interface ArtifactSwitcherItem {
  id: string;
  name: string;
  savedAt?: string;
  /** Tailwind bg-* class for the type dot; defaults to the brief dot. */
  dotClass?: string;
}

/**
 * Crate-Deep-Cuts-style artifact switcher for the ArtifactPanel header: the
 * title becomes a dropdown listing the active thread's artifacts (or recent
 * library artifacts when no thread is open). With nothing to switch to it
 * renders a plain title.
 */
export function ArtifactSwitcher({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: ArtifactSwitcherItem[];
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (items.length === 0) {
    return <span className="truncate text-sm font-medium text-zinc-200">{title}</span>;
  }

  return (
    <div ref={wrapperRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-label="Switch artifact"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-zinc-800"
      >
        <span className="truncate text-sm font-medium text-zinc-200">{title}</span>
        <svg
          className="h-3 w-3 shrink-0 text-zinc-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="shrink-0 rounded bg-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-400">
          {items.length}
        </span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800 shadow-xl">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelect(item.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-zinc-700/50"
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.dotClass ?? "bg-emerald-400"}`}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{item.name}</span>
              {item.savedAt && (
                <span className="shrink-0 text-[10px] text-zinc-600">{fmtDate(item.savedAt)}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
