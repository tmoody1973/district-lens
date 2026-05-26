export function fmtMoney(val: number | null): string {
  if (val == null) return "—";
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(val / 1_000)}K`;
  return `$${val}`;
}
