"use client";

import { useEffect, useRef, useState } from "react";

const SUGGEST_MIN_CHARS = 5;
const SUGGEST_DEBOUNCE_MS = 300;

/**
 * Address entry with debounced Geocodio-backed suggestions — the landing
 * page's proven input, extracted (D5) so the workspace ExploreSurface and the
 * landing share one implementation.
 */
export function AddressSuggestInput({
  onSubmit,
  buttonLabel = "Build brief",
  compact = false,
}: {
  onSubmit: (address: string) => void;
  buttonLabel?: string;
  /** Slimmer paddings for in-panel use (workspace rail). */
  compact?: boolean;
}) {
  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (address.length < SUGGEST_MIN_CHARS) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/district/suggest?q=${encodeURIComponent(address)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        setSuggestions(data.suggestions ?? []);
        setShowSuggestions(true);
      } catch {
        if (!controller.signal.aborted) setSuggestions([]);
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      controller.abort();
    };
  }, [address]);

  // Mounted permanently in the workspace rail — only listen while the
  // dropdown is actually open.
  useEffect(() => {
    if (!showSuggestions) return;
    function handleClick(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSuggestions]);

  function submit(addr: string) {
    if (!addr.trim()) return;
    onSubmit(addr);
  }

  const inputPadding = compact ? "px-3 py-2" : "px-4 py-3";
  const buttonPadding = compact ? "px-3" : "px-5";

  return (
    <div ref={wrapperRef} className="relative w-full">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(address);
        }}
      >
        <input
          type="text"
          placeholder="Street address or ZIP code"
          aria-label="Street address or ZIP code"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          className={`min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 ${inputPadding} text-sm text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none`}
        />
        <button
          type="submit"
          className={`rounded-lg bg-zinc-100 ${buttonPadding} text-sm font-semibold text-zinc-900 transition-colors hover:bg-white`}
        >
          {buttonLabel}
        </button>
      </form>
      {showSuggestions && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
          {suggestions.map((s) => (
            <li
              key={s}
              onMouseDown={() => submit(s)}
              className="cursor-pointer px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
