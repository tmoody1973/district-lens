"use client";
import { useState } from "react";
import type { PerplexitySource } from "@/lib/perplexity";

interface Props {
  candidateName: string;
}

export function NewsAccordion({ candidateName }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<PerplexitySource[] | null>(null);

  // Fetch once, on first expand; cache in state so re-expanding never refetches.
  async function loadNews() {
    if (items !== null || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/search/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateName }),
      });
      if (!res.ok) throw new Error(`News lookup failed (${res.status})`);
      const data = await res.json();
      setItems((data.sources as PerplexitySource[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load news.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <details
      className="group rounded-[2px] border border-slate-200 bg-white"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) loadNews();
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 select-none">
        <span className="text-sm font-medium text-slate-700">Recent news · {candidateName}</span>
        <span className="text-slate-400 transition-transform group-open:rotate-180">⌄</span>
      </summary>

      <div className="border-t border-slate-100 p-4">
        {loading && <p className="text-sm text-slate-400">Loading recent coverage…</p>}

        {error && !loading && <p className="text-sm text-amber-700">{error}</p>}

        {items !== null && !loading && items.length === 0 && (
          <p className="text-sm text-slate-400">No recent coverage found in the last week.</p>
        )}

        {items !== null && items.length > 0 && (
          <ul className="space-y-3">
            {items.map((item, index) => (
              <li key={`${item.url}-${index}`} className="space-y-0.5">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-700 hover:underline"
                >
                  {item.title}
                </a>
                {item.date && <span className="ml-1 text-xs text-slate-400">· {item.date}</span>}
                {item.snippet && <p className="text-xs text-slate-500">{item.snippet}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
