import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/site/data";
import { LINE_INBOX_MESSAGES_TABLE } from "@/lib/line-inbox/line-inbox-messages";
import {
  authorizeLineN8nRequest,
  lineN8nAuditHeaders,
  lineN8nRuntimeFlags,
} from "@/lib/n8n/line-inbox-auth";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

type ReplayBody = {
  limit?: unknown;
  dry_run?: unknown;
};

function clampLimit(value: unknown): number {
  const n = Number(value ?? DEFAULT_LIMIT);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

function boolValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return fallback;
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function readBody(request: Request): Promise<ReplayBody> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return {};
  try {
    return (await request.json()) as ReplayBody;
  } catch {
    return {};
  }
}

export async function POST(request: Request) {
  const auth = authorizeLineN8nRequest(request);
  if (auth) return auth;

  const flags = lineN8nRuntimeFlags();
  const body = await readBody(request);
  const dryRun = boolValue(body.dry_run, flags.dry_run);
  const limit = clampLimit(body.limit);
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from(LINE_INBOX_MESSAGES_TABLE)
    .select("id,line_message_id,received_at,analyze_error,raw_text")
    .eq("workflow_status", "pending")
    .eq("analyze_status", "error")
    .order("received_at", { ascending: true })
    .limit(limit);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    inbox_id: clean(row.id),
    line_message_id: clean(row.line_message_id),
    received_at: clean(row.received_at),
    analyze_error: clean(row.analyze_error).slice(0, 300),
    raw_text_preview: clean(row.raw_text).slice(0, 220),
  }));

  if (dryRun || rows.length === 0) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      replay_count: rows.length,
      messages: rows,
      audit: lineN8nAuditHeaders(request),
    });
  }

  const ids = rows.map((row) => row.inbox_id).filter(Boolean);
  const update = await supabase
    .from(LINE_INBOX_MESSAGES_TABLE)
    .update({
      analyze_status: "pending",
      analyze_error: null,
      updated_at: new Date().toISOString(),
    })
    .in("id", ids)
    .eq("workflow_status", "pending")
    .eq("analyze_status", "error")
    .select("id");

  if (update.error) return NextResponse.json({ ok: false, error: update.error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    dry_run: false,
    replay_count: (update.data ?? []).length,
    messages: rows,
    audit: lineN8nAuditHeaders(request),
  });
}
