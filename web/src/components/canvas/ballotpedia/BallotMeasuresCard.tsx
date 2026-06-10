"use client";

import { BallotpediaCardShell, BallotpediaEmpty, LinkOrSpan, truncate } from "./BallotpediaCardShell";

export interface BallotMeasure {
  title: string;
  type?: string;
  subject?: string;
  description?: string;
  status?: string;
  url?: string;
}

export interface BallotMeasuresData {
  state?: string;
  year?: number;
  measures: BallotMeasure[];
}

const UNGROUPED = "All measures";

/** Ballotpedia joins subjects with ";"; group on the first token. */
function firstSubject(subject: string | undefined): string {
  const first = (subject ?? "").split(";")[0]?.trim();
  return first || UNGROUPED;
}

function groupBySubject(measures: BallotMeasure[]): Array<[string, BallotMeasure[]]> {
  const groups = new Map<string, BallotMeasure[]>();
  for (const measure of measures) {
    const key = firstSubject(measure.subject);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(measure);
    } else {
      groups.set(key, [measure]);
    }
  }
  return [...groups.entries()];
}

export function BallotMeasuresCard({ data }: { data: BallotMeasuresData | null }) {
  const title = "Ballot Measures";
  const measures = data?.measures ?? [];
  if (measures.length === 0) {
    return <BallotpediaEmpty title={title} />;
  }

  const groups = groupBySubject(measures);
  const subtitle = [data?.state, data?.year].filter(Boolean).join(" · ") || undefined;

  return (
    <BallotpediaCardShell title={title} subtitle={subtitle}>
      {groups.map(([subject, items]) => (
        <div key={subject} className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-evidence-reported">
            {subject}
          </p>
          {items.map((measure) => (
            <div key={`${subject}-${measure.title}`} className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <LinkOrSpan
                  href={measure.url}
                  className="truncate text-sm font-medium text-ink underline-offset-2 hover:underline"
                >
                  {measure.title}
                </LinkOrSpan>
                {measure.type && (
                  <span className="shrink-0 rounded-[2px] border border-edge px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-ink-muted">
                    {measure.type}
                  </span>
                )}
              </div>
              {measure.description && (
                <p className="text-[11px] text-ink-muted">
                  {truncate(measure.description, 140)}
                </p>
              )}
            </div>
          ))}
        </div>
      ))}
    </BallotpediaCardShell>
  );
}
