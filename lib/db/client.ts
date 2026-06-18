import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.ts";

let cachedDb: NodePgDatabase<typeof schema> | null | undefined;

export function isAuthDbConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getDb() {
  if (typeof cachedDb !== "undefined") {
    return cachedDb;
  }

  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    cachedDb = null;
    return cachedDb;
  }

  const pool = new Pool({ connectionString });
  cachedDb = drizzle(pool, { schema });
  return cachedDb;
}
