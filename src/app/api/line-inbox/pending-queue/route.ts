import { NextResponse } from "next/server";
import { requireMutateRole } from "@/lib/auth/mutation-guard";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { LINE_INBOX_MESSAGES_TABLE } from "@/lib/line-inbox/line-inbox-messages";
import type {
  DuplicateStatus,
  ExistingOrderItemRow,
  LineInboxAnalyzeItem,
  LineInboxAnalyzeResponse,
  LineInboxAttachmentMeta,
} from "@/lib/line-inbox/types";

export const dynamic = "force-dynamic";

type PendingQueueNewLine = {
  item_index: number;
  raw_text: string;
  suggested_item_name: string;
  suggested_status: string;
  reason: string;
};

type PendingQueueActionLine = PendingQueueNewLine & {
  suggested_note: string;
  duplicate_status: DuplicateStatus;
  matched_order_item_id: string;
  matched_item_name: string;
  confidence: number;
  default_action: "create" | "merge" | "skip";
  included_by_default: boolean;
};

type PendingQueueAttachment = {
  inbox_id: string;
  line_message_id: string;
  url: string;
  file_name: string | null;
  mime_type: string | null;
  received_at: string;
  source_label: string;
  raw_text_preview: string;
  car_row_id: string;
  plate_display: string;
  car_title: string;
  sale: string;
  needs_human_review: boolean;
  status: "not_linked";
};

type PendingQueueMsg = {
  inbox_id: string;
  received_at: string;
  source_label: string;
  plate_display: string;
  car_title: string;
  car_row_id: string;
  sale: string;
  raw_text_preview: string;
  new_lines: PendingQueueNewLine[];
  new_line_count: number;
  action_lines: PendingQueueActionLine[];
  action_line_count: number;
  existing_items: ExistingOrderItemRow[];
  attachments: PendingQueueAttachment[];
  needs_human_review: boolean;
};

type PendingQueueGroup = {
  group_key: string;
  car_row_id: string;
  plate_display: string;
  car_title: string;
  sale: string;
  is_unresolved: boolean;
  total_action_lines: number;
  total_new_lines: number;
  existing_items: ExistingOrderItemRow[];
  attachments: PendingQueueAttachment[];
  messages: PendingQueueMsg[];
};

function isAnalyzePayload(body: unknown): body is LineInboxAnalyzeResponse {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  return Boolean(o.detected_car && typeof o.detected_car === "object" && Array.isArray(o.items));
}

function extractStoredAttachments(
  payload: LineInboxAnalyzeResponse,
  row: { id?: unknown; received_at?: unknown; source_type?: unknown; raw_text?: unknown; car_row_id?: unknown }
): PendingQueueAttachment[] {
  const inboxId = String(row.id ?? "").trim();
  const receivedAt = String(row.received_at ?? "");
  const crPayload = String(payload.detected_car?.car_row_id ?? "").trim();
  const crStored = String(row.car_row_id ?? "").trim();
  const carRowId = crPayload || crStored;
  const plateText = String(payload.detected_car?.plate_text ?? "").trim();
  const specText = String(payload.detected_car?.spec_text ?? "").trim();
  const carTitle = [plateText, specText].filter(Boolean).join(" ").trim();
  return (payload.line_attachments ?? [])
    .filter((attachment: LineInboxAttachmentMeta) => {
      return attachment.status === "stored" && Boolean(String(attachment.public_url ?? "").trim());
    })
    .map((attachment: LineInboxAttachmentMeta) => ({
      inbox_id: inboxId,
      line_message_id: String(attachment.line_message_id ?? attachment.id ?? "").trim(),
      url: String(attachment.public_url ?? "").trim(),
      file_name: attachment.file_name ?? null,
      mime_type: attachment.mime_type ?? null,
      received_at: receivedAt || attachment.captured_at || "",
      source_label: sourceLabel(row.source_type),
      raw_text_preview: String(row.raw_text ?? "").trim().slice(0, 120),
      car_row_id: carRowId,
      plate_display: plateText,
      car_title: carTitle,
      sale: String(payload.detected_car?.sale ?? "").trim(),
      needs_human_review: Boolean(payload.needs_human_review),
      status: "not_linked" as const,
    }))
    .filter((attachment) => attachment.inbox_id && attachment.line_message_id && attachment.url);
}

