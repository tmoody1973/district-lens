// web/src/app/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { USMap } from "@/components/map/USMap";

export default function LandingPage() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (address.length < 5) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/district/suggest?q=${encodeURIComponent(address)}`);
        const data = await res.json();
        setSuggestions(data.suggestions ?? []);
        setShowSuggestions(true);
      } catch {
        setSuggestions([]);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [address]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function goToWorkspace(addr: string) {
    if (!addr.trim()) return;
    router.push(`/w?addr=${encodeURIComponent(addr)}`);
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <span className="text-lg font-bold tracking-tight">DistrictLens</span>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs font-medium uppercase tracking-widest text-zinc-500 lg:block">
            Nonpartisan · Evidence-first
          </span>
          <Show
            when="signed-in"
            fallback={
              <SignInButton mode="modal">
                <button className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white">
                  Sign in
                </button>
              </SignInButton>
            }
          >
            <UserButton />
          </Show>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-10 px-6 py-16">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">What's on your ballot?</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Evidence-first briefs on 2026 congressional races — cited, dated, nonpartisan.
          </p>
        </div>

        <div ref={wrapperRef} className="relative w-full max-w-xl">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              goToWorkspace(address);
            }}
          >
            <input
              type="text"
              placeholder="Street address or ZIP code"
              aria-label="Street address or ZIP code"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg bg-zinc-100 px-5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-white"
            >
              Build my brief
            </button>
          </form>
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
              {suggestions.map((s) => (
                <li
                  key={s}
                  onMouseDown={() => goToWorkspace(s)}
                  className="cursor-pointer px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="w-full">
          <p className="mb-2 text-center text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Or explore a state's races
          </p>
          {/* USMap is still light-styled until the dark token sweep — render it on a paper plate. */}
          <div className="rounded-xl bg-white p-4">
            <USMap
              focusedState={null}
              onStateClick={(stateCode) => router.push(`/w?state=${stateCode}`)}
              mode="journalist"
            />
          </div>
        </div>
      </main>
    </div>
  );
}
