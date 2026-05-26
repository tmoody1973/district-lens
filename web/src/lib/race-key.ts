export type Office = "house" | "senate";

export interface ParsedRaceKey {
  year: string;
  office: Office;
  state: string;
  district: string | null;
}

// Race keys look like "2026-H-WI-04" (House) or "2026-S-WI" (Senate).
export function parseRaceKey(raceKey: string | null): ParsedRaceKey | null {
  if (!raceKey) return null;
  const parts = raceKey.split("-");
  if (parts.length < 3) return null;
  const [year, officeCode, state, district] = parts;
  if (state?.length !== 2) return null;
  const office: Office | null =
    officeCode === "H" ? "house" : officeCode === "S" ? "senate" : null;
  if (!office) return null;
  return { year, office, state: state.toUpperCase(), district: district ?? null };
}
