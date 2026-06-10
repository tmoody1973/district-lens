/**
 * Shared party-color presentation tokens (defined in globals.css @theme).
 * IND uses the dedicated party-ind token (purple) so independents stay
 * visually distinct from generic neutral dots; unknown parties fall back
 * to neutral zinc.
 */
const PARTY_DOT: Record<string, string> = {
  DEM: "bg-party-dem",
  REP: "bg-party-rep",
  IND: "bg-party-ind",
};

export function partyDot(party: string | undefined): string {
  return PARTY_DOT[(party ?? "").toUpperCase()] ?? "bg-zinc-500";
}
