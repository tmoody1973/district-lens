/**
 * Import Ballotpedia race + candidate enrichment from the 2026 JSON snapshot.
 *
 * What this does:
 *   1. Upserts every race into `ballotpedia_races` collection (source of truth for
 *      candidate counts, incumbent bioguide IDs, Ballotpedia URLs)
 *   2. Enriches existing `candidates` docs with ballotpedia_profile_url,
 *      is_incumbent, official_government_website — matched by state + district + fuzzy name
 *   3. Enriches `races` with candidate_count and incumbent bioguide_id
 *
 * Usage:  node scripts/import_ballotpedia_races.mjs
 */

import { readFileSync } from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { MongoClient } = require("../web/node_modules/mongodb/lib/index.js");

const MONGODB_URI = process.env.MONGODB_URI ||
  "mongodb+srv://districtlens:UwPcDD9DkS98H7DdB9rH@districtlens.qgjxhfq.mongodb.net/districtlens?retryWrites=true&w=majority&appName=districtlens";

const JSON_PATH = process.env.JSON_PATH ||
  "/Users/tarikmoody/Downloads/us_2026_federal_midterm_races.json";

function normalizeDistrict(d) {
  if (!d || d === "0" || d === "at-large") return "00";
  return String(parseInt(d, 10)).padStart(2, "0");
}

function raceKey(stateAbbr, office, district) {
  const officeCode = office.toLowerCase().includes("senate") ? "S" : "H";
  const dist = officeCode === "S" ? "00" : normalizeDistrict(district);
  return `2026-${officeCode}-${stateAbbr}-${dist}`;
}

/** Normalize a candidate name for fuzzy matching.
 *  FEC stores "Last, First Middle" — Ballotpedia stores "First Last"
 */
function normalizeNameForMatch(name) {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").trim();
}

function lastFirstToFirstLast(name) {
  // "Carl, Jerry Lee, Jr" → "jerry lee carl jr"
  const parts = name.split(",").map((s) => s.trim());
  if (parts.length < 2) return normalizeNameForMatch(name);
  const [last, ...rest] = parts;
  return normalizeNameForMatch([...rest, last].join(" "));
}

async function run() {
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  console.log("Connected to MongoDB Atlas");

  const db = client.db("districtlens");
  const bpRaces = db.collection("ballotpedia_races");
  const racesCol = db.collection("races");
  const candidatesCol = db.collection("candidates");

  const raw = JSON.parse(readFileSync(JSON_PATH, "utf-8"));
  const races = raw.races ?? [];
  console.log(`Loaded ${races.length} races from JSON`);

  let racesUpserted = 0;
  let candidatesEnriched = 0;
  let racesEnriched = 0;
  let noMatch = 0;

  for (const race of races) {
    const key = raceKey(race.state_abbreviation, race.office, race.district);

    // 1. Upsert into ballotpedia_races
    await bpRaces.updateOne(
      { race_key: key },
      {
        $set: {
          race_key: key,
          race_id: race.race_id,
          office: race.office,
          election_year: race.election_year,
          election_date: race.election_date,
          state: race.state,
          state_abbreviation: race.state_abbreviation,
          district: race.district,
          race_type: race.race_type,
          candidate_count: race.candidate_count,
          incumbent: race.incumbent ?? null,
          candidates: race.candidates ?? [],
          imported_at: new Date().toISOString(),
        },
      },
      { upsert: true }
    );
    racesUpserted++;

    // 2. Enrich races collection with candidate_count + incumbent bioguide_id
    const raceUpdate = { candidate_count_bp: race.candidate_count };
    if (race.incumbent?.bioguide_id) {
      raceUpdate.incumbent_bioguide_id = race.incumbent.bioguide_id;
      raceUpdate.incumbent_name_bp = race.incumbent.name;
      raceUpdate.incumbent_official_url = race.incumbent.official_government_website ?? null;
    }
    const raceResult = await racesCol.updateOne({ race_key: key }, { $set: raceUpdate });
    if (raceResult.matchedCount > 0) racesEnriched++;

    // 3. Enrich candidates collection — match by state + district (race_key) + fuzzy name
    for (const cand of race.candidates ?? []) {
      const bpNameNorm = normalizeNameForMatch(cand.name);

      // Fetch all candidates in this race from our DB
      const dbCands = await candidatesCol
        .find({ race_key: key }, { projection: { _id: 1, name: 1 } })
        .toArray();

      let bestMatch = null;
      let bestScore = 0;

      for (const dbCand of dbCands) {
        const dbNorm = lastFirstToFirstLast(dbCand.name ?? "");
        // Simple token overlap score
        const bpTokens = new Set(bpNameNorm.split(/\s+/));
        const dbTokens = new Set(dbNorm.split(/\s+/));
        const intersection = [...bpTokens].filter((t) => dbTokens.has(t)).length;
        const union = new Set([...bpTokens, ...dbTokens]).size;
        const score = union > 0 ? intersection / union : 0;
        if (score > bestScore && score >= 0.4) {
          bestScore = score;
          bestMatch = dbCand;
        }
      }

      if (bestMatch) {
        const enrichment = {
          ballotpedia_profile_url: cand.ballotpedia_profile_url ?? null,
          is_incumbent_bp: cand.is_incumbent ?? false,
          bp_link_status: cand.link_status ?? null,
        };
        if (cand.official_campaign_website) {
          enrichment.official_campaign_website = cand.official_campaign_website;
        }
        if (cand.official_government_website) {
          enrichment.official_government_website = cand.official_government_website;
        }

        await candidatesCol.updateOne({ _id: bestMatch._id }, { $set: enrichment });
        candidatesEnriched++;
      } else {
        noMatch++;
      }
    }
  }

  console.log(`\n✅ Import complete:`);
  console.log(`  ballotpedia_races upserted: ${racesUpserted}`);
  console.log(`  races enriched:             ${racesEnriched}`);
  console.log(`  candidates enriched:        ${candidatesEnriched}`);
  console.log(`  candidates no match:        ${noMatch}`);

  await client.close();
}

run().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