function queueItemDisplayName(item: LineInboxAnalyzeItem): string {
  const suggested = String(item.suggested_item_name ?? "").trim();
  const raw = String(item.raw_text ?? "").trim();
  if (!suggested) return raw;
  if (!raw) return suggested;

  const compactSuggested = suggested.replace(/\s+/g, "").toLowerCase();
  const compactRaw = raw.replace(/\s+/g, "").toLowerCase();
  const rawHasDetail =
    /[\d%]|\u0e15\u0e32\u0e21\s*(?:\u0e23\u0e39\u0e1b|\u0e20\u0e32\u0e1e)|(?:km|\u0e01\u0e21\.?|\u0e01\u0e34\u0e42\u0e25|cm|mm|inch)/i.test(
      raw
    );
  if (rawHasDetail && compactRaw.startsWith(compactSuggested) && raw.length > suggested.length) {
    return raw;
  }
  return suggested;
}

function defaultActionForItem(item: LineInboxAnalyzeItem): PendingQueueActionLine["default_action"] {
  const matchedId = String(item.matched_order_item_id ?? "").trim();
  if (item.duplicate_status === "duplicate" && matchedId) return "merge";
  if (item.duplicate_status === "new") return "create";
  return "skip";
}

function sourceLabel(sourceType: unknown): string {
  const s = String(sourceType ?? "").trim();
  if (s === "group") return "LINE group";
  if (s === "room") return "LINE room";
  if (s === "user") return "LINE DM";
  return "LINE";
}

