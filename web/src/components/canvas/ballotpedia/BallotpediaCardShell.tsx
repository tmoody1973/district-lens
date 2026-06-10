"use client";

import type { ReactNode } from "react";

/**
 * Shared chrome for every Ballotpedia discovery card. Carries the load-bearing
 * governance treatment: an amber "Ballotpedia · discovery" chip and a footer
 * that tells the reader (and a hackathon judge) these are LEADS, not cited
 * evidence. A dashed accent visually separates these from the solid-bordered
 * evidence cards (e.g. FinanceToolCard). DRY: one governance treatment, four
 * cards. See docs/plans/2026-06-08-ballotpedia-generative-ui-design.md.
 */

const GOVERNANCE_STANDARD =
  "Discovery lead from Ballotpedia (a wiki) — verify before citing; not indexed evidence.";

// The candidate-profile card carries platform text, so it gets the firmer
// wording: this is a wiki summary, not a candidate statement.
const GOVERNANCE_STRONG =
  "Discovery lead from Ballotpedia (a wiki) — verify before citing. This is not a candidate statement and is not indexed evidence.";

interface BallotpediaCardShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  governanceStrength?: "standard" | "strong";
}

export function BallotpediaCardShell({
  title,
  subtitle,
  children,
  governanceStrength = "standard",
}: BallotpediaCardShellProps) {
  const governance =
    governanceStrength === "strong" ? GOVERNANCE_STRONG : GOVERNANCE_STANDARD;

  return (
    <div className="my-2 space-y-3 rounded-[2px] border-2 border-dashed border-amber-500/40 bg-surface-raised p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-widest text-ink-muted">
          {title}
        </p>
        <span className="shrink-0 rounded-[2px] bg-amber-900/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-400">
          Ballotpedia · discovery
        </span>
      </div>
      {subtitle && <p className="text-[11px] text-ink-muted">{subtitle}</p>}

      {children}

      <p className="border-t border-amber-500/40 pt-2 text-[10px] italic text-evidence-reported">
        {governance}
      </p>
    </div>
  );
}

interface BallotpediaSkeletonProps {
  title: string;
  message: string;
}

export function BallotpediaSkeleton({ title, message }: BallotpediaSkeletonProps) {
  return (
    <BallotpediaCardShell title={title}>
      <p className="flex items-center gap-2 text-xs text-ink-muted">
        <span className="animate-spin">⟳</span> {message}
      </p>
    </BallotpediaCardShell>
  );
}

interface BallotpediaEmptyProps {
  title: string;
  governanceStrength?: "standard" | "strong";
}

export function BallotpediaEmpty({ title, governanceStrength }: BallotpediaEmptyProps) {
  return (
    <BallotpediaCardShell title={title} governanceStrength={governanceStrength}>
      <p className="text-xs italic text-ink-muted">Ballotpedia returned no results.</p>
    </BallotpediaCardShell>
  );
}

/** DEM/REP/IND → a colored dot, matching FinanceToolCard's party language. */
const PARTY_DOT: Record<string, string> = {
  DEM: "bg-party-dem",
  REP: "bg-party-rep",
  IND: "bg-zinc-500",
};

export function partyDot(party: string | undefined): string {
  return PARTY_DOT[(party ?? "").toUpperCase()] ?? "bg-zinc-500";
}

export function truncate(text: string | undefined, max: number): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** Renders an external link when a url is present, otherwise plain text — the
 *  same chrome (target/rel) every card needs. */
export function LinkOrSpan({
  href,
  className,
  children,
}: {
  href?: string;
  className?: string;
  children: ReactNode;
}) {
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  ) : (
    <span className={className}>{children}</span>
  );
}

/** A labeled card section that renders only when `show` is true (honest-empty). */
export function CardSection({
  title,
  show = true,
  children,
}: {
  title: string;
  show?: boolean;
  children: ReactNode;
}) {
  if (!show) return null;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-evidence-reported">{title}</p>
      {children}
    </div>
  );
}
