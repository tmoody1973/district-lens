"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";

interface DistrictResult {
  formatted_address: string;
  accuracy_type: string;
  state: string;
  primary: { race_key: string; proportion: number; field_source: string } | null;
  districts: { race_key: string; proportion: number; field_source: string }[];
  is_zip_ambiguous: boolean;
  field_source: string;
  error?: string;
}

export default function HomePage() {
  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DistrictResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Address autocomplete — debounced, min 3 chars
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (address.length < 3) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/district/suggest?q=${encodeURIComponent(address)}`);
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
      setShowSuggestions(true);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [address]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const lookup = useCallback(async (addr: string) => {
    if (!addr.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setShowSuggestions(false);
    try {
      const res = await fetch("/api/district/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr }),
      });
      const data: DistrictResult = await res.json();
      if (!res.ok) { setError(data.error ?? "Lookup failed"); return; }
      setResult(data);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  function handleSuggestionClick(suggestion: string) {
    setAddress(suggestion);
    setSuggestions([]);
    setShowSuggestions(false);
    lookup(suggestion);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    lookup(address);
  }

  const boundaryLabel = (source: string) =>
    source === "cd120"
      ? "2026 election boundaries"
      : "119th Congress boundaries (2026 maps pending)";

  return (
    <div className="flex flex-col flex-1">
      {/* Nav */}
      <header className="border-b-2 border-slate-900 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <span className="text-lg font-bold tracking-tight text-slate-900">DistrictLens</span>
          <span className="text-xs font-medium uppercase tracking-widest text-slate-500">
            Nonpartisan · Evidence-first · Cited
          </span>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
        <div className="mx-auto w-full max-w-2xl space-y-8 text-center">
          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight text-slate-900">
              Your congressional race, clearly.
            </h1>
            <p className="text-lg text-slate-600">
              Enter your address to find your district, explore candidates, and
              ask issue questions — with sources attached to every answer.
            </p>
          </div>

          {/* Lookup form + autocomplete */}
          <div ref={wrapperRef} className="relative">
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="text"
                placeholder="Street address or ZIP code"
                value={address}
                onChange={(e) => { setAddress(e.target.value); setResult(null); setError(null); }}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                aria-label="Address or ZIP"
                aria-autocomplete="list"
                autoComplete="off"
                className="flex-1 rounded-[2px] border-2 border-slate-900 bg-white px-4 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
              <Button
                type="submit"
                isLoading={loading}
                className="rounded-[2px] border-2 border-slate-900 bg-slate-900 px-6 font-semibold text-white"
              >
                {loading ? "Looking up…" : "Find my district"}
              </Button>
            </form>

            {/* Autocomplete dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <ul
                role="listbox"
                className="absolute z-10 mt-1 w-full rounded-[2px] border-2 border-slate-900 bg-white shadow-lg"
              >
                {suggestions.map((s) => (
                  <li
                    key={s}
                    role="option"
                    aria-selected={false}
                    onMouseDown={() => handleSuggestionClick(s)}
                    className="cursor-pointer px-4 py-2 text-left text-sm text-slate-800 hover:bg-slate-100"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-[2px] border-2 border-red-700 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="rounded-[2px] border-2 border-slate-900 bg-white p-6 text-left space-y-4">
              {result.is_zip_ambiguous ? (
                <>
                  <p className="font-semibold text-slate-900">
                    That ZIP spans multiple districts. Enter a full street address for a definitive answer.
                  </p>
                  <ul className="space-y-1 text-sm text-slate-700">
                    {result.districts.map((d) => (
                      <li key={d.race_key} className="flex items-center justify-between">
                        <span className="font-mono font-bold text-blue-700">{d.race_key}</span>
                        <span>{Math.round(d.proportion * 100)}% coverage</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : result.primary ? (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
                        Congressional district
                      </p>
                      <p className="mt-1 font-mono text-4xl font-bold text-blue-700">
                        {result.primary.race_key}
                      </p>
                    </div>
                    <span className="rounded-[2px] border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                      {Math.round(result.primary.proportion * 100)}% coverage
                    </span>
                  </div>
                  <div className="border-t border-slate-200 pt-3 space-y-1 text-sm text-slate-600">
                    <p><span className="font-medium">Address:</span> {result.formatted_address}</p>
                    <p><span className="font-medium">Geocode:</span> {result.accuracy_type}</p>
                    <p>
                      <span className="font-medium">Boundaries:</span>{" "}
                      {boundaryLabel(result.field_source)}
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-600">
                  No congressional district found for this address. It may be outside a voting congressional district.
                </p>
              )}
            </div>
          )}

          {/* Evidence badges — hide when result is showing */}
          {!result && !error && (
            <div className="flex flex-wrap justify-center gap-3 text-sm text-slate-500">
              {["FEC finance data", "Congress.gov votes", "Cited answers", "No vote recommendations"].map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center rounded-[2px] border border-slate-300 bg-white px-3 py-1"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      </main>

      <footer className="border-t-2 border-slate-200 px-6 py-4 text-center text-xs text-slate-400">
        Open source · Apache 2.0 ·{" "}
        <a
          href="https://github.com/tmoody1973/district-lens"
          className="underline hover:text-slate-700"
          rel="noopener noreferrer"
          target="_blank"
        >
          GitHub
        </a>
      </footer>
    </div>
  );
}
