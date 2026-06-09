"use client";

import { useWorkspaceLayout } from "./WorkspaceLayoutContext";
import type { Persona } from "@/lib/workspace/layout";

const PERSONA_OPTIONS: Array<{ value: Persona; label: string }> = [
  { value: "voter", label: "🗳️ Voter" },
  { value: "journalist", label: "📰 Journalist" },
];

export function PersonaSwitch({
  onPersonaChange,
}: {
  onPersonaChange?: (persona: Persona) => void;
}) {
  const { layout, setPersona } = useWorkspaceLayout();

  return (
    <div role="radiogroup" aria-label="Persona" className="flex gap-1">
      {PERSONA_OPTIONS.map((option) => {
        const active = layout.persona === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              setPersona(option.value);
              onPersonaChange?.(option.value);
            }}
            className={
              active
                ? "rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-semibold text-white"
                : "rounded-md px-2.5 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
