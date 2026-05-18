import { NextResponse } from "next/server";
import { requireMutateRole } from "@/lib/auth/mutation-guard";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { LINE_INBOX_MESSAGES_TABLE, markLineInboxMessageWorkflowConfirmed } from "@/lib/line-inbox/line-inbox-messages";
import type { DuplicateStatus, LineInboxAnalyzeItem, LineInboxAnalyzeResponse } from "@/lib/line-inbox/types";
import { formatZodIssues, lineInboxPendingSaveBodySchema } from "@/lib/line-inbox/api-schemas";
import { persistLineInboxConfirmations } from "@/lib/line-inbox/persist-line-inbox-confirm";

export const dynamic = "force-dynamic";

function isAnalyzePayload(body: unknown): body is LineInboxAnalyzeResponse {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  return Boolean(o.detected_car && typeof o.detected_car === "object" && Array.isArray(o.items));
}

/**
 * POST /api/line-inbox/pending-save
 * Create order_items from queued webhook messages (new lines only, user-selected indices).
 */
export async function POST(request: Request) {
  const gate = await requireMutateRole();
  if (!gate.ok) return gate.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = lineInboxPendingSaveBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodIssues(parsed.error) }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const results: Array<{ inbox_message_id: string; saved_count: number; order_task_id: string | null }> = [];

  try {
    for (const block of parsed.data.saves) {
      const inboxId = block.inbox_message_id;
      const { data: row, error: selErr } = await supabase
        .from(LINE_INBOX_MESSAGES_TABLE)
        .select("id,workflow_status,analyze_payload,car_row_id")
        .eq("id", inboxId)
        .maybeSingle();

      if (selErr) throw new Error(selErr.message);
      if (!row) throw new Error(`inbox_message ${inboxId} not found`);
      if (String((row as { workflow_status?: unknown }).workflow_status) !== "pending") {
        throw new Error(`inbox_message ${inboxId} is not pending`);
      }

      const payloadRaw = (row as { analyze_payload?: unknown }).analyze_payload;
      if (!isAnalyzePayload(payloadRaw)) {
        throw new Error(`inbox_message ${inboxId} has no analyze payload`);
      }

      const items = payloadRaw.items ?? [];
      const actionable = [];
      for (const idx of block.item_indices) {
        const item = items[idx] as LineInboxAnalyzeItem | undefined;
        if (!item) throw new Error(`Invalid item index ${idx} for inbox ${inboxId}`);
        if ((item.duplicate_status as DuplicateStatus) !== "new") {
          throw new Error(`Only new lines can be saved from queue · index ${idx}`);
        }
        actionable.push({
          action: "create" as const,
          item_name: String(item.suggested_item_name ?? item.raw_text ?? "").trim() || item.raw_text,
          item_status: item.suggested_status || undefined,
          note: undefined as string | undefined,
        });
      }

      if (actionable.length === 0) continue;

      const crFromPayload = String(payloadRaw.detected_car?.car_row_id ?? "").trim();
      const crFromRow = String((row as { car_row_id?: unknown }).car_row_id ?? "").trim();
      const car_row_id = crFromPayload || crFromRow;
      if (!car_row_id) {
        throw new Error(
          `ข้อความนี้ยังจับคู่รถไม่ได้ — แก้ในหน้าเดิมหรือรอข้อความที่มีทะเบียน/เลขถังชัด · inbox ${inboxId}`
        );
      }

      const { order_task_id, saved } = await persistLineInboxConfirmations(supabase, {
        car_row_id,
        car_id: null,
        actionable,
        line_inbox_msg_ref_for_audit: inboxId,
      });

      if (saved.length > 0) {
        await markLineInboxMessageWorkflowConfirmed(supabase, inboxId);
      }

      results.push({
        inbox_message_id: inboxId,
        saved_count: saved.length,
        order_task_id,
      });
    }

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
