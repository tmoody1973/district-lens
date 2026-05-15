/**
 * Server-side CopilotKit actions — registered in the CopilotRuntime so they
 * run on the server with full MongoDB / Geocod.io access.
 *
 * Action<T> is defined locally because @copilotkit/shared uses a Parameter[]
 * generic, not a plain object type.
 */

import { getDb, getFinanceSummaries, fmtMoney } from "@/lib/mongodb";
import { bioguidePhotoUrl, placeholderAvatarUrl } from "@/lib/bioguide";
import type { CandidateCard, FinanceSummary } from "@/types/agent-state";

// ---------------------------------------------------------------------------
// Local Action type (mirrors @copilotkit/shared Action but with a plain-object
// handler signature that TypeScript can check cleanly).
// ---------------------------------------------------------------------------

type ActionParameter = {
  name: string;
  type: string;
  description: string;
  required?: boolean;
};

type Action<T> = {
  name: string;
  description: string;
  parameters: ActionParameter[];
  handler: (args: T) => Promise<string>;
};

// ---------------------------------------------------------------------------
// lookup_district
// ---------------------------------------------------------------------------

export const districtLookupAction: Action<{ address: string }> = {
  name: "lookup_district",
  description:
    "Resolve a street address or ZIP code to a 2026 congressional district. " +
    "Returns the race key (e.g. '2026-H-WI-04'), address, and boundary source. " +
    "Always call this first when the user provides any address.",
  parameters: [
    {
      name: "address",
      type: "string",
      description: "Street address, ZIP code, or city+state.",
      required: true,
    },
  ],
  handler: async ({ address }) => {
    const geocodioKey = process.env.GEOCODIO_API_KEY;
    if (!geocodioKey) return "GEOCODIO_API_KEY not configured.";

    const url = new URL("https://api.geocod.io/v1.7/geocode");
    url.searchParams.set("q", address);
    url.searchParams.set("fields", "cd120,cd");
    url.searchParams.set("api_key", geocodioKey);
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString());
    if (!res.ok) return `Geocoding failed: ${res.status}`;
    const data = await res.json();

    const result = data?.results?.[0];
    if (!result) return `No results found for "${address}".`;

    const fields = result.fields ?? {};
    const cd = fields.congressional_districts?.[0];
    if (!cd) return `No congressional district found for "${address}".`;

    const state = result.address_components?.state ?? "";
    const district = String(cd.district_number ?? "0").padStart(2, "0");
    const raceKey = `2026-H-${state}-${district}`;
    const source =
      cd.source === "cd120"
        ? "2026 election boundaries"
        : "119th Congress (2026 maps pending)";

    return `District: ${raceKey}\nAddress: ${result.formatted_address}\nBoundary: ${source}`;
  },
};

// ---------------------------------------------------------------------------
// get_race_brief
// ---------------------------------------------------------------------------

export const getRaceBriefAction: Action<{ race_key: string }> = {
  name: "get_race_brief",
  description:
    "Get all candidates and FEC finance summary for a 2026 congressional race. " +
    "Call after lookup_district. Works regardless of boundary source.",
  parameters: [
    {
      name: "race_key",
      type: "string",
      description: "Race key from lookup_district, e.g. '2026-H-WI-04'.",
      required: true,
    },
  ],
  handler: async ({ race_key }) => {
    const db = await getDb();

    const rawCands = await db
      .collection("candidates")
      .find(
        { race_key },
        {
          projection: {
            _id: 0,
            candidate_id: 1,
            name: 1,
            party: 1,
            incumbent_challenge_status: 1,
          },
        }
      )
      .toArray();

    if (!rawCands.length) return `No candidates found for ${race_key}.`;

    const incumbentNames = rawCands
      .filter((c) => c.incumbent_challenge_status === "incumbent")
      .map((c) => c.name as string);

    const profileMap: Record<string, string> = {};
    if (incumbentNames.length > 0) {
      const profiles = await db
        .collection("legislator_profiles")
        .find(
          { name: { $in: incumbentNames } },
          { projection: { _id: 0, name: 1, bioguide_id: 1 } }
        )
        .toArray();
      for (const p of profiles) {
        if (p.name && p.bioguide_id)
          profileMap[p.name as string] = p.bioguide_id as string;
      }
    }

    const fins = await getFinanceSummaries(
      rawCands.map((c) => c.candidate_id as string)
    );
    const finMap = Object.fromEntries(fins.map((f) => [f.candidate_id, f]));

    const candidates: CandidateCard[] = rawCands.map((c) => {
      const bioguideId = profileMap[c.name as string];
      const photoUrl = bioguideId
        ? bioguidePhotoUrl(bioguideId)!
        : placeholderAvatarUrl(c.name as string, c.party as string);
      return {
        candidateId: c.candidate_id as string,
        name: c.name as string,
        party: c.party as string,
        status: (c.incumbent_challenge_status as string) ?? "unknown",
        photoUrl,
        photoSource: bioguideId ? "bioguide" : "placeholder",
        raceKey: race_key,
      };
    });

    const finance: FinanceSummary[] = rawCands.map((c) => {
      const f = finMap[c.candidate_id as string];
      return {
        candidateId: c.candidate_id as string,
        name: c.name as string,
        party: c.party as string,
        receipts: (f?.receipts as number) ?? null,
        disbursements: (f?.disbursements as number) ?? null,
        cashOnHand: (f?.cash_on_hand as number) ?? null,
        individualContributions: (f?.individual_contributions as number) ?? null,
        pacContributions: (f?.pac_contributions as number) ?? null,
        coverageEndDate: (f?.coverage_end_date as string) ?? null,
      };
    });

    const lines = [`Race brief for ${race_key}:`];
    for (const c of candidates) {
      const f = finance.find((fi) => fi.candidateId === c.candidateId);
      lines.push(
        `${c.name} (${c.party}, ${c.status}) — raised ${fmtMoney(f?.receipts ?? null)}`
      );
    }
    lines.push(
      "Source: FEC bulk data (fec.gov). Finance data does not prove issue positions."
    );
    return lines.join("\n");
  },
};

