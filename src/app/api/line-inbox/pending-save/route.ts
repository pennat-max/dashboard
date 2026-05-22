import { NextResponse } from "next/server";
import { requireMutateRole } from "@/lib/auth/mutation-guard";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  LINE_INBOX_MESSAGES_TABLE,
  markLineInboxMessageWorkflowConfirmed,
  markLineInboxMessageWorkflowSkipped,
} from "@/lib/line-inbox/line-inbox-messages";
import { pushLineTextMessage } from "@/lib/line/push-message";
import { buildLineApprovalAcknowledgementText } from "@/lib/line-inbox/acknowledgement";
import type { DuplicateStatus, LineInboxAnalyzeItem, LineInboxAnalyzeResponse } from "@/lib/line-inbox/types";
import { formatZodIssues, lineInboxPendingSaveBodySchema } from "@/lib/line-inbox/api-schemas";
import { persistLineInboxConfirmations, type PersistConfirmRow } from "@/lib/line-inbox/persist-line-inbox-confirm";

export const dynamic = "force-dynamic";

type AutoReplyResult = {
  enabled: boolean;
  attempted: boolean;
  sent: boolean;
  target_type?: "group" | "user";
  skipped_reason?: "disabled" | "missing_token" | "missing_target" | "unsupported_source" | "no_saved_items" | "line_error";
  error?: string;
};

function isAnalyzePayload(body: unknown): body is LineInboxAnalyzeResponse {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  return Boolean(o.detected_car && typeof o.detected_car === "object" && Array.isArray(o.items));
}

function displayNameForItem(item: LineInboxAnalyzeItem): string {
  return String(item.suggested_item_name ?? item.raw_text ?? "").trim() || String(item.raw_text ?? "").trim();
}

function isAutoReplyAfterApproveEnabled(): boolean {
  return /^(1|true|yes|on|enabled)$/i.test(process.env.LINE_AUTO_REPLY_AFTER_APPROVE_ENABLED?.trim() ?? "");
}

function cleanLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanErrorForLog(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  return raw.replace(/\s+/g, " ").trim().slice(0, 300) || "LINE acknowledgement failed";
}

function detectedCarTitle(payload: LineInboxAnalyzeResponse): string {
  const plate = cleanLine(payload.detected_car?.plate_text);
  const spec = cleanLine(payload.detected_car?.spec_text);
  const chassis = cleanLine(payload.detected_car?.chassis);
  if (plate && spec && !spec.toLowerCase().startsWith(plate.toLowerCase())) return `${plate} ${spec}`;
  return spec || plate || chassis;
}

function resolveLinePushTarget(row: {
  source_type?: unknown;
  group_id?: unknown;
  user_id?: unknown;
}): { target: string; targetType: "group" | "user" } | null {
  const sourceType = cleanLine(row.source_type).toLowerCase();
  if (sourceType === "group") {
    const groupId = cleanLine(row.group_id);
    return groupId ? { target: groupId, targetType: "group" } : null;
  }

  if (sourceType === "user" && process.env.LINE_ACCEPT_DM === "true") {
    const userId = cleanLine(row.user_id);
    return userId ? { target: userId, targetType: "user" } : null;
  }

  return null;
}

