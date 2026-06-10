import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireMutateRole } from "@/lib/auth/mutation-guard";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  LINE_INBOX_MESSAGES_TABLE,
} from "@/lib/line-inbox/line-inbox-messages";
import { buildFallbackAnalyzeItemsFromRawText } from "@/lib/line-inbox/fallback-analyze-items";
import { buildFallbackAnalyzePayloadFromRawText } from "@/lib/line-inbox/fallback-analyze-payload";
import { classifyLineSendError, pushLineTextMessage, type LineSendErrorReason } from "@/lib/line/push-message";
import {
  buildLineApprovalAcknowledgementText,
  buildLineCarDisplayLabel,
  buildLineOrderReviewUrl,
  type LineApprovalAcknowledgementItem,
  type LineApprovalUpdatedAcknowledgementItem,
} from "@/lib/line-inbox/acknowledgement";
import type { DuplicateStatus, ExistingOrderItemRow, LineInboxAnalyzeItem, LineInboxAnalyzeResponse } from "@/lib/line-inbox/types";
import { formatZodIssues, lineInboxPendingSaveBodySchema } from "@/lib/line-inbox/api-schemas";
import {
  persistLineInboxConfirmations,
  type PersistConfirmRow,
  type PersistConfirmSavedItem,
} from "@/lib/line-inbox/persist-line-inbox-confirm";

export const dynamic = "force-dynamic";

const ORDER_ITEMS_TABLE = "order_items";

type AutoReplyResult = {
  enabled: boolean;
  attempted: boolean;
  sent: boolean;
  target_type?: "group" | "user";
  skipped_reason?: "disabled" | "missing_token" | "missing_target" | "unsupported_source" | "no_saved_items" | "line_error";
  error_reason?: LineSendErrorReason | "missing_token" | "missing_target" | "no_saved_items" | "disabled";
  error_status?: number;
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

function maskLineTarget(value: unknown): string {
  const raw = cleanLine(value);
  if (!raw) return "";
  if (raw.length <= 8) return `${raw.slice(0, 1)}...${raw.slice(-1)}`;
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

function isMissingDbColumnError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    (m.includes("column") && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes("column") && m.includes("schema cache"))
  );
}

function isActiveExistingItem(item: ExistingOrderItemRow): boolean {
  const status = cleanLine(item.status).toLowerCase();
  return !["done", "cancelled", "จบ"].includes(status);
}

async function claimPendingInboxForManualSave(
  supabase: ReturnType<typeof createServiceRoleClient>,
  inboxId: string
): Promise<void> {
  const { data, error } = await supabase
    .from(LINE_INBOX_MESSAGES_TABLE)
    .update({
      workflow_status: "confirmed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", inboxId)
    .eq("workflow_status", "pending")
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id) {
    throw new Error(`inbox_message ${inboxId} is no longer pending`);
  }
}

async function markPendingInboxSkipped(
  supabase: ReturnType<typeof createServiceRoleClient>,
  inboxId: string
): Promise<void> {
  const { data, error } = await supabase
    .from(LINE_INBOX_MESSAGES_TABLE)
    .update({
      workflow_status: "skipped",
      updated_at: new Date().toISOString(),
    })
    .eq("id", inboxId)
    .eq("workflow_status", "pending")
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id) {
    throw new Error(`inbox_message ${inboxId} is no longer pending`);
  }
}

function detectedCarTitle(payload: LineInboxAnalyzeResponse): string {
  const plate = cleanLine(payload.detected_car?.plate_text);
  const spec = cleanLine(payload.detected_car?.spec_text);
  const chassis = cleanLine(payload.detected_car?.chassis);
  return buildLineCarDisplayLabel({ plate, title: spec, fallback: chassis });
}

