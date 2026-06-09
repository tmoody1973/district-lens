"use client";

import type { ArtifactRecord, ArtifactType } from "@/lib/artifacts/types";

/** Evidence-adjacent type dots; amber is reserved for discovery (leads). */
const TYPE_DOT: Record<ArtifactType, string> = {
  brief: "bg-emerald-400",
  comparison: "bg-sky-400",
  overview: "bg-violet-400",
  lead: "bg-amber-400",
};

export function LibraryItem({
  artifact,
  active,
  onOpen,
  onDelete,
}: {
  artifact: ArtifactRecord;
  active: boolean;
  onOpen: (artifactId: string) => void;
  onDelete: (artifactId: string) => void;
}) {
  return (
    <div className="group flex items-center gap-1">
      <button
        type="button"
        onClick={() => onOpen(artifact.artifactId)}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
          active ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
        }`}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_DOT[artifact.type]}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{artifact.name}</span>
          <span className="block text-[10px] text-zinc-600">
            saved {new Date(artifact.updatedAt).toLocaleDateString()}
          </span>
        </span>
        {artifact.versions.length > 1 && (
          <span className="shrink-0 rounded bg-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-400">
            v{artifact.versions.length}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => onDelete(artifact.artifactId)}
        aria-label={`Delete ${artifact.name}`}
        className="shrink-0 rounded p-1 text-zinc-600 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        </svg>
      </button>
    </div>
  );
}
