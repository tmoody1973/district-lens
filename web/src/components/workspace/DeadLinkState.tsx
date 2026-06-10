"use client";

interface DeadLinkStateProps {
  onReset: () => void;
}

export function DeadLinkState({ onReset }: DeadLinkStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-zinc-900 p-8 text-center">
      <p className="text-sm text-zinc-300">That artifact isn't in this browser's library.</p>
      <p className="text-xs text-zinc-500">
        Artifacts live on the device where they were built. Rebuild the brief to recreate it here.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
      >
        Start fresh
      </button>
    </div>
  );
}
