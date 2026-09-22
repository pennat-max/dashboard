import { NextResponse } from "next/server";
import { getD1, getR2 } from "../../../../../../db";

export const dynamic = "force-dynamic";

const TABLES = new Set([
  "cars",
  "chat_history",
  "line_inbox_messages",
  "order_items",
  "order_storage_items",
  "order_task_updates",
  "order_tasks",
  "order_tracking_item_status_prefs",
  "order_tracking_photos",
  "order_tracking_staff_roster",
  "order_tracking_summary_cache",
]);

type JsonRow = Record<string, unknown>;
type MigrationBody =
  | { action: "table"; table: string; offset?: number; limit?: number }
  | { action: "profiles" }
  | { action: "storage"; prefix?: string; offset?: number; limit?: number }
  | { action: "storage-referenced"; offset?: number; limit?: number }
  | { action: "verify" };

function sourceConfig() {
  const url = String(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");
  if (!url || !key) throw new Error("Migration source is unavailable");
  return { url, key };
}

function authorize(request: Request): boolean {
  const configured = String(process.env.SITE_MIGRATION_SECRET ?? "");
  const supplied = request.headers.get("x-migration-secret") ?? "";
  return configured.length >= 32 && supplied === configured;
}

function safeInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function sourceHeaders(key: string): HeadersInit {
  return { apikey: key, authorization: `Bearer ${key}` };
}

function dbValue(value: unknown): string | number | null {
  if (value == null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "string") return value;
  return JSON.stringify(value);
}

function identifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Unsafe identifier: ${value}`);
  return `"${value}"`;
}

async function tableColumns(db: D1Database, table: string): Promise<Set<string>> {
  const out = await db.prepare(`PRAGMA table_info(${identifier(table)})`).all<{ name: string }>();
  return new Set((out.results ?? []).map((row) => row.name));
}

async function upsertRows(db: D1Database, table: string, rows: JsonRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const allowed = await tableColumns(db, table);
  const statements: D1PreparedStatement[] = [];

  for (const source of rows) {
    const row: JsonRow = { ...source };
    if (!row.id && table !== "cars" && table !== "chat_history" && table !== "order_tracking_summary_cache") {
      row.id = crypto.randomUUID();
    }
    const columns = Object.keys(row).filter((key) => allowed.has(key));
    if (columns.length === 0) continue;
    const primary = columns.includes("id") ? "id" : columns[0];
    const updateColumns = columns.filter((column) => column !== primary);
    const sql = [
      `INSERT INTO ${identifier(table)} (${columns.map(identifier).join(",")})`,
      `VALUES (${columns.map(() => "?").join(",")})`,
      `ON CONFLICT(${identifier(primary)}) DO UPDATE SET ${
        updateColumns.length > 0
          ? updateColumns.map((column) => `${identifier(column)}=excluded.${identifier(column)}`).join(",")
          : `${identifier(primary)}=excluded.${identifier(primary)}`
      }`,
    ].join(" ");
    statements.push(db.prepare(sql).bind(...columns.map((column) => dbValue(row[column]))));
  }

  for (let i = 0; i < statements.length; i += 40) {
    await db.batch(statements.slice(i, i + 40));
  }
  return statements.length;
}

async function migrateTable(body: Extract<MigrationBody, { action: "table" }>) {
  const table = String(body.table ?? "");
  if (!TABLES.has(table)) throw new Error("Table is not in the VIGO4U migration allowlist");
  const offset = safeInt(body.offset, 0, 0, 10_000_000);
  const limit = safeInt(body.limit, 250, 1, 500);
  const { url, key } = sourceConfig();
  const response = await fetch(
    `${url}/rest/v1/${table}?select=*&offset=${offset}&limit=${limit}`,
    { headers: { ...sourceHeaders(key), prefer: "count=exact" }, cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Source table ${table} returned ${response.status}`);
  const rows = (await response.json()) as JsonRow[];
  const inserted = await upsertRows(getD1(), table, rows);
  const contentRange = response.headers.get("content-range") ?? "";
  const totalMatch = contentRange.match(/\/(\d+)$/);
  return { table, offset, limit, fetched: rows.length, inserted, total: totalMatch ? Number(totalMatch[1]) : null, done: rows.length < limit };
}