function uniqueExistingItems(items: ExistingOrderItemRow[]): ExistingOrderItemRow[] {
  const seen = new Set<string>();
  const out: ExistingOrderItemRow[] = [];
  for (const item of items) {
    const id = String(item.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

function uniqueAttachments(items: PendingQueueAttachment[]): PendingQueueAttachment[] {
  const seen = new Set<string>();
  const out: PendingQueueAttachment[] = [];
  for (const item of items) {
    const key = String(item.line_message_id || item.url).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function groupMessages(messages: PendingQueueMsg[], recentAttachments: PendingQueueAttachment[]): PendingQueueGroup[] {
  const map = new Map<string, PendingQueueGroup>();

  for (const message of messages) {
    const carKey = message.car_row_id ? `car:${message.car_row_id}` : `unresolved:${message.inbox_id}`;
    const existing = map.get(carKey);
    if (existing) {
      existing.messages.push(message);
      existing.total_action_lines += message.action_line_count;
      existing.total_new_lines += message.new_line_count;
      existing.existing_items = uniqueExistingItems([...existing.existing_items, ...message.existing_items]);
      existing.attachments = uniqueAttachments([...existing.attachments, ...message.attachments]);
      continue;
    }

    map.set(carKey, {
      group_key: carKey,
      car_row_id: message.car_row_id,
      plate_display: message.plate_display,
      car_title: message.car_title,
      sale: message.sale,
      is_unresolved: !message.car_row_id,
      total_action_lines: message.action_line_count,
      total_new_lines: message.new_line_count,
      existing_items: uniqueExistingItems(message.existing_items),
      attachments: uniqueAttachments(message.attachments),
      messages: [message],
    });
  }

  return Array.from(map.values()).map((group) => ({
    ...group,
    attachments: uniqueAttachments([...group.attachments, ...recentAttachments]).slice(0, 20),
  }));
}

/**
 * GET /api/line-inbox/pending-queue
 * Rows from webhook: workflow pending + analyze ok -> action queue suggestions for staff review.
 */
export async function GET() {
  const gate = await requireMutateRole();
  if (!gate.ok) return gate.response;

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from(LINE_INBOX_MESSAGES_TABLE)
      .select("id,received_at,raw_text,source_type,analyze_payload,car_row_id")
      .eq("workflow_status", "pending")
      .eq("analyze_status", "ok")
      .order("received_at", { ascending: false })
      .limit(80);

    if (error) {
      const m = error.message.toLowerCase();
      if (
        (m.includes("relation") && m.includes("does not exist")) ||
        (m.includes("schema cache") && m.includes("could not find"))
      ) {
        return NextResponse.json({
          ok: true,
          total_new_lines: 0,
          total_action_lines: 0,
          messages: [] as PendingQueueMsg[],
          groups: [] as PendingQueueGroup[],
          recent_attachments: [] as PendingQueueAttachment[],
          table_missing_hint: LINE_INBOX_MESSAGES_TABLE,
        });
      }
      throw new Error(error.message);
    }

    const messages: PendingQueueMsg[] = [];
    const recentAttachments: PendingQueueAttachment[] = [];
    let totalNew = 0;
    let totalAction = 0;

    for (const row of data ?? []) {
      const id = String((row as { id?: unknown }).id ?? "").trim();
      const payloadRaw = (row as { analyze_payload?: unknown }).analyze_payload;
      if (!id || !isAnalyzePayload(payloadRaw)) continue;

      const payload = payloadRaw;
      const messageAttachments = extractStoredAttachments(
        payload,
        row as {
          id?: unknown;
          received_at?: unknown;
          source_type?: unknown;
          raw_text?: unknown;
          car_row_id?: unknown;
        }
      );
      recentAttachments.push(...messageAttachments);

      const newEntries: PendingQueueNewLine[] = [];
      const actionEntries: PendingQueueActionLine[] = [];
      (payload.items ?? []).forEach((item: LineInboxAnalyzeItem, idx: number) => {
        const st = item.duplicate_status as DuplicateStatus;
        const displayName = queueItemDisplayName(item);
        if (st === "new") {
          newEntries.push({
            item_index: idx,
            raw_text: item.raw_text ?? "",
            suggested_item_name: displayName,
            suggested_status: item.suggested_status ?? "",
            reason: item.reason ?? "",
          });
        }

        const defaultAction = defaultActionForItem(item);
        actionEntries.push({
          item_index: idx,
          raw_text: item.raw_text ?? "",
          suggested_item_name: displayName,
          suggested_note: item.suggested_note ?? "",
          suggested_status: item.suggested_status ?? "",
          duplicate_status: st,
          matched_order_item_id: item.matched_order_item_id ?? "",
          matched_item_name: item.matched_item_name ?? "",
          confidence: Number.isFinite(item.confidence) ? item.confidence : 0,
          reason: item.reason ?? "",
          default_action: defaultAction,
          included_by_default: st === "new",
        });
      });

      if (actionEntries.length === 0) continue;

      const crPayload = String(payload.detected_car?.car_row_id ?? "").trim();
      const crStored = String((row as { car_row_id?: unknown }).car_row_id ?? "").trim();
      const car_row_id = crPayload || crStored;
      const plateText = String(payload.detected_car?.plate_text ?? "").trim() || "-";
      const specText = String(payload.detected_car?.spec_text ?? "").trim();
      const carTitle = [plateText === "-" ? "" : plateText, specText].filter(Boolean).join(" ").trim() || plateText;
      const sale = String(payload.detected_car?.sale ?? "").trim();

      totalNew += newEntries.length;
      totalAction += actionEntries.length;
      messages.push({
        inbox_id: id,
        received_at: String((row as { received_at?: unknown }).received_at ?? ""),
        source_label: sourceLabel((row as { source_type?: unknown }).source_type),
        plate_display: plateText,
        car_title: carTitle,
        car_row_id: car_row_id || "",
        sale,
        raw_text_preview: String((row as { raw_text?: unknown }).raw_text ?? "").trim().slice(0, 120),
        new_lines: newEntries,
        new_line_count: newEntries.length,
        action_lines: actionEntries,
        action_line_count: actionEntries.length,
        existing_items: uniqueExistingItems(payload.existing_items ?? []),
        attachments: messageAttachments,
        needs_human_review: Boolean(payload.needs_human_review),
      });
    }

    const recentUniqueAttachments = uniqueAttachments(recentAttachments).slice(0, 40);
    const groups = groupMessages(messages, recentUniqueAttachments);

    return NextResponse.json({
      ok: true,
      total_new_lines: totalNew,
      total_action_lines: totalAction,
      messages,
      groups,
      recent_attachments: recentUniqueAttachments,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
