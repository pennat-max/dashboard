import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/site/data";
import { LINE_INBOX_MESSAGES_TABLE } from "@/lib/line-inbox/line-inbox-messages";
import { authorizeLineN8nRequest, lineN8nRuntimeFlags } from "@/lib/n8n/line-inbox-auth";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(value: string | null): number {
  const n = Number(value ?? DEFAULT_LIMIT);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function preview(value: unknown): string {
  const text = clean(value);
  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}

export async function GET(request: Request) {
  const auth = authorizeLineN8nRequest(request);
  if (auth) return auth;

  const url = new URL(request.url);
  const limit = clampLimit(url.searchParams.get("limit"));
  const analyzeStatus = clean(url.searchParams.get("analyze_status")) || "pending";
  const workflowStatus = clean(url.searchParams.get("workflow_status")) || "pending";
  const supabase = createServiceRoleClient();

  let query = supabase
    .from(LINE_INBOX_MESSAGES_TABLE)
    .select(
      "id,line_message_id,received_at,source_type,workflow_status,analyze_status,analyze_error,needs_human_review,car_row_id,raw_text,analyze_payload"
    )
    .eq("workflow_status", workflowStatus)
    .order("received_at", { ascending: false })
    .limit(limit);

  if (analyzeStatus !== "all") query = query.eq("analyze_status", analyzeStatus);

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const messages = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const payload = row.analyze_payload && typeof row.analyze_payload === "object"
      ? (row.analyze_payload as Record<string, unknown>)
      : null;
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return {
      inbox_id: clean(row.id),
      line_message_id: clean(row.line_message_id),
      received_at: clean(row.received_at),
      source_type: clean(row.source_type),
      workflow_status: clean(row.workflow_status),
      analyze_status: clean(row.analyze_status),
      analyze_error: preview(row.analyze_error),
      needs_human_review: Boolean(row.needs_human_review),
      car_row_id: clean(row.car_row_id),
      raw_text_preview: preview(row.raw_text),
      analyzed_item_count: items.length,
    };
  });

  return NextResponse.json({
    ok: true,
    flags: lineN8nRuntimeFlags(),
    limit,
    workflow_status: workflowStatus,
    analyze_status: analyzeStatus,
    count: messages.length,
    messages,
  });
}
