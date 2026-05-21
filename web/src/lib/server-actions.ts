/**
 * Server-side CopilotKit actions — registered in the CopilotRuntime so they
 * run on the server with full MongoDB / Geocod.io access.
 *
 * Action<T> is defined locally because @copilotkit/shared uses a Parameter[]
 * generic, not a plain object type.
 */

import { getDb, getFinanceSummaries, fmtMoney } from "@/lib/mongodb";
import { bioguidePhotoUrl, placeholderAvatarUrl } from "@/lib/bioguide";
import type { BillRecord, CandidateCard, FinanceSummary, RaceRow } from "@/types/agent-state";

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

    return `District: ${raceKey}\nAddress: ${result.formatted_address}\nBoundary: ${source}\n\nSTRUCTURED_DATA:${JSON.stringify({ currentRaceKey: raceKey, stage: "district" })}`;
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

    const [profileDocs, fins] = await Promise.all([
      incumbentNames.length > 0
        ? db
            .collection("legislator_profiles")
            .find(
              { name: { $in: incumbentNames } },
              { projection: { _id: 0, name: 1, bioguide_id: 1 } }
            )
            .toArray()
        : Promise.resolve([]),
      getFinanceSummaries(rawCands.map((c) => c.candidate_id as string)),
    ]);

    const profileMap: Record<string, string> = {};
    for (const p of profileDocs) {
      if (p.name && p.bioguide_id)
        profileMap[p.name as string] = p.bioguide_id as string;
    }
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
    return `${lines.join("\n")}\n\nSTRUCTURED_DATA:${JSON.stringify({ candidates, finance, currentRaceKey: race_key, stage: "candidates" })}`;
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

    const legislation: BillRecord[] = bills.map((b) => ({
      billId: b.bill_id as string,
      title: b.title as string,
      introducedDate: (b.introduced_date as string) ?? null,
      latestAction: (b.latest_action as string) ?? null,
      memberName: (b.member_name as string) ?? "",
    }));

    const member = legislation[0]?.memberName ?? "The incumbent";
    const lines = [
      `${member} — recent sponsored legislation (119th Congress, source: Congress.gov):`,
    ];
    for (const b of legislation) {
      lines.push(`  ${b.billId} (${b.introducedDate}): ${b.title}`);
      if (b.latestAction) lines.push(`    Status: ${b.latestAction}`);
    }
    lines.push(
      "Sponsorship shows legislative priorities, not definitive policy positions."
    );
    return `${lines.join("\n")}\n\nSTRUCTURED_DATA:${JSON.stringify({ legislation, stage: "legislation" })}`;
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
// get_state_races
// ---------------------------------------------------------------------------

