"use client";

import { useCallback, useState } from "react";
import { briefToMarkdown } from "@/lib/brief-markdown";
import type { DistrictLensState } from "@/types/agent-state";

interface ArtifactActionsProps {
  state: DistrictLensState | null;
}

const FLASH_MS = 1500;

/**
 * Journalist workflow actions for an open brief: copy as markdown, export as
 * a .md download, and share a per-race permalink (/w?race=KEY). Renders
 * nothing until a race is open.
 */
export function ArtifactActions({ state }: ArtifactActionsProps) {
  const [flash, setFlash] = useState<"copied" | "link" | null>(null);

  const raceKey = state?.currentRaceKey ?? null;

  const flashThenClear = useCallback((kind: "copied" | "link") => {
    setFlash(kind);
    setTimeout(() => setFlash(null), FLASH_MS);
  }, []);

  const onCopy = useCallback(async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(briefToMarkdown(state));
      flashThenClear("copied");
    } catch {
      /* clipboard unavailable — button simply doesn't flash */
    }
  }, [state, flashThenClear]);

  const onShare = useCallback(async () => {
    if (!raceKey) return;
    try {
      const url = `${window.location.origin}/w?race=${encodeURIComponent(raceKey)}`;
      await navigator.clipboard.writeText(url);
      flashThenClear("link");
    } catch {
      /* clipboard unavailable */
    }
  }, [raceKey, flashThenClear]);

  const onExport = useCallback(() => {
    if (!state || !raceKey) return;
    const blob = new Blob([briefToMarkdown(state)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `districtlens-brief-${raceKey}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [state, raceKey]);

  if (!raceKey) return null;

  const buttonClass =
    "rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100";

  return (
    <>
      <button type="button" onClick={onCopy} className={buttonClass}>
        {flash === "copied" ? "Copied ✓" : "Copy brief"}
      </button>
      <button type="button" onClick={onExport} className={buttonClass}>
        Export .md
      </button>
      <button type="button" onClick={onShare} className={buttonClass}>
        {flash === "link" ? "Link copied ✓" : "Share"}
      </button>
    </>
  );
}
