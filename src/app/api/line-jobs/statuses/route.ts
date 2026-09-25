import { NextResponse } from "next/server";
import { getD1 } from "../../../../../db";

export const dynamic = "force-dynamic";

type StatusRow = {
  item_key: string;
  group_key: string;
  inbox_id: string | null;
  car_row_id: string | null;
  item_index: number | null;
  item_label: string | null;
  status: string;
  note: string | null;
  updated_at: string;
  updated_by_source: string;
  updated_by_id: string | null;
  updated_by_name: string | null;
  updated_by_email: string | null;
};

function clean(value: unknown, max = 500): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function uniqueKeys(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => clean(value, 1200)).filter(Boolean))).slice(0, 500);
}

async function ensureLineJobStatusTables(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS line_job_item_statuses (
      item_key text PRIMARY KEY NOT NULL,
      group_key text NOT NULL,
      inbox_id text,
      car_row_id text,
      item_index integer,
      item_label text,
      status text DEFAULT 'pending' NOT NULL,
      note text,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_by_source text DEFAULT 'chatgpt_site' NOT NULL,
      updated_by_id text,
      updated_by_name text,
      updated_by_email text
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS line_job_status_group_idx ON line_job_item_statuses (group_key)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS line_job_status_car_idx ON line_job_item_statuses (car_row_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS line_job_status_updated_idx ON line_job_item_statuses (updated_at)`),
  ]);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const keys = uniqueKeys((body as { item_keys?: unknown }).item_keys);
    if (!keys.length) return NextResponse.json({ ok: true, statuses: {} });

    const db = getD1();
    await ensureLineJobStatusTables(db);

    const statuses: Record<string, StatusRow> = {};
    for (let i = 0; i < keys.length; i += 80) {
      const chunk = keys.slice(i, i + 80);
      const placeholders = chunk.map(() => "?").join(",");
      const result = await db
        .prepare(`SELECT * FROM line_job_item_statuses WHERE item_key IN (${placeholders})`)
        .bind(...chunk)
        .all<StatusRow>();
      for (const row of result.results ?? []) statuses[row.item_key] = row;
    }

    return NextResponse.json({ ok: true, statuses });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
