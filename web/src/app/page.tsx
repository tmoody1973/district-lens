// web/src/app/page.tsx
"use client";

import { useRouter } from "next/navigation";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { USMap } from "@/components/map/USMap";
import { AddressSuggestInput } from "@/components/workspace/AddressSuggestInput";

export default function LandingPage() {
  const router = useRouter();

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

        <div className="w-full max-w-xl">
          <AddressSuggestInput onSubmit={goToWorkspace} buttonLabel="Build my brief" />
        </div>

        <div className="w-full">
          <p className="mb-2 text-center text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Or explore a state's races
          </p>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <USMap
              focusedState={null}
              onStateClick={(stateCode) => router.push(`/w?state=${stateCode}`)}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
