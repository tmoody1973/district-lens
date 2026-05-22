"use client";

export function CanvasEmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-10 text-center gap-4">
      <h1 className="text-2xl font-bold text-slate-900 leading-tight max-w-sm">
        What congressional race do you need to understand?
      </h1>
      <p className="text-sm text-slate-500 max-w-xs">
        Evidence-first. Nonpartisan. Cited sources.
      </p>
      <p className="text-xs text-slate-400">
        Enter your address above &uarr; or ask any question in the chat below &darr;
      </p>
    </div>
  );
}
