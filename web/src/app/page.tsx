"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { TraceCard } from "@/components/TraceCard";

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

const CIVIC_SYSTEM_PROMPT = `You are DistrictLens, a nonpartisan election-accountability assistant for the 2026 U.S. midterm cycle.

Your job: answer questions about congressional races, candidates, campaign finance, and incumbent legislative records. Always cite the stored source.

Hard rules:
- NEVER recommend how to vote or who is better. If asked, decline and offer to compare cited evidence.
- NEVER write campaign content (ads, talking points, fundraising, persuasion).
- NEVER infer a candidate's position from donors or party affiliation alone.
- NEVER fabricate positions. If evidence is missing, say "I found no direct statement in the indexed sources."
- Only cover federal 2026 congressional races. Decline local/state/ballot-measure questions.

Available tools:
- lookup_district(address) → returns a race_key (e.g. "2026-H-WI-04"), address, and boundary source. Call this first for any address or district question.
- get_race_brief(race_key) → returns all candidates and FEC finance summary for that race. Call this after lookup_district. The "2026 maps pending" boundary note only means boundary precision may improve; candidate and finance data are always available.
- get_incumbent_legislation(race_key) → returns recently sponsored bills for the incumbent in that race from the 119th Congress.
- find_candidate(name, state?) → searches 2026 FEC filers by name.

Typical flow: lookup_district → get_race_brief (always call this to list candidates) → get_incumbent_legislation (if the user wants legislative history).`;

