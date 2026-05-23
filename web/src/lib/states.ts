// Official, nonpartisan voter-logistics links.
//
// We deliberately use state-aware NATIONAL portals rather than hardcoding 50
// Secretary-of-State URLs: those rot quickly and guessing them risks sending a
// voter to a wrong/dead page. Each portal resolves the correct state flow once
// the voter confirms their state or address on the destination site.
//   - vote.gov     U.S. government registration portal (GSA)
//   - canivote.org National Association of Secretaries of State — registration, polling, deadlines
//   - vote411.org  League of Women Voters Education Fund — by-address full ballot
export const VOTE_GOV_URL = "https://vote.gov/";
export const CAN_I_VOTE_URL = "https://www.canivote.org/";
export const FULL_BALLOT_URL = "https://www.vote411.org/";

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

export interface VoterLinks {
  stateCode: string;
  stateName: string;
  registration: string;
  pollingAndDeadlines: string;
  fullBallot: string;
}

export function getVoterLinks(stateCode: string): VoterLinks {
  const code = stateCode.toUpperCase();
  return {
    stateCode: code,
    stateName: STATE_NAMES[code] ?? code,
    registration: VOTE_GOV_URL,
    pollingAndDeadlines: CAN_I_VOTE_URL,
    fullBallot: FULL_BALLOT_URL,
  };
}

// Race keys look like "2026-H-WI-04" or "2026-S-WI"; the state code is the third segment.
export function stateCodeFromRaceKey(raceKey: string | null): string | null {
  if (!raceKey) return null;
  const code = raceKey.split("-")[2];
  return code && code.length === 2 ? code.toUpperCase() : null;
}
