// Canonicalizes LLM-extracted issue names so near-duplicate topics ("HOUSING"
// vs "Housing and Homelessness") merge into one accordion instead of two.
// Unknown issues pass through trimmed with their original casing.

const CANONICAL: Record<string, string> = {
  "housing": "Housing",
  "housing and homelessness": "Housing",
  "economy": "Economy and Jobs",
  "economy and jobs": "Economy and Jobs",
  "economy and taxes": "Economy and Jobs",
  "jobs": "Economy and Jobs",
  "taxes": "Taxes",
  "healthcare": "Health Care",
  "health care": "Health Care",
  "reproductive rights": "Reproductive Rights",
  "abortion": "Reproductive Rights",
  "climate": "Climate and Energy",
  "climate and energy": "Climate and Energy",
  "climate change": "Climate and Energy",
  "environment": "Climate and Energy",
  "guns": "Guns",
  "gun policy": "Guns",
  "immigration": "Immigration",
  "education": "Education",
  "veterans": "Veterans",
  "foreign policy": "Foreign Policy",
  "public safety": "Public Safety",
  "crime": "Public Safety",
};

export function canonicalizeIssue(issue: string): string {
  const trimmed = (issue ?? "").trim();
  return CANONICAL[trimmed.toLowerCase()] ?? trimmed;
}
