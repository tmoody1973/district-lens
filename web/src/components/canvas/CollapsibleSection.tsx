import type { ReactNode } from "react";

interface Props {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({ title, defaultOpen = false, children }: Props) {
  return (
    <details open={defaultOpen} className="group rounded-[2px] border border-edge bg-surface-raised open:bg-surface-raised">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 select-none">
        <span className="text-xs font-medium uppercase tracking-widest text-ink-muted">{title}</span>
        <span className="text-ink-faint transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="border-t border-edge p-3">{children}</div>
    </details>
  );
}
