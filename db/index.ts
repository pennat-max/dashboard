import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable");
  return drizzle(env.DB, { schema });
}

export function getD1(): D1Database {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable");
  return env.DB;
}

export function getR2(): R2Bucket {
  if (!env.BUCKET) throw new Error("Cloudflare R2 binding `BUCKET` is unavailable");
  return env.BUCKET;
}
