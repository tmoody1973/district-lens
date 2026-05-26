import type { ReactNode } from "react";

interface Props {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({ title, defaultOpen = false, children }: Props) {
  return (
    <details open={defaultOpen} className="group rounded-[2px] border border-slate-200 bg-white open:bg-slate-50/40">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 select-none">
        <span className="text-xs font-medium uppercase tracking-widest text-slate-500">{title}</span>
        <span className="text-slate-400 transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="border-t border-slate-100 p-3">{children}</div>
    </details>
  );
}