export const getStateRacesAction: Action<{ state_code: string }> = {
  name: "get_state_races",
  description:
    "Get all 2026 congressional races in a US state with finance gap data. " +
    "Use after the user clicks a state on the map or asks about races in a state.",
  parameters: [
    { name: "state_code", type: "string", description: "Two-letter state code, e.g. 'WI'.", required: true },
  ],
  handler: async ({ state_code }) => {
    const state = state_code.toUpperCase().trim();
    const db = await getDb();

    const raceDocs = await db
      .collection("races")
      .find({ state }, { projection: { _id: 0, race_key: 1, state: 1, office: 1, district: 1 } })
      .toArray();

    if (!raceDocs.length) return `No races found for ${state}.`;

    const raceKeys = raceDocs.map((r) => r.race_key as string);
    const candidates = await db
      .collection("candidates")
      .find({ race_key: { $in: raceKeys } })
      .toArray();
    const finance = await db
      .collection("finance_summaries")
      .find({ candidate_id: { $in: candidates.map((c) => c.candidate_id as string) } })
      .toArray();

    const finMap = Object.fromEntries(finance.map((f) => [f.candidate_id as string, f]));

    const rows: RaceRow[] = raceDocs.map((race) => {
      const raceCands = candidates.filter((c) => c.race_key === race.race_key);
      const incumbent = raceCands.find((c) => c.incumbent_challenge_status === "incumbent");
      const challengers = raceCands.filter((c) => c.incumbent_challenge_status !== "incumbent");
      const incFin = incumbent ? finMap[incumbent.candidate_id as string] : null;
      const topChallenger = [...challengers].sort((a, b) => {
        const fa = (finMap[a.candidate_id as string]?.receipts as number) ?? 0;
        const fb = (finMap[b.candidate_id as string]?.receipts as number) ?? 0;
        return fb - fa;
      })[0];
      const chalFin = topChallenger ? finMap[topChallenger.candidate_id as string] : null;
      const incReceipts = (incFin?.receipts as number) ?? null;
      const chalReceipts = (chalFin?.receipts as number) ?? null;
      return {
        raceKey: race.race_key as string,
        state: race.state as string,
        office: race.office as string,
        district: race.district as string,
        incumbentName: (incumbent?.name as string) ?? null,
        incumbentParty: (incumbent?.party as string) ?? null,
        incumbentReceipts: incReceipts,
        topChallengerName: (topChallenger?.name as string) ?? null,
        topChallengerReceipts: chalReceipts,
        financeGap: incReceipts !== null && chalReceipts !== null ? incReceipts - chalReceipts : null,
        pacPct:
          incFin && (incFin.receipts as number) > 0
            ? Math.round(((incFin.pac_contributions as number) / (incFin.receipts as number)) * 100)
            : null,
      };
    });

    const lines = [`Races in ${state} (${rows.length} total):`];
    for (const r of rows.slice(0, 10)) {
      const gap = r.financeGap != null ? ` | Gap: $${Math.abs(r.financeGap).toLocaleString()}` : "";
      lines.push(`  ${r.raceKey}: ${r.incumbentName ?? "Open seat"} (${r.incumbentParty ?? "?"})${gap}`);
    }
    return `${lines.join("\n")}\n\nSTRUCTURED_DATA:${JSON.stringify({ stateRaces: rows })}`;
  },
};

// ---------------------------------------------------------------------------
// find_competitive_races
// ---------------------------------------------------------------------------

export const findCompetitiveRacesAction: Action<{ state?: string }> = {
  name: "find_competitive_races",
  description:
    "Find 2026 congressional races where challenger is outraising the incumbent or finance gap is narrow. " +
    "Great for journalists looking for story angles.",
  parameters: [
    { name: "state", type: "string", description: "Optional two-letter state code to narrow results.", required: false },
  ],
  handler: async ({ state }) => {
    const db = await getDb();
    const query = state ? { state: state.toUpperCase().trim() } : {};

    const candidates = await db
      .collection("candidates")
      .find(query, {
        projection: { _id: 0, candidate_id: 1, race_key: 1, name: 1, party: 1, state: 1, incumbent_challenge_status: 1 },
      })
      .toArray();

    const finance = await db
      .collection("finance_summaries")
      .find({ candidate_id: { $in: candidates.map((c) => c.candidate_id as string) } })
      .toArray();

    const finMap = Object.fromEntries(finance.map((f) => [f.candidate_id as string, f]));

    type RaceAccum = { incumbent: typeof candidates[0] | null; topChallenger: typeof candidates[0] | null; state: string };
    const byRace: Record<string, RaceAccum> = {};
    for (const c of candidates) {
      const key = c.race_key as string;
      if (!byRace[key]) byRace[key] = { incumbent: null, topChallenger: null, state: c.state as string };
      if (c.incumbent_challenge_status === "incumbent") {
        byRace[key].incumbent = c;
      } else {
        const current = byRace[key].topChallenger;
        const currentReceipts = current ? ((finMap[current.candidate_id as string]?.receipts as number) ?? 0) : -1;
        const thisReceipts = (finMap[c.candidate_id as string]?.receipts as number) ?? 0;
        if (thisReceipts > currentReceipts) byRace[key].topChallenger = c;
      }
    }

    const competitive = Object.entries(byRace)
      .filter(([, d]) => d.incumbent && d.topChallenger)
      .map(([raceKey, d]) => {
        const incReceipts = (finMap[d.incumbent!.candidate_id as string]?.receipts as number) ?? 0;
        const chalReceipts = (finMap[d.topChallenger!.candidate_id as string]?.receipts as number) ?? 0;
        return {
          raceKey,
          state: d.state,
          incumbentName: d.incumbent!.name as string,
          incumbentParty: d.incumbent!.party as string,
          incumbentReceipts: incReceipts,
          topChallengerName: d.topChallenger!.name as string,
          topChallengerReceipts: chalReceipts,
          financeGap: incReceipts - chalReceipts,
          challengerLeading: chalReceipts > incReceipts,
        };
      })
      .filter((r) => r.challengerLeading || r.financeGap < 100_000)
      .sort((a, b) => a.financeGap - b.financeGap)
      .slice(0, 20);

    if (!competitive.length) return "No highly competitive races found matching the criteria.";

    const lines = ["Most competitive races (challenger leading or gap < $100K):"];
    for (const r of competitive.slice(0, 8)) {
      const direction = r.challengerLeading ? "challenger leading" : "close";
      lines.push(`  ${r.raceKey}: ${r.incumbentName} vs ${r.topChallengerName} — ${direction}`);
      lines.push(`    Inc: $${(r.incumbentReceipts / 1000).toFixed(0)}K | Chal: $${(r.topChallengerReceipts / 1000).toFixed(0)}K`);
    }
    return `${lines.join("\n")}\n\nSTRUCTURED_DATA:${JSON.stringify({ comparisons: competitive })}`;
  },
};