function reviewUrlForLineInbox(payload: LineInboxAnalyzeResponse, carRowId: string): string {
  return buildLineOrderReviewUrl({
    carRowId,
    plate: cleanLine(payload.detected_car?.plate_text) || detectedCarTitle(payload),
  });
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

function approvalItemFromSaved(item: PersistConfirmSavedItem): LineApprovalAcknowledgementItem {
  return {
    name: item.label,
    assignee: item.assignee_staff,
    status: item.status,
  };
}

function updatedApprovalItemFromSaved(item: PersistConfirmSavedItem): LineApprovalUpdatedAcknowledgementItem {
  return {
    name: item.label,
    beforeName: item.previous_label,
    beforeAssignee: item.previous_assignee_staff,
    beforeStatus: item.previous_status,
    afterAssignee: item.assignee_staff,
    afterStatus: item.status,
  };
}

function existingApprovalItemsFromPayloadForReply(
  payload: LineInboxAnalyzeResponse,
  saved: PersistConfirmSavedItem[]
): LineApprovalAcknowledgementItem[] {
  const changedIds = new Set(saved.map((item) => item.order_item_id).filter(Boolean));
  const createdNames = new Set(
    saved
      .filter((item) => item.action === "create")
      .map((item) => cleanLine(item.label).toLowerCase())
      .filter(Boolean)
  );
  return (payload.existing_items ?? [])
    .filter((item) => !changedIds.has(String(item.id ?? "")))
    .filter(isActiveExistingItem)
    .filter((item) => !createdNames.has(cleanLine(item.label).toLowerCase()))
    .map((item) => ({
      name: item.label,
      assignee: item.assignee_staff,
      status: item.status,
    }));
}

async function fetchExistingApprovalItemsForReply(
  supabase: SupabaseClient,
  orderTaskId: string,
  saved: PersistConfirmSavedItem[],
  payload: LineInboxAnalyzeResponse
): Promise<LineApprovalAcknowledgementItem[]> {
  const fallbackItems = existingApprovalItemsFromPayloadForReply(payload, saved);
  const taskId = cleanLine(orderTaskId);
  if (!taskId) return fallbackItems;

  const changedIds = new Set(saved.map((item) => item.order_item_id).filter(Boolean));
  try {
    const primaryQuery = await supabase
      .from(ORDER_ITEMS_TABLE)
      .select("id,label,status,assignee_staff")
      .eq("order_task_id", taskId);
    let data: unknown[] | null = primaryQuery.data;
    let error = primaryQuery.error;

    if (error && isMissingDbColumnError(error.message)) {
      const fallbackQuery = await supabase
        .from(ORDER_ITEMS_TABLE)
        .select("id,label,status")
        .eq("order_task_id", taskId);
      data = fallbackQuery.data;
      error = fallbackQuery.error;
    }

    if (error) {
      console.warn("[line-inbox] existing work reply section skipped", {
        order_task_id: taskId,
        error: cleanErrorForLog(error),
      });
      return fallbackItems;
    }

    return ((data ?? []) as ExistingOrderItemRow[])
      .filter((item) => !changedIds.has(String(item.id ?? "")))
      .filter(isActiveExistingItem)
      .map((item) => ({
        name: item.label,
        assignee: item.assignee_staff,
        status: item.status,
      }));
  } catch (error) {
    console.warn("[line-inbox] existing work reply section skipped", {
      order_task_id: taskId,
      error: cleanErrorForLog(error),
    });
    return fallbackItems;
  }
}

async function maybeSendApprovalAcknowledgement(params: {
  row: { source_type?: unknown; group_id?: unknown; user_id?: unknown };
  payload: LineInboxAnalyzeResponse;
  approvedItems: LineApprovalAcknowledgementItem[];
  createdItems: LineApprovalAcknowledgementItem[];
  updatedItems: LineApprovalUpdatedAcknowledgementItem[];
  existingItems: LineApprovalAcknowledgementItem[];
  reviewUrl: string;
}): Promise<{ autoReply: AutoReplyResult; replyText: string }> {
  const replyText = buildLineApprovalAcknowledgementText({
    carTitle: detectedCarTitle(params.payload),
    approvedItems: params.approvedItems,
    createdItems: params.createdItems,
    updatedItems: params.updatedItems,
    existingItems: params.existingItems,
    reviewUrl: params.reviewUrl,
  });

  if (!isAutoReplyAfterApproveEnabled()) {
    return {
      replyText,
      autoReply: { enabled: false, attempted: false, sent: false, skipped_reason: "disabled", error_reason: "disabled" },
    };
  }

  if (params.approvedItems.length === 0) {
    console.warn("[line-inbox] manual approval LINE acknowledgement not sent", {
      reason: "no_saved_items",
      enabled: true,
      attempted: false,
    });
    return {
      replyText,
      autoReply: { enabled: true, attempted: false, sent: false, skipped_reason: "no_saved_items", error_reason: "no_saved_items" },
    };
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() ?? "";
  if (!token) {
    console.warn("[line-inbox] manual approval LINE acknowledgement not sent", {
      reason: "missing_token",
      enabled: true,
      attempted: false,
    });
    return {
      replyText,
      autoReply: { enabled: true, attempted: false, sent: false, skipped_reason: "missing_token", error_reason: "missing_token" },
    };
  }

  const target = resolveLinePushTarget(params.row);
  if (!target) {
    console.warn("[line-inbox] manual approval LINE acknowledgement not sent", {
      reason: "missing_target",
      enabled: true,
      attempted: false,
      source_type: cleanLine(params.row.source_type) || null,
      group_id: maskLineTarget(params.row.group_id) || null,
      user_id: maskLineTarget(params.row.user_id) || null,
    });
    return {
      replyText,
      autoReply: { enabled: true, attempted: false, sent: false, skipped_reason: "missing_target", error_reason: "missing_target" },
    };
  }

  const sent = await pushLineTextMessage({
    accessToken: token,
    to: target.target,
    text: replyText,
  });

  if (!sent.ok) {
    const errorReason = classifyLineSendError(sent.status, sent.error);
    console.warn("[line-inbox] manual approval LINE acknowledgement not sent", {
      reason: errorReason,
      enabled: true,
      attempted: true,
      target_type: target.targetType,
      target: maskLineTarget(target.target),
      status: sent.status ?? null,
      error: cleanErrorForLog(sent.error),
    });
    return {
      replyText,
      autoReply: {
        enabled: true,
        attempted: true,
        sent: false,
        target_type: target.targetType,
        skipped_reason: "line_error",
        error_reason: errorReason,
        error_status: sent.status,
        error: sent.error,
      },
    };
  }

  console.info("[line-inbox] manual approval LINE acknowledgement sent", {
    target_type: target.targetType,
    target: maskLineTarget(target.target),
  });

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
    saved_items: Array<{
      item_index: number;
      order_item_id: string;
      label: string;
      action: string;
      status: string;
      assignee_staff: string;
    }>;
    reply_text?: string;
    copy_ready_reply_text?: string;
    copyReadyReplyText?: string;
    auto_reply?: AutoReplyResult;
    autoReply?: AutoReplyResult;
  }> = [];

  try {
    for (const block of parsed.data.saves) {
      const inboxId = block.inbox_message_id;
      const { data: row, error: selErr } = await supabase
        .from(LINE_INBOX_MESSAGES_TABLE)
        .select("id,workflow_status,raw_text,analyze_payload,car_row_id,source_type,group_id,user_id")
        .eq("id", inboxId)
        .maybeSingle();

      if (selErr) throw new Error(selErr.message);
      if (!row) throw new Error(`inbox_message ${inboxId} not found`);
      if (String((row as { workflow_status?: unknown }).workflow_status) !== "pending") {
        throw new Error(`inbox_message ${inboxId} is not pending`);
      }

      if (block.skip_all) {
        await markPendingInboxSkipped(supabase, inboxId);
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
      const payload = isAnalyzePayload(payloadRaw)
        ? payloadRaw
        : await buildFallbackAnalyzePayloadFromRawText(supabase, {
            raw_text: (row as { raw_text?: unknown }).raw_text,
            car_row_id: (row as { car_row_id?: unknown }).car_row_id,
          });

      const crFromPayload = String(payload.detected_car?.car_row_id ?? "").trim();
      const crFromRow = String((row as { car_row_id?: unknown }).car_row_id ?? "").trim();
      const crFromManualSelection = String(block.selected_car_row_id ?? "").trim();
      const car_row_id = crFromManualSelection || crFromPayload || crFromRow;
      const items =
        (payload.items ?? []).length > 0
          ? payload.items ?? []
          : buildFallbackAnalyzeItemsFromRawText(
              (row as { raw_text?: unknown }).raw_text,
              payload.existing_items ?? [],
              Boolean(car_row_id)
            );
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
        await markPendingInboxSkipped(supabase, inboxId);
        results.push({
          inbox_message_id: inboxId,
          saved_count: 0,
          skipped: true,
          order_task_id: null,
          saved_items: [],
        });
        continue;
      }

      if (!car_row_id) {
        throw new Error(`This LINE inbox message is not matched to a car yet; inbox ${inboxId}`);
      }

      // Atomic duplicate/race guard shared with LINE auto-save: claim the inbox
      // row before writing order_items. The table currently supports only
      // pending/confirmed/skipped, so confirmed is the durable processing lock.
      await claimPendingInboxForManualSave(supabase, inboxId);

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

      const createdItems = saved.filter((item) => item.action === "create").map(approvalItemFromSaved);
      const updatedItems = saved.filter((item) => item.action === "merge").map(updatedApprovalItemFromSaved);
      const existingItems = await fetchExistingApprovalItemsForReply(supabase, order_task_id, saved, payload);
      const approvedItems: LineApprovalAcknowledgementItem[] = [
        ...createdItems,
        ...saved.filter((item) => item.action === "merge").map(approvalItemFromSaved),
      ];
      const reviewUrl = reviewUrlForLineInbox(payload, car_row_id);
      const autoReplyEnabled = isAutoReplyAfterApproveEnabled();
      let acknowledged: Awaited<ReturnType<typeof maybeSendApprovalAcknowledgement>> = {
        replyText: buildLineApprovalAcknowledgementText({
          carTitle: detectedCarTitle(payload),
          approvedItems,
          createdItems,
          updatedItems,
          existingItems,
          reviewUrl,
        }),
        autoReply: {
          enabled: autoReplyEnabled,
            attempted: false,
            sent: false,
            skipped_reason: approvedItems.length === 0 ? "no_saved_items" : autoReplyEnabled ? "line_error" : "disabled",
            error_reason: approvedItems.length === 0 ? "no_saved_items" : autoReplyEnabled ? "line_error" : "disabled",
          },
        };

      if (saved.length > 0) {
        try {
          acknowledged = await maybeSendApprovalAcknowledgement({
            row: row as { source_type?: unknown; group_id?: unknown; user_id?: unknown },
            payload,
            approvedItems,
            createdItems,
            updatedItems,
            existingItems,
            reviewUrl,
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
              error_reason: "line_error",
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
          status: item.status,
          assignee_staff: item.assignee_staff,
        })),
        reply_text: acknowledged.replyText,
        copy_ready_reply_text: acknowledged.replyText,
        copyReadyReplyText: acknowledged.replyText,
        auto_reply: acknowledged.autoReply,
        autoReply: acknowledged.autoReply,
      });
    }

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
