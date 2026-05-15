/**
 * Shared MongoDB client for Next.js server components and API routes.
 * Uses a module-level singleton so connections are reused across
 * warm serverless invocations.
 */

import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI ?? "";

let client: MongoClient | null = null;

export function getDb(): Db {
  if (!uri) throw new Error("MONGODB_URI not configured");
  if (!client) {
    client = new MongoClient(uri);
  }
  return client.db("districtlens");
}

export function fmtMoney(val: number | undefined | null): string {
  if (val == null) return "not reported";
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}
