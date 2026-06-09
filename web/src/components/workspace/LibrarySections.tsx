"use client";

import { useState } from "react";
import { useArtifacts } from "./ArtifactProvider";
import { LibraryItem } from "./LibraryItem";

const RECENTS_LIMIT = 5;

function Section({
  title,
  children,
  defaultExpanded = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className="px-3 py-2">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between text-xs font-semibold uppercase text-zinc-500"
      >
        {title}
        <span className="text-[10px]">{expanded ? "▼" : "►"}</span>
      </button>
      {expanded && <div className="mt-1 space-y-0.5">{children}</div>}
    </div>
  );
}

/** Recents + All artifacts, fed by the local-first library. */
export function LibrarySections() {
  const { library, active, openArtifact, deleteArtifact, storageAvailable } = useArtifacts();

  if (library.length === 0) {
    return (
      <p className="px-3 py-3 text-xs text-zinc-600">
        Briefs you build are saved here automatically.
        {!storageAvailable && " (This browser blocks storage — saves last only for this session.)"}
      </p>
    );
  }

  const recents = library.slice(0, RECENTS_LIMIT);

  return (
    <>
      {!storageAvailable && (
        <p className="px-3 pt-2 text-[10px] text-amber-500">
          Storage unavailable — artifacts last only for this session.
        </p>
      )}
      <Section title="Recents">
        {recents.map((a) => (
          <LibraryItem
            key={a.artifactId}
            artifact={a}
            active={active?.artifactId === a.artifactId}
            onOpen={openArtifact}
            onDelete={deleteArtifact}
          />
        ))}
      </Section>
      {library.length > RECENTS_LIMIT && (
        <Section title="All artifacts" defaultExpanded={false}>
          {library.map((a) => (
            <LibraryItem
              key={a.artifactId}
              artifact={a}
              active={active?.artifactId === a.artifactId}
              onOpen={openArtifact}
              onDelete={deleteArtifact}
            />
          ))}
        </Section>
      )}
    </>
  );
}