export default function HomePage() {
  const [address, setAddress] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DistrictResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // --- CopilotKit tools (client-side, call API routes) ---

  useCopilotAction({
    name: "lookup_district",
    description:
      "Resolve a street address or ZIP code to a 2026 congressional district. " +
      "Returns the race key (e.g. '2026-H-WI-04'), address, coverage %, and boundary source. " +
      "Call this first when the user provides any address or asks about their district.",
    parameters: [
      { name: "address", type: "string", description: "Street address, ZIP code, or city+state.", required: true },
    ],
    render: ({ status, args, result }: { status: "inProgress" | "executing" | "complete"; args: { address?: string }; result?: string }) => (
      <TraceCard
        icon="📍"
        label="Geocod.io · district lookup"
        detail={args.address ? `"${args.address}"` : "resolving…"}
        status={status}
        result={result?.split("\n")[0]}
        source={status === "complete" ? "Source: Geocod.io, cd120/cd boundaries" : undefined}
      />
    ),
    handler: async ({ address }: { address: string }) => {
      const res = await fetch("/api/district/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      if (!res.ok) return `Lookup failed: ${data.error}`;
      const p = data.primary;
      if (!p) return `No district found for "${address}".`;
      return (
        `District: ${p.race_key}\nAddress: ${data.formatted_address}\n` +
        `Coverage: ${Math.round(p.proportion * 100)}%\n` +
        `Boundary: ${p.field_source === "cd120" ? "2026 election boundaries" : "119th Congress (2026 maps pending)"}`
      );
    },
  });

  useCopilotAction({
    name: "get_race_brief",
    description:
      "Get candidates and campaign finance summary for a 2026 congressional race. " +
      "Call after lookup_district with the returned race_key to show who is running and how much they raised.",
    parameters: [
      { name: "race_key", type: "string", description: "Race key from lookup_district, e.g. '2026-H-WI-04'.", required: true },
    ],
    render: ({ status, args, result }: { status: "inProgress" | "executing" | "complete"; args: { race_key?: string }; result?: string }) => (
      <TraceCard
        icon="🗳️"
        label="MongoDB Atlas · FEC candidates + finance"
        detail={args.race_key ?? "loading…"}
        status={status}
        result={status === "complete" ? result?.split("\n").slice(0, 2).join(" · ") : undefined}
        source={status === "complete" ? "Source: FEC bulk data (fec.gov), imported 2026-05-14" : undefined}
      />
    ),
    handler: async ({ race_key }: { race_key: string }) => {
      const res = await fetch(`/api/race/brief?race_key=${encodeURIComponent(race_key)}`);
      const data = await res.json();
      if (!res.ok) return `Finance data not available: ${data.error}`;
      return data.brief as string;
    },
  });

  useCopilotAction({
    name: "get_incumbent_legislation",
    description:
      "Get recent sponsored legislation for the incumbent in a 2026 congressional race. " +
      "Use after lookup_district to show what the incumbent has introduced in the 119th Congress.",
    parameters: [
      { name: "race_key", type: "string", description: "Race key from lookup_district, e.g. '2026-H-WI-04'.", required: true },
    ],
    render: ({ status, args, result }: { status: "inProgress" | "executing" | "complete"; args: { race_key?: string }; result?: string }) => (
      <TraceCard
        icon="📜"
        label="MongoDB Atlas · 119th Congress legislation"
        detail={args.race_key ?? "loading…"}
        status={status}
        result={status === "complete" ? result?.split("\n")[0] : undefined}
        source={status === "complete" ? "Source: Congress.gov API" : undefined}
      />
    ),
    handler: async ({ race_key }: { race_key: string }) => {
      const res = await fetch(`/api/incumbent/legislation?race_key=${encodeURIComponent(race_key)}`);
      const data = await res.json();
      if (!res.ok) return `Could not retrieve legislation: ${data.error}`;
      return data.legislation as string;
    },
  });

  useCopilotAction({
    name: "find_candidate",
    description:
      "Search for a 2026 congressional candidate by name. Use when the user mentions a candidate by name " +
      "without providing an address. Returns matching candidates with their race keys.",
    parameters: [
      { name: "name", type: "string", description: "Candidate name or partial name.", required: true },
      { name: "state", type: "string", description: "Optional two-letter state code, e.g. 'WI'.", required: false },
    ],
    render: ({ status, args, result }: { status: "inProgress" | "executing" | "complete"; args: { name?: string; state?: string }; result?: string }) => (
      <TraceCard
        icon="🔍"
        label="MongoDB Atlas · FEC candidate search"
        detail={args.name ? `"${args.name}"${args.state ? ` · ${args.state}` : ""}` : "searching…"}
        status={status}
        result={status === "complete" ? result?.split("\n")[0] : undefined}
        source={status === "complete" ? "Source: FEC 2026 candidate master file" : undefined}
      />
    ),
    handler: async ({ name, state }: { name: string; state?: string }) => {
      const params = new URLSearchParams({ name });
      if (state) params.set("state", state);
      const res = await fetch(`/api/candidate/search?${params.toString()}`);
      const data = await res.json();
      if (!res.ok || !data.candidates?.length) {
        return `No 2026 FEC filers found matching "${name}"${state ? ` in ${state}` : ""}. They may not have filed yet.`;
      }
      const lines = [`Candidates matching "${name}":`];
      for (const c of data.candidates) {
        const statusLabel = (c.incumbent_challenge_status ?? "unknown").replace("_", " ");
        lines.push(`  ${c.name} (${c.party}, ${statusLabel}) — ${c.race_key}`);
      }
      return lines.join("\n");
    },
  });

  // Share current district context with the CopilotKit agent
  useCopilotReadable({
    description: "The congressional district currently on screen, if the user has looked one up",
    value: result
      ? `Current district: ${result.primary?.race_key ?? "unknown"}. Address: ${result.formatted_address}. Boundary: ${result.field_source}.`
      : "No district selected yet.",
  });

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (address.length < 5) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/district/suggest?q=${encodeURIComponent(address)}`);
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
      setShowSuggestions(true);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [address]);

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
    source === "cd120" ? "2026 election boundaries" : "119th Congress boundaries (2026 maps pending)";

  return (
    <CopilotSidebar
      instructions={CIVIC_SYSTEM_PROMPT}
      defaultOpen={false}
      labels={{
        title: "DistrictLens",
        initial: "Ask about candidates, campaign finance, or paste an address to find your district.",
        placeholder: "Ask about a race, candidate, or issue…",
      }}
    >
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
                Enter your address to find your district, then ask the agent about
                candidates, finance, and issues — with sources on every answer.
              </p>
            </div>

            {/* Lookup form */}
            <div ref={wrapperRef} className="relative">
              <form onSubmit={handleSubmit} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Street address or ZIP code"
                  value={address}
                  onChange={(e) => { setAddress(e.target.value); setResult(null); setError(null); }}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  aria-label="Address or ZIP"
                  autoComplete="off"
                  className="flex-1 rounded-[2px] border-2 border-slate-900 bg-white px-4 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
                <Button
                  type="submit"
                  isDisabled={loading}
                  className="rounded-[2px] border-2 border-slate-900 bg-slate-900 px-6 font-semibold text-white"
                >
                  {loading ? "Looking up…" : "Find my district"}
                </Button>
              </form>

              {showSuggestions && suggestions.length > 0 && (
                <ul role="listbox" className="absolute z-10 mt-1 w-full rounded-[2px] border-2 border-slate-900 bg-white shadow-lg">
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

            {error && (
              <div className="rounded-[2px] border-2 border-red-700 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </div>
            )}

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
                      <p><span className="font-medium">Boundaries:</span> {boundaryLabel(result.field_source)}</p>
                    </div>
                    <p className="text-sm text-slate-500 border-t border-slate-200 pt-3">
                      Ask the DistrictLens agent (bottom-right) about candidates, finance, or issues in this race →
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-600">
                    No congressional district found. This address may be outside a voting congressional district.
                  </p>
                )}
              </div>
            )}

            {!result && !error && (
              <div className="flex flex-wrap justify-center gap-3 text-sm text-slate-500">
                {["FEC finance data", "Congress.gov votes", "Cited answers", "No vote recommendations"].map((label) => (
                  <span key={label} className="inline-flex items-center rounded-[2px] border border-slate-300 bg-white px-3 py-1">
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </main>

        <footer className="border-t-2 border-slate-200 px-6 py-4 text-center text-xs text-slate-400">
          Open source · Apache 2.0 ·{" "}
          <a href="https://github.com/tmoody1973/district-lens" className="underline hover:text-slate-700" rel="noopener noreferrer" target="_blank">
            GitHub
          </a>
        </footer>
      </div>
    </CopilotSidebar>
  );
}
