"use client";

import { fmtDate } from "@/lib/format";
import type { SavedBallotItem } from "@/lib/saved-briefs/schema";

interface MyBallotSectionProps {
  items: SavedBallotItem[];
  onOpen: (briefId: string) => void;
}

export function MyBallotSection({ items, onOpen }: MyBallotSectionProps) {
  return (
    <div className="px-3 py-2">
      <p className="text-xs font-semibold uppercase text-zinc-500">My Ballot</p>
      <ul className="mt-1 space-y-0.5">
        {items.map((item) => (
          <li key={item.raceKey}>
            <button
              type="button"
              onClick={() => item.briefId && onOpen(item.briefId)}
              disabled={!item.briefId}
              className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
            >
              <span className="block truncate text-xs font-semibold">{item.label}</span>
              <span className="block text-[10px] text-zinc-600">
                saved {fmtDate(item.savedAt)}
              </span>
              {item.changes.length > 0 &&
                item.changes.map((c) => (
                  <span key={c} className="block text-[10px] font-medium text-amber-500">● {c}</span>
                ))}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
