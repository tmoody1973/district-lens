"use client";

import { useState } from "react";
import { Button } from "@heroui/react";

export default function HomePage() {
  const [address, setAddress] = useState("");

  return (
    <div className="flex flex-col flex-1">
      {/* Nav bar */}
      <header className="border-b-2 border-slate-900 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <span className="text-lg font-bold tracking-tight text-slate-900">
            DistrictLens
          </span>
          <span className="text-xs font-medium uppercase tracking-widest text-slate-500">
            Nonpartisan · Evidence-first · Cited
          </span>
        </div>
      </header>

      {/* Hero */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-20">
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

          {/* District lookup */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              // Phase 1B: wire to agent panel
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              placeholder="Street address or ZIP code"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              aria-label="Address or ZIP"
              className="flex-1 rounded-[2px] border-2 border-slate-900 bg-white px-4 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
            <Button
              type="submit"
              className="rounded-[2px] border-2 border-slate-900 bg-slate-900 px-6 font-semibold text-white"
            >
              Find my district
            </Button>
          </form>

          {/* Evidence badges */}
          <div className="flex flex-wrap justify-center gap-3 text-sm text-slate-500">
            {["FEC finance data", "Congress.gov votes", "Cited answers", "No vote recommendations"].map(
              (label) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1 rounded-[2px] border border-slate-300 bg-white px-3 py-1"
                >
                  {label}
                </span>
              )
            )}
          </div>
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