async function migrateProfiles() {
  const { url, key } = sourceConfig();
  const [usersResponse, profilesResponse] = await Promise.all([
    fetch(`${url}/auth/v1/admin/users?page=1&per_page=1000`, { headers: sourceHeaders(key), cache: "no-store" }),
    fetch(`${url}/rest/v1/profiles?select=*`, { headers: sourceHeaders(key), cache: "no-store" }),
  ]);
  if (!usersResponse.ok || !profilesResponse.ok) throw new Error("Unable to export source users/profiles");
  const usersPayload = (await usersResponse.json()) as { users?: Array<{ id: string; email?: string; created_at?: string }> };
  const profileRows = (await profilesResponse.json()) as JsonRow[];
  const byId = new Map(profileRows.map((row) => [String(row.id ?? ""), row]));
  const rows = (usersPayload.users ?? []).filter((user) => user.id && user.email).map((user) => {
    const profile = byId.get(user.id) ?? {};
    return {
      id: user.id,
      legacy_user_id: user.id,
      email: String(user.email).toLowerCase(),
      role: Number(profile.role ?? 1),
      line_user_id: profile.line_user_id ?? null,
      created_at: profile.created_at ?? user.created_at ?? new Date().toISOString(),
      updated_at: profile.updated_at ?? new Date().toISOString(),
    };
  });
  return { fetched: rows.length, inserted: await upsertRows(getD1(), "profiles", rows) };
}

function encodeObjectPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function migrateStorage(body: Extract<MigrationBody, { action: "storage" }>) {
  const prefix = String(body.prefix ?? "").replace(/^\/+|\/+$/g, "");
  const offset = safeInt(body.offset, 0, 0, 10_000_000);
  const limit = safeInt(body.limit, 20, 1, 50);
  const { url, key } = sourceConfig();
  const listResponse = await fetch(`${url}/storage/v1/object/list/order-tracking-photos`, {
    method: "POST",
    headers: { ...sourceHeaders(key), "content-type": "application/json" },
    body: JSON.stringify({ prefix, limit, offset, sortBy: { column: "name", order: "asc" } }),
  });
  if (!listResponse.ok) throw new Error(`Storage list returned ${listResponse.status}`);
  const entries = (await listResponse.json()) as Array<{ id?: string | null; name?: string; metadata?: { mimetype?: string; cacheControl?: string } | null }>;
  const directories: string[] = [];
  let copied = 0;
  let skipped = 0;
  const bucket = getR2();

  for (const entry of entries) {
    const name = String(entry.name ?? "");
    if (!name) continue;
    const path = prefix ? `${prefix}/${name}` : name;
    if (!entry.id && entry.metadata == null) {
      directories.push(path);
      continue;
    }
    const existing = await bucket.head(path);
    if (existing) {
      skipped += 1;
      continue;
    }
    const objectResponse = await fetch(
      `${url}/storage/v1/object/authenticated/order-tracking-photos/${encodeObjectPath(path)}`,
      { headers: sourceHeaders(key), cache: "no-store" },
    );
    if (!objectResponse.ok || !objectResponse.body) throw new Error(`Storage object ${path} returned ${objectResponse.status}`);
    await bucket.put(path, objectResponse.body, {
      httpMetadata: {
        contentType: objectResponse.headers.get("content-type") ?? entry.metadata?.mimetype ?? "application/octet-stream",
        cacheControl: objectResponse.headers.get("cache-control") ?? entry.metadata?.cacheControl ?? "public, max-age=3600",
      },
      customMetadata: { migrated_from: "supabase", migrated_at: new Date().toISOString() },
    });
    copied += 1;
  }
  return { prefix, offset, limit, listed: entries.length, copied, skipped, directories, done: entries.length < limit };
}