// ---------------------------------------------------------------------------
// build_candidate_profile
// ---------------------------------------------------------------------------

export const getCandidateProfileAction: Action<{ race_key: string }> = {
  name: "build_candidate_profile",
  description:
    "Get full candidate profiles for a race including photos, Ballotpedia URLs, official websites, " +
    "and committee memberships. Use after get_race_brief for richer candidate display.",
  parameters: [
    { name: "race_key", type: "string", description: "Race key, e.g. '2026-H-WI-04'.", required: true },
  ],
  handler: async ({ race_key }) => {
    const db = await getDb();

    const rawCands = await db.collection("candidates").find({ race_key }, {
      projection: {
        _id: 0, candidate_id: 1, name: 1, party: 1, incumbent_challenge_status: 1,
        ballotpedia_profile_url: 1, official_government_website: 1, official_campaign_website: 1,
      },
    }).toArray();

    if (!rawCands.length) return `No candidates found for ${race_key}.`;

    const profileDocs = await db
      .collection("legislator_profiles")
      .find({ name: { $in: rawCands.map((c) => c.name as string) } })
      .toArray();

    const profileMap = Object.fromEntries(profileDocs.map((p) => [p.name as string, p]));

    const candidates = rawCands.map((c) => {
      const profile = profileMap[c.name as string];
      const bioguideId = (profile?.bioguide_id as string) ?? null;
      const photoUrl = bioguideId
        ? bioguidePhotoUrl(bioguideId)!
        : placeholderAvatarUrl(c.name as string, c.party as string);
      return {
        candidateId: c.candidate_id,
        name: c.name,
        party: c.party,
        status: (c.incumbent_challenge_status as string) ?? "unknown",
        photoUrl,
        photoSource: bioguideId ? "bioguide" : "placeholder",
        raceKey: race_key,
        ballotpediaUrl: (c.ballotpedia_profile_url as string) ?? null,
        officialWebsite: (c.official_government_website as string) ?? (profile?.official_website as string) ?? null,
        campaignWebsite: (c.official_campaign_website as string) ?? null,
        committees: (profile?.committees as string[]) ?? [],
      };
    });

    const lines = [`Full candidate profiles for ${race_key}:`];
    for (const c of candidates) {
      lines.push(`  ${c.name} (${c.party}, ${c.status})`);
      if (c.officialWebsite) lines.push(`    Official: ${c.officialWebsite}`);
      if (c.ballotpediaUrl) lines.push(`    Ballotpedia: ${c.ballotpediaUrl}`);
    }
    return `${lines.join("\n")}\n\nSTRUCTURED_DATA:${JSON.stringify({ candidates })}`;
  },
};

// ---------------------------------------------------------------------------
// search_candidate_positions
// ---------------------------------------------------------------------------

