import { NextResponse } from "next/server";
import { getD1 } from "../../../../../db";
import { getChatGPTUser } from "@/lib/auth/chatgpt-auth";

export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = new Set(["pending", "checking", "ordered", "outside", "to_send", "working", "done", "blocked", "cancelled"]);

type StatusBody = {
  item_key?: unknown;
  group_key?: unknown;
  inbox_id?: unknown;
  car_row_id?: unknown;
  item_index?: unknown;
  item_label?: unknown;
  status?: unknown;
  note?: unknown;
  actor?: {
    source?: unknown;
    id?: unknown;
    name?: unknown;
    email?: unknown;
  };
};

type ExistingStatusRow = {
  status: string | null;
};

function clean(value: unknown, max = 500): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function nullable(value: unknown, max = 500): string | null {
  const out = clean(value, max);
  return out || null;
}

function intOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
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
    db.prepare(`CREATE INDEX IF NOT EXISTS line_job_event_group_idx ON line_job_item_status_events (group_key)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS line_job_event_changed_idx ON line_job_item_status_events (changed_at)`),
  ]);
}

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as StatusBody;
    const itemKey = clean(body.item_key, 1200);
    const groupKey = clean(body.group_key, 1200);
    const status = clean(body.status, 60);
    if (!itemKey || !groupKey) {
      return NextResponse.json({ error: "Missing item_key or group_key" }, { status: 400 });
    }
    if (!ALLOWED_STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const actorSource = clean(body.actor?.source, 80) || "chatgpt_site";
    const actorId = nullable(body.actor?.id, 255) || user.id;
    const actorName = nullable(body.actor?.name, 255) || user.fullName || user.email;
    const actorEmail = nullable(body.actor?.email, 255) || user.email;
    const inboxId = nullable(body.inbox_id, 255);
    const carRowId = nullable(body.car_row_id, 255);
    const itemIndex = intOrNull(body.item_index);
    const itemLabel = nullable(body.item_label, 500);
    const note = nullable(body.note, 1000);
    const db = getD1();
    await ensureLineJobStatusTables(db);

    const existing = await db
      .prepare("SELECT status FROM line_job_item_statuses WHERE item_key = ?")
      .bind(itemKey)
      .first<ExistingStatusRow>();
    const oldStatus = existing?.status ?? null;

    await db.batch([
      db
        .prepare(`INSERT INTO line_job_item_statuses (
          item_key, group_key, inbox_id, car_row_id, item_index, item_label, status, note,
          updated_at, updated_by_source, updated_by_id, updated_by_name, updated_by_email
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_key) DO UPDATE SET
          group_key = excluded.group_key,
          inbox_id = excluded.inbox_id,
          car_row_id = excluded.car_row_id,
          item_index = excluded.item_index,
          item_label = excluded.item_label,
          status = excluded.status,
          note = excluded.note,
          updated_at = excluded.updated_at,
          updated_by_source = excluded.updated_by_source,
          updated_by_id = excluded.updated_by_id,
          updated_by_name = excluded.updated_by_name,
          updated_by_email = excluded.updated_by_email`)
        .bind(itemKey, groupKey, inboxId, carRowId, itemIndex, itemLabel, status, note, now, actorSource, actorId, actorName, actorEmail),
      db
        .prepare(`INSERT INTO line_job_item_status_events (
          id, item_key, group_key, inbox_id, car_row_id, item_index, item_label,
          old_status, new_status, changed_at, changed_by_source, changed_by_id,
          changed_by_name, changed_by_email, client_context
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          crypto.randomUUID(),
          itemKey,
          groupKey,
          inboxId,
          carRowId,
          itemIndex,
          itemLabel,
          oldStatus,
          status,
          now,
          actorSource,
          actorId,
          actorName,
          actorEmail,
          JSON.stringify({
            server_user_id: user.id,
            server_user_email: user.email,
            client_actor_source: actorSource,
          })
        ),
    ]);

    return NextResponse.json({
      ok: true,
      status: {
        item_key: itemKey,
        group_key: groupKey,
        inbox_id: inboxId,
        car_row_id: carRowId,
        item_index: itemIndex,
        item_label: itemLabel,
        status,
        note,
        updated_at: now,
        updated_by_source: actorSource,
        updated_by_id: actorId,
        updated_by_name: actorName,
        updated_by_email: actorEmail,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