async function maybeSendApprovalAcknowledgement(params: {
  row: { source_type?: unknown; group_id?: unknown; user_id?: unknown };
  payload: LineInboxAnalyzeResponse;
  approvedItemLabels: string[];
}): Promise<{ autoReply: AutoReplyResult; replyText: string }> {
  const replyText = buildLineApprovalAcknowledgementText({
    carTitle: detectedCarTitle(params.payload),
    approvedItems: params.approvedItemLabels,
  });

  if (!isAutoReplyAfterApproveEnabled()) {
    return {
      replyText,
      autoReply: { enabled: false, attempted: false, sent: false, skipped_reason: "disabled" },
    };
  }

  if (params.approvedItemLabels.length === 0) {
    return {
      replyText,
      autoReply: { enabled: true, attempted: false, sent: false, skipped_reason: "no_saved_items" },
    };
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() ?? "";
  if (!token) {
    return {
      replyText,
      autoReply: { enabled: true, attempted: false, sent: false, skipped_reason: "missing_token" },
    };
  }

  const target = resolveLinePushTarget(params.row);
  if (!target) {
    return {
      replyText,
      autoReply: { enabled: true, attempted: false, sent: false, skipped_reason: "missing_target" },
    };
  }

  const sent = await pushLineTextMessage({
    accessToken: token,
    to: target.target,
    text: replyText,
  });

  if (!sent.ok) {
    return {
      replyText,
      autoReply: {
        enabled: true,
        attempted: true,
        sent: false,
        target_type: target.targetType,
        skipped_reason: "line_error",
        error: sent.error,
      },
    };
  }

  return {
    replyText,
    autoReply: {
      enabled: true,
      attempted: true,
      sent: true,
      target_type: target.targetType,
    },
  };
}

/**
 * POST /api/line-inbox/pending-save
 * Persist staff-approved queue actions. Webhook/analyze never calls this automatically.
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
  const results: Array<{
    inbox_message_id: string;
    saved_count: number;
    skipped: boolean;
    order_task_id: string | null;
    saved_items: Array<{ item_index: number; order_item_id: string; label: string; action: string }>;
    reply_text?: string;
    auto_reply?: AutoReplyResult;
  }> = [];

  try {
    for (const block of parsed.data.saves) {
      const inboxId = block.inbox_message_id;
      const { data: row, error: selErr } = await supabase
        .from(LINE_INBOX_MESSAGES_TABLE)
        .select("id,workflow_status,analyze_payload,car_row_id,source_type,group_id,user_id")
        .eq("id", inboxId)
        .maybeSingle();

      if (selErr) throw new Error(selErr.message);
      if (!row) throw new Error(`inbox_message ${inboxId} not found`);
      if (String((row as { workflow_status?: unknown }).workflow_status) !== "pending") {
        throw new Error(`inbox_message ${inboxId} is not pending`);
      }

      if (block.skip_all) {
        await markLineInboxMessageWorkflowSkipped(supabase, inboxId);
        results.push({
          inbox_message_id: inboxId,
          saved_count: 0,
          skipped: true,
          order_task_id: null,
          saved_items: [],
        });
        continue;
      }

      const payloadRaw = (row as { analyze_payload?: unknown }).analyze_payload;
      if (!isAnalyzePayload(payloadRaw)) {
        throw new Error(`inbox_message ${inboxId} has no analyze payload`);
      }

      const items = payloadRaw.items ?? [];
      const actionable: Array<PersistConfirmRow & { item_index: number }> = [];

      if (block.actions?.length) {
        for (const actionRow of block.actions) {
          const item = items[actionRow.item_index] as LineInboxAnalyzeItem | undefined;
          if (!item) throw new Error(`Invalid item index ${actionRow.item_index} for inbox ${inboxId}`);
          if (actionRow.action === "skip") continue;

          const itemName = String(actionRow.item_name ?? displayNameForItem(item)).trim();
          const orderItemId =
            String(actionRow.order_item_id ?? "").trim() || String(item.matched_order_item_id ?? "").trim();

          if (actionRow.action === "create" && !itemName) {
            throw new Error(`Missing item name for inbox ${inboxId} index ${actionRow.item_index}`);
          }
          if (actionRow.action === "merge" && !orderItemId) {
            throw new Error(`Missing order_item_id for merge on inbox ${inboxId} index ${actionRow.item_index}`);
          }

          actionable.push({
            item_index: actionRow.item_index,
            action: actionRow.action,
            order_item_id: actionRow.action === "merge" ? orderItemId : undefined,
            item_name: itemName,
            item_status: String(actionRow.item_status ?? item.suggested_status ?? "").trim() || undefined,
            note: String(actionRow.note ?? "").trim() || undefined,
            assignee_staff: String(actionRow.assignee_staff ?? "").trim() || undefined,
            due_date: String(actionRow.due_date ?? "").trim() || undefined,
          });
        }
      } else {
        for (const idx of block.item_indices ?? []) {
          const item = items[idx] as LineInboxAnalyzeItem | undefined;
          if (!item) throw new Error(`Invalid item index ${idx} for inbox ${inboxId}`);
          if ((item.duplicate_status as DuplicateStatus) !== "new") {
            throw new Error(`Only new lines can be saved from the legacy queue path; index ${idx}`);
          }
          actionable.push({
            item_index: idx,
            action: "create",
            item_name: displayNameForItem(item),
            item_status: item.suggested_status || undefined,
            note: undefined,
          });
        }
      }

      if (actionable.length === 0) {
        await markLineInboxMessageWorkflowSkipped(supabase, inboxId);
        results.push({
          inbox_message_id: inboxId,
          saved_count: 0,
          skipped: true,
          order_task_id: null,
          saved_items: [],
        });
        continue;
      }

      const crFromPayload = String(payloadRaw.detected_car?.car_row_id ?? "").trim();
      const crFromRow = String((row as { car_row_id?: unknown }).car_row_id ?? "").trim();
      const car_row_id = crFromPayload || crFromRow;
      if (!car_row_id) {
        throw new Error(`This LINE inbox message is not matched to a car yet; inbox ${inboxId}`);
      }

      const { order_task_id, saved } = await persistLineInboxConfirmations(supabase, {
        car_row_id,
        car_id: null,
        actionable: actionable.map((item) => ({
          action: item.action,
          order_item_id: item.order_item_id,
          item_name: item.item_name,
          item_status: item.item_status,
          note: item.note,
          assignee_staff: item.assignee_staff,
          due_date: item.due_date,
        })),
        line_inbox_msg_ref_for_audit: inboxId,
      });

      const approvedItemLabels = saved.map((item) => item.label);
      const autoReplyEnabled = isAutoReplyAfterApproveEnabled();
      let acknowledged: Awaited<ReturnType<typeof maybeSendApprovalAcknowledgement>> = {
        replyText: buildLineApprovalAcknowledgementText({
          carTitle: detectedCarTitle(payloadRaw),
          approvedItems: approvedItemLabels,
        }),
        autoReply: {
          enabled: autoReplyEnabled,
          attempted: false,
          sent: false,
          skipped_reason: approvedItemLabels.length === 0 ? "no_saved_items" : autoReplyEnabled ? "line_error" : "disabled",
        },
      };

      if (saved.length > 0) {
        // Duplicate-send guard: this endpoint rejects non-pending inbox rows above.
        // Marking confirmed before optional LINE push prevents the same approved
        // action from being submitted again and sending another acknowledgement,
        // without adding a schema/table marker.
        await markLineInboxMessageWorkflowConfirmed(supabase, inboxId);

        try {
          acknowledged = await maybeSendApprovalAcknowledgement({
            row: row as { source_type?: unknown; group_id?: unknown; user_id?: unknown },
            payload: payloadRaw,
            approvedItemLabels,
          });
        } catch (error) {
          const safeError = cleanErrorForLog(error);
          console.warn("[line-inbox] approval acknowledgement skipped", {
            inbox_message_id: inboxId,
            error: safeError,
          });
          acknowledged = {
            replyText: acknowledged.replyText,
            autoReply: {
              enabled: autoReplyEnabled,
              attempted: autoReplyEnabled,
              sent: false,
              skipped_reason: "line_error",
              error: safeError,
            },
          };
        }
      }

      results.push({
        inbox_message_id: inboxId,
        saved_count: saved.length,
        skipped: false,
        order_task_id,
        saved_items: saved.map((item, index) => ({
          item_index: actionable[index]?.item_index ?? -1,
          order_item_id: item.order_item_id,
          label: item.label,
          action: item.action,
        })),
        reply_text: acknowledged.replyText,
        auto_reply: acknowledged.autoReply,
      });
    }

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
