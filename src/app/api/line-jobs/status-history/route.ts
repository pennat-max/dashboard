import { NextResponse } from "next/server";
import { getD1 } from "../../../../../db";
import { getChatGPTUser } from "@/lib/auth/chatgpt-auth";

export const dynamic = "force-dynamic";

type StatusEventRow = {
  id: string;
  item_key: string;
  item_label: string | null;
  old_status: string | null;
  new_status: string;
  changed_at: string;
  changed_by_source: string;
  changed_by_id: string | null;
  changed_by_name: string | null;
  changed_by_email: string | null;
};

function clean(value: unknown, max = 500): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function ensureLineJobStatusEventTable(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS line_job_item_status_events (
      id text PRIMARY KEY NOT NULL,
      item_key text NOT NULL,
      group_key text NOT NULL,
      inbox_id text,
      car_row_id text,
      item_index integer,
      item_label text,
      old_status text,
      new_status text NOT NULL,
      changed_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      changed_by_source text DEFAULT 'chatgpt_site' NOT NULL,
      changed_by_id text,
      changed_by_name text,
      changed_by_email text,
      client_context text
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS line_job_event_item_idx ON line_job_item_status_events (item_key)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS line_job_event_changed_idx ON line_job_item_status_events (changed_at)`),
  ]);
}

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const itemKey = clean((body as { item_key?: unknown }).item_key, 1200);
    if (!itemKey) return NextResponse.json({ error: "Missing item_key" }, { status: 400 });

    const db = getD1();
    await ensureLineJobStatusEventTable(db);
    const result = await db
      .prepare(`SELECT id, item_key, item_label, old_status, new_status, changed_at, changed_by_source, changed_by_id, changed_by_name, changed_by_email
        FROM line_job_item_status_events
        WHERE item_key = ?
        ORDER BY changed_at DESC
        LIMIT 50`)
      .bind(itemKey)
      .all<StatusEventRow>();

    return NextResponse.json({ ok: true, events: result.results ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