// ---------------------------------------------------------------------------
// get_incumbent_legislation
// ---------------------------------------------------------------------------

export const getIncumbentLegislationAction: Action<{ race_key: string }> = {
  name: "get_incumbent_legislation",
  description:
    "Get recently sponsored bills for the incumbent in a 2026 congressional race " +
    "from the 119th Congress. Use after get_race_brief.",
  parameters: [
    {
      name: "race_key",
      type: "string",
      description: "Race key, e.g. '2026-H-WI-04'.",
      required: true,
    },
  ],
  handler: async ({ race_key }) => {
    const db = await getDb();
    const bills = await db
      .collection("legislative_actions")
      .find(
        { race_key_2026: race_key, action_type: "sponsored_bill" },
        {
          projection: {
            _id: 0,
            bill_id: 1,
            title: 1,
            introduced_date: 1,
            latest_action: 1,
            member_name: 1,
          },
        }
      )
      .sort({ introduced_date: -1 })
      .limit(6)
      .toArray();

    if (!bills.length)
      return `No sponsored legislation found for the incumbent in ${race_key}.`;

    const member = bills[0]?.member_name ?? "The incumbent";
    const lines = [
      `${member} — recent sponsored legislation (119th Congress, source: Congress.gov):`,
    ];
    for (const b of bills) {
      lines.push(`  ${b.bill_id} (${b.introduced_date}): ${b.title}`);
      if (b.latest_action) lines.push(`    Status: ${b.latest_action}`);
    }
    lines.push(
      "Sponsorship shows legislative priorities, not definitive policy positions."
    );
    return lines.join("\n");
  },
};

// ---------------------------------------------------------------------------
// find_candidate
// ---------------------------------------------------------------------------

export const findCandidateAction: Action<{ name: string; state?: string }> = {
  name: "find_candidate",
  description:
    "Search for a 2026 congressional candidate by name across all FEC filers. " +
    "Use when the user mentions a candidate by name without providing an address.",
  parameters: [
    {
      name: "name",
      type: "string",
      description: "Candidate name or partial name.",
      required: true,
    },
    {
      name: "state",
      type: "string",
      description: "Optional two-letter state code, e.g. 'WI'.",
      required: false,
    },
  ],
  handler: async ({ name, state }) => {
    const db = await getDb();
    const query: Record<string, unknown> = { $text: { $search: name } };
    if (state) query.state = state.toUpperCase();

    const results = await db
      .collection("candidates")
      .find(query, {
        projection: {
          _id: 0,
          candidate_id: 1,
          name: 1,
          party: 1,
          race_key: 1,
          incumbent_challenge_status: 1,
          score: { $meta: "textScore" },
        },
      })
      .sort({ score: { $meta: "textScore" } })
      .limit(6)
      .toArray();

    if (!results.length)
      return `No 2026 FEC filers found matching "${name}"${state ? ` in ${state}` : ""}. They may not have filed yet.`;

    const lines = [`Candidates matching "${name}":`];
    for (const r of results) {
      const status = (
        (r.incumbent_challenge_status as string) ?? "unknown"
      ).replace("_", " ");
      lines.push(`  ${r.name} (${r.party}, ${status}) — ${r.race_key}`);
    }
    return lines.join("\n");
  },
};

// ---------------------------------------------------------------------------
// All actions — passed to CopilotRuntime constructor
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const allActions: Action<any>[] = [
  districtLookupAction,
  getRaceBriefAction,
  getIncumbentLegislationAction,
  findCandidateAction,
];
