const BIOGUIDE_BASE = "https://bioguide.congress.gov/bioguide/photo";

export function bioguidePhotoUrl(bioguideId: string): string | null {
  if (!bioguideId) return null;
  const id = bioguideId.toUpperCase();
  const letter = id[0];
  return `${BIOGUIDE_BASE}/${letter}/${id}.jpg`;
}

const PARTY_COLORS: Record<string, string> = {
  DEM: "1d4ed8",
  REP: "b91c1c",
  IND: "4b5563",
};

export function placeholderAvatarUrl(name: string, party: string): string {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const color = PARTY_COLORS[party.toUpperCase()] ?? "4b5563";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
    <rect width="80" height="80" rx="40" fill="#${color}"/>
    <text x="40" y="52" text-anchor="middle" font-family="system-ui,sans-serif"
      font-size="28" font-weight="600" fill="white">${initials}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