export const searchCandidatePositionsAction: Action<{ candidate_name: string; issue: string }> = {
  name: "search_candidate_positions",
  description:
    "Search the open web for what a specific candidate has publicly said about a policy issue. " +
    "Use when the user asks about a candidate's stance on housing, climate, healthcare, immigration, or any other topic.",
  parameters: [
    { name: "candidate_name", type: "string", description: "Full candidate name.", required: true },
    { name: "issue", type: "string", description: "Policy issue, e.g. 'housing affordability'.", required: true },
  ],
  handler: async ({ candidate_name, issue }) => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    try {
      const res = await fetch(`${baseUrl}/api/search/positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateName: candidate_name, issue }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return `Position search failed for ${candidate_name} on ${issue}.`;
      const data = await res.json();
      const sourceLines = (data.sources ?? []).slice(0, 3).map(
        (s: { title: string; url: string; date: string | null }, i: number) =>
          `[${i + 1}] ${s.title} — ${s.url}`
      );
      return `${data.answer ?? "No answer returned."}\n\nSources:\n${sourceLines.join("\n")}\n\nSTRUCTURED_DATA:${JSON.stringify({ positions: [{ candidateName: candidate_name, issue, answer: data.answer, sources: data.sources }] })}`;
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      return isTimeout
        ? `Position search timed out for ${candidate_name} — try again.`
        : `Position search failed for ${candidate_name} on ${issue}.`;
    }
  },
};

// ---------------------------------------------------------------------------
// search_current_news
// ---------------------------------------------------------------------------

export const searchCurrentNewsAction: Action<{ candidate_name: string }> = {
  name: "search_current_news",
  description:
    "Search recent news (last 7 days) about a specific candidate. " +
    "Use when the user asks about current events, recent statements, or what's happening with a candidate.",
  parameters: [
    { name: "candidate_name", type: "string", description: "Full candidate name.", required: true },
  ],
  handler: async ({ candidate_name }) => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    try {
      const res = await fetch(`${baseUrl}/api/search/news`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateName: candidate_name }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return `News search failed for ${candidate_name}.`;
      const data = await res.json();
      return `${data.answer ?? ""}\n\nSTRUCTURED_DATA:${JSON.stringify({ news: data.sources })}`;
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      return isTimeout
        ? `News search timed out for ${candidate_name} — try again.`
        : `News search failed for ${candidate_name}.`;
    }
  },
};

// ---------------------------------------------------------------------------
// get_election_dates
// ---------------------------------------------------------------------------

export const getElectionDatesAction: Action<{ state_code: string }> = {
  name: "get_election_dates",
  description:
    "Get 2026 primary date, general election date, and early voting information for a US state. " +
    "Essential for voters asking when they need to vote.",
  parameters: [
    { name: "state_code", type: "string", description: "Two-letter state code, e.g. 'WI'.", required: true },
  ],
  handler: async ({ state_code }) => {
    const state = state_code.toUpperCase().trim();
    const db = await getDb();
    const record = await db.collection("election_dates").findOne(
      { state_abbreviation: state },
      { projection: { _id: 0, state: 1, primary: 1, general_election_date: 1, general_early_in_person_voting: 1 } }
    );
    if (!record) return `No election date data for ${state}.`;

    const primary = (record.primary as Record<string, string>)?.date ?? "Not available";
    const runoff = (record.primary as Record<string, string>)?.runoff_date_if_necessary ?? null;
    const general = (record.general_election_date as string) ?? "2026-11-03";
    const earlyVoting = record.general_early_in_person_voting as Record<string, string> | null;
    const earlyStart = earlyVoting?.computed_start_date ?? null;
    const earlyEnd = earlyVoting?.computed_end_date ?? null;
    const earlyRule = earlyVoting?.rule_text ?? null;

    const lines = [
      `2026 Election Dates for ${(record.state as string) ?? state}:`,
      `  Primary: ${primary}${runoff ? ` (Runoff if needed: ${runoff})` : ""}`,
      `  General Election: ${general}`,
    ];
    if (earlyStart && earlyEnd) {
      lines.push(`  Early Voting: ${earlyStart} through ${earlyEnd}`);
    } else if (earlyRule) {
      lines.push(`  Early Voting: ${earlyRule}`);
    }
    lines.push("Source: NCSL, FEC, Vote.org (2026). Confirm with your state's election authority.");
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
  getStateRacesAction,
  findCompetitiveRacesAction,
  getCandidateProfileAction,
  searchCandidatePositionsAction,
  searchCurrentNewsAction,
  getElectionDatesAction,
];
