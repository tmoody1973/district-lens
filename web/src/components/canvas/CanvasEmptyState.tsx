"use client";

interface Props {
  address: string;
  onAddressChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
}

export function CanvasEmptyState({ address, onAddressChange, onSubmit, loading }: Props) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-10 text-center gap-4">
      <h1 className="text-2xl font-bold text-slate-900 leading-tight max-w-sm">
        What congressional race do you need to understand?
      </h1>
      <p className="text-sm text-slate-500">
        Evidence-first. Nonpartisan. Cited sources.
      </p>
      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
        className="w-full max-w-sm flex gap-2"
      >
        <input
          type="text"
          placeholder="Enter your street address or ZIP…"
          value={address}
          onChange={(e) => onAddressChange(e.target.value)}
          className="flex-1 rounded-[2px] border-2 border-slate-900 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
        />
        <button
          type="submit"
          disabled={loading || !address.trim()}
          className="rounded-[2px] border-2 border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-slate-700 transition-colors"
        >
          {loading ? "…" : "Find My Race →"}
        </button>
      </form>
      <p className="text-xs text-slate-400">or type any candidate name in the chat below</p>
    </div>
  );
}
