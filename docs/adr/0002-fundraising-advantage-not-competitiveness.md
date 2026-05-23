# Journalist map shows "Fundraising Advantage", not "Competitiveness"

**Status:** accepted (2026-05-23)

The v3 design spec colors the journalist map by race "competitiveness" (green = safe, amber = lean, red = competitive) derived purely from the incumbent/challenger fundraising ratio. This is a money → outcome inference the product's GUARDRAILS explicitly forbid, and it is empirically misleading: incumbency and district partisanship drive competitiveness, fundraising mostly follows the likely winner, and ~81% of 2026 House seats are structurally non-competitive regardless of cash (FairVote, Monopoly Politics 2026). We relabel the map "Fundraising Advantage", drop the Safe/Lean/Toss-up language and red/amber/green win-lose palette in favor of a single-hue intensity gradient (gap size, not who wins), and add a one-line caveat.

## Consequences

- **This deliberately deviates from the v3 spec.** Do not "fix" the map back to Safe/Lean/Competitive to match the spec — the spec conflated two distinct concepts (see [CONTEXT.md](../../CONTEXT.md): Fundraising Advantage vs Competitiveness).
- True competitiveness coloring (district partisanship, prior margins, or external Cook/Sabato ratings) is a deferred enhancement, not part of this change.