function collectStoragePaths(value: unknown, paths: Set<string>, key = "") {
  if (value == null) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectStoragePaths(entry, paths, key);
    return;
  }
  if (typeof value === "object") {
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      collectStoragePaths(child, paths, childKey);
    }
    return;
  }
  if (typeof value !== "string") return;
  const candidate = value.trim().replace(/^\/+/, "");
  if (!candidate || candidate.includes("://")) return;
  if (
    key === "storage_path" ||
    key === "image_storage_path" ||
    /^(?:car|item|line-inbox)\//.test(candidate)
  ) paths.add(candidate);
}

async function referencedStoragePaths(): Promise<string[]> {
  const db = getD1();
  const paths = new Set<string>();
  const photoRows = await db.prepare("SELECT storage_path FROM order_tracking_photos WHERE storage_path IS NOT NULL").all<{ storage_path: string }>();
  for (const row of photoRows.results ?? []) collectStoragePaths(row.storage_path, paths, "storage_path");
  const inboxRows = await db.prepare("SELECT analyze_payload,image_storage_path FROM line_inbox_messages WHERE analyze_payload IS NOT NULL OR image_storage_path IS NOT NULL").all<{ analyze_payload: string | null; image_storage_path: string | null }>();
  for (const row of inboxRows.results ?? []) {
    collectStoragePaths(row.image_storage_path, paths, "image_storage_path");
    if (!row.analyze_payload) continue;
    try { collectStoragePaths(JSON.parse(row.analyze_payload), paths); } catch { /* ignore malformed legacy payload */ }
  }
  return [...paths].sort();
}

async function migrateReferencedStorage(body: Extract<MigrationBody, { action: "storage-referenced" }>) {
  const offset = safeInt(body.offset, 0, 0, 10_000_000);
  const limit = safeInt(body.limit, 25, 1, 50);
  const paths = await referencedStoragePaths();
  const selected = paths.slice(offset, offset + limit);
  const { url, key } = sourceConfig();
  const bucket = getR2();
  let copied = 0;
  const missing: string[] = [];
  const errors: Array<{ path: string; status: number }> = [];
  let cursor = 0;
  async function copyWorker() {
    for (;;) {
      const path = selected[cursor++];
      if (!path) return;
      const response = await fetch(
        `${url}/storage/v1/object/authenticated/order-tracking-photos/${encodeObjectPath(path)}`,
        { headers: sourceHeaders(key), cache: "no-store" },
      );
      if (response.status === 404) { missing.push(path); continue; }
      if (!response.ok || !response.body) {
        errors.push({ path, status: response.status });
        continue;
      }
      await bucket.put(path, response.body, {
        httpMetadata: {
          contentType: response.headers.get("content-type") ?? "application/octet-stream",
          cacheControl: response.headers.get("cache-control") ?? "public, max-age=3600",
        },
        customMetadata: { migrated_from: "supabase", migrated_at: new Date().toISOString() },
      });
      copied += 1;
    }
  }
  await Promise.all([copyWorker(), copyWorker(), copyWorker(), copyWorker(), copyWorker()]);
  return { offset, limit, referenced: paths.length, selected: selected.length, copied, missing, errors, done: offset + selected.length >= paths.length };
}

async function verify() {
  const db = getD1();
  const tableCounts: Record<string, number> = {};
  for (const table of [...TABLES, "profiles"]) {
    const row = await db.prepare(`SELECT count(*) AS count FROM ${identifier(table)}`).first<{ count: number }>();
    tableCounts[table] = Number(row?.count ?? 0);
  }
  let r2Count = 0;
  let cursor: string | undefined;
  do {
    const page = await getR2().list({ limit: 1000, cursor });
    r2Count += page.objects.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { tableCounts, r2Count };
}

export async function POST(request: Request) {
  if (!authorize(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: MigrationBody;
  try {
    body = (await request.json()) as MigrationBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const result = body.action === "table"
      ? await migrateTable(body)
      : body.action === "profiles"
        ? await migrateProfiles()
        : body.action === "storage"
          ? await migrateStorage(body)
          : body.action === "storage-referenced"
            ? await migrateReferencedStorage(body)
          : body.action === "verify"
            ? await verify()
            : null;
    if (!result) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("[site-migration]", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Migration failed" }, { status: 500 });
  }
}
