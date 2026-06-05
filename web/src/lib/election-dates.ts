// Election-date shaping for the voter brief. Pure and TZ-safe: dates are formatted
// from "YYYY-MM-DD" by parts and "completed" is decided by lexicographic ISO compare,
// so there is no Date math that could drift across timezones.

export interface ElectionDatesRecord {
  state?: string;
  state_abbreviation?: string;
  primary?: { date?: string; runoff_date_if_necessary?: string | null } | null;
  general_election_date?: string | null;
}

export interface KeyDate {
  label: string;
  dateText: string;
  completed: boolean;
}

// Canonical 2026 federal general election date — fixed by law (first Tuesday after
// the first Monday in November). Used only when the record omits the date.
const DEFAULT_GENERAL_ELECTION = "2026-11-03";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatIsoDate(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`;
}

export function deriveKeyDates(
  record: ElectionDatesRecord | null,
  todayIso: string,
): KeyDate[] {
  if (!record) return [];

  const dates: KeyDate[] = [];
  const add = (label: string, iso: string | null | undefined) => {
    if (!iso) return;
    const dateText = formatIsoDate(iso);
    if (!dateText) return;
    dates.push({ label, dateText, completed: iso.slice(0, 10) < todayIso });
  };

  add("Primary", record.primary?.date);
  add("Runoff", record.primary?.runoff_date_if_necessary);
  add("General", record.general_election_date ?? DEFAULT_GENERAL_ELECTION);
  return dates;
}
