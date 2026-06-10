"use client";
import type { NewsItem } from "@/types/agent-state";

interface Props { news: NewsItem[]; }

export function NewsCard({ news }: Props) {
  if (!news.length) return null;

  return (
    <div className="rounded-[2px] border-2 border-edge-strong bg-surface-raised p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-widest text-ink-muted">
          Recent News · Last 7 Days
        </p>
        <span className="text-xs text-ink-faint">Source: Perplexity Sonar</span>
      </div>
      <div className="space-y-3">
        {news.slice(0, 5).map((item, i) => (
          <div key={i} className="space-y-0.5">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-blue-400 hover:underline leading-snug block"
            >
              {item.title}
            </a>
            {item.snippet && (
              <p className="text-xs text-ink-muted line-clamp-2">{item.snippet}</p>
            )}
            <div className="flex items-center gap-2 text-xs text-ink-faint">
              <span>{item.source || new URL(item.url).hostname}</span>
              {item.date && <span>· {item.date}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
