/**
 * Shared MongoDB client for Next.js server components and API routes.
 * Explicit connect() so topology errors on cold starts don't poison the singleton.
 * On any topology/connection error the client is nulled so the next call reconnects.
 */

import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI ?? "";

let client: MongoClient | null = null;
let connectPromise: Promise<MongoClient> | null = null;

async function getClient(): Promise<MongoClient> {
  if (client) return client;
  if (!connectPromise) {
    const c = new MongoClient(uri);
    connectPromise = c.connect().then(() => {
      client = c;
      connectPromise = null;
      return c;
    }).catch((err) => {
      connectPromise = null;
      throw err;
    });
  }
  return connectPromise;
}

export async function getDb(): Promise<Db> {
  if (!uri) throw new Error("MONGODB_URI not configured");
  try {
    const c = await getClient();
    return c.db("districtlens");
  } catch (err) {
    client = null;
    connectPromise = null;
    throw err;
  }
}

export function fmtMoney(val: number | undefined | null): string {
  if (val == null) return "not reported";
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

export async function getFinanceSummaries(candidateIds: string[]) {
  const db = await getDb();
  return db
    .collection("finance_summaries")
    .find(
      { candidate_id: { $in: candidateIds } },
      {
        projection: {
          _id: 0,
          candidate_id: 1,
          receipts: 1,
          disbursements: 1,
          cash_on_hand: 1,
          individual_contributions: 1,
          pac_contributions: 1,
          coverage_end_date: 1,
        },
      }
    )
    .toArray();
}
