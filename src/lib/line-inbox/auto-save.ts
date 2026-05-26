import type { SupabaseClient } from "@supabase/supabase-js";
import { isLineGroupAllowed, parseLineAllowedGroups } from "@/lib/line/allowed-groups";
import { pushLineTextMessage } from "@/lib/line/push-message";
import { resolveSaleStaffForOrder, normalizeSaleAssigneesMap } from "@/lib/orders/sale-assignees-shared";
import { createOrderTaskUpdate } from "@/lib/orders/task-update-log";
import {
  LINE_INBOX_MESSAGES_TABLE,
  markLineInboxMessageWorkflowConfirmed,
} from "@/lib/line-inbox/line-inbox-messages";
import { persistLineInboxConfirmations, type PersistConfirmRow } from "@/lib/line-inbox/persist-line-inbox-confirm";
import {
  buildLineCarDisplayLabel,
  buildLineOrderReviewUrl,
  type LineApprovalAcknowledgementItem,
} from "@/lib/line-inbox/acknowledgement";
import { hasTooManyLineAutoSaveItems } from "@/lib/line-inbox/auto-save-safety";
import { isLineInboxNoiseOrSeparatorOnlyText } from "@/lib/line-inbox/split-line-text";
import type {
  DuplicateStatus,
  ExistingOrderItemRow,
  LineInboxAnalyzeItem,
  LineInboxAnalyzeResponse,
  LineInboxAttachmentMeta,
} from "@/lib/line-inbox/types";

const ORDER_TRACKING_PHOTOS_TABLE = "order_tracking_photos";
const STAFF_ROSTER_TABLE = "order_tracking_staff_roster";
const STAFF_ROSTER_ROW_ID = "default";
const LINE_IMAGE_AFTER_TEXT_WINDOW_MS = 5 * 60 * 1000;
const AUTO_SAVE_MIN_CAR_CONFIDENCE = 0.75;
const AUTO_SAVE_MIN_ITEM_CONFIDENCE = 0.6;

type AutoSaveInboxRow = {
  id: string;
  line_message_id?: string | null;
  raw_text: string;
  source_type?: string | null;
  group_id?: string | null;
  user_id?: string | null;
  received_at?: string | null;
  workflow_status?: string | null;
  analyze_status?: string | null;
  car_row_id?: string | null;
};

type RelatedAttachmentRow = {
  id?: unknown;
  raw_text?: unknown;
  source_type?: unknown;
  group_id?: unknown;
  user_id?: unknown;
  received_at?: unknown;
  workflow_status?: unknown;
  analyze_status?: unknown;
  analyze_payload?: unknown;
};

export type LineAutoSaveDecision =
  | {
      eligible: true;
      actions: PersistConfirmRow[];
    }
  | {
      eligible: false;
      blocked_reason: string;
    };

export type LineAutoSaveRunResult = {
  enabled: boolean;
  dry_run: boolean;
  attempted: boolean;
  saved: boolean;
  blocked_reason?: string;
  saved_count: number;
  would_save_count: number;
  attached_photo_count: number;
  reply_enabled: boolean;
  reply_attempted: boolean;
  reply_sent: boolean;
  reply_error?: string;
  review_url?: string;
};

type SavedReplyItem = {
  order_item_id: string;
  label: string;
  action: string;
  assignee_staff: string;
  status: string;
};

function cleanLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  return raw.replace(/\s+/g, " ").trim().slice(0, 300) || "LINE auto-save failed";
}

export function isTruthyEnvFlag(value?: string | null): boolean {
  return /^(1|true|yes|on|enabled)$/i.test(String(value ?? "").trim());
}

function isLineImageOnlyText(value: unknown): boolean {
  return /^\[LINE\s+(?:image|file)\]/i.test(cleanLine(value));
}

function hasPhotoReference(value: unknown): boolean {
  return /ตาม\s*(?:รูป|ภาพ)|เหมือน\s*รูป|รูปทุกอย่าง|\b(?:photo|image|pic|picture)\b/i.test(cleanLine(value));
}

function isVagueAutoSaveItem(value: unknown): boolean {
  const text = cleanLine(value)
    .replace(/[!?.…。、，,;:|/\\()[\]{}"'`~*_+=<>-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!text) return true;
  return /^(ตามรูป|ตามภาพ|เหมือนรูป|รูปทุกอย่าง|เอาอันนี้ด้วย|เช็คให้หน่อย|จัดการด้วย|ช่วยเช็ค|ดูให้หน่อย|เพิ่ม|ทำให้หน่อย)$/i.test(
    text
  );
}

function uniqueTextCount(values: Array<string | undefined | null>): number {
  const set = new Set(values.map((value) => cleanLine(value).toLowerCase()).filter(Boolean));
  return set.size;
}

function isHighTargetConfidence(value: unknown): boolean {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= AUTO_SAVE_MIN_CAR_CONFIDENCE || value >= AUTO_SAVE_MIN_CAR_CONFIDENCE * 100;
  }
  const text = cleanLine(value).toLowerCase();
  if (text === "high" || text === "matched" || text === "exact" || text === "sure") return true;
  const numeric = Number(text.replace("%", ""));
  if (!Number.isFinite(numeric)) return false;
  return text.includes("%") ? numeric >= AUTO_SAVE_MIN_CAR_CONFIDENCE * 100 : numeric >= AUTO_SAVE_MIN_CAR_CONFIDENCE;
}

function itemDisplayName(item: LineInboxAnalyzeItem): string {
  return cleanLine(item.suggested_item_name) || cleanLine(item.raw_text);
}

function safeStatus(item: LineInboxAnalyzeItem): string {
  return cleanLine(item.suggested_status) || "เช็ค";
}

function detectedCarTitle(payload: LineInboxAnalyzeResponse): string {
  return buildLineCarDisplayLabel({
    plate: payload.detected_car?.plate_text,
    title: payload.detected_car?.spec_text,
    fallback: payload.detected_car?.chassis,
  });
}

function existingItemById(payload: LineInboxAnalyzeResponse): Map<string, ExistingOrderItemRow> {
  const map = new Map<string, ExistingOrderItemRow>();
  for (const item of payload.existing_items ?? []) {
    const id = cleanLine(item.id);
    if (id) map.set(id, item);
  }
  return map;
}

function lineApprovalItem(item: SavedReplyItem): LineApprovalAcknowledgementItem {
  return {
    name: item.label,
    assignee: item.assignee_staff,
    status: item.status,
  };
}

function compactItemLine(index: number, item: LineApprovalAcknowledgementItem): string {
  const obj = typeof item === "string" ? { name: item, assignee: "", status: "" } : item;
  const name = cleanLine(obj.name);
  const assignee = cleanLine(obj.assignee ?? obj.assignee_staff) || "ยังไม่ระบุ";
  const status = cleanLine(obj.status ?? obj.item_status) || "เช็ค";
  return `${index + 1}. ${name} : ${assignee}/${status}`;
}

function updatedItemLine(
  index: number,
  item: SavedReplyItem,
  previous: ExistingOrderItemRow | undefined
): string {
  const beforeAssignee = cleanLine(previous?.assignee_staff) || "ยังไม่ระบุ";
  const beforeStatus = cleanLine(previous?.status) || "เช็ค";
  const afterAssignee = cleanLine(item.assignee_staff) || "ยังไม่ระบุ";
  const afterStatus = cleanLine(item.status) || "เช็ค";
  return `${index + 1}. ${item.label} : ${beforeAssignee}/${beforeStatus} → ${afterAssignee}/${afterStatus}`;
}

export function buildLineAutoSaveAcknowledgementText(params: {
  carTitle?: string | null;
  createdItems?: LineApprovalAcknowledgementItem[];
  updatedItems?: Array<{ item: SavedReplyItem; previous?: ExistingOrderItemRow }>;
  attachedPhotoCount?: number;
  reviewUrl?: string | null;
}): string {
  const carTitle = cleanLine(params.carTitle);
  const createdItems = (params.createdItems ?? []).filter((item) =>
    typeof item === "string" ? cleanLine(item) : cleanLine(item.name)
  );
  const updatedItems = (params.updatedItems ?? []).filter((entry) => cleanLine(entry.item.label));
  const attachedPhotoCount = Math.max(0, Math.floor(Number(params.attachedPhotoCount ?? 0)));
  const reviewUrl = cleanLine(params.reviewUrl);
  const lines = ["รับทราบค่ะ ✅", "บันทึกงานอัตโนมัติแล้ว", ""];

  if (carTitle) lines.push(`รถ: ${carTitle}`, "");
  if (createdItems.length > 0) {
    lines.push("งานที่เพิ่ม:");
    for (const [index, item] of createdItems.entries()) lines.push(compactItemLine(index, item));
    lines.push("");
  }
  if (updatedItems.length > 0) {
    lines.push("งานที่อัปเดต:");
    for (const [index, entry] of updatedItems.entries()) {
      lines.push(updatedItemLine(index, entry.item, entry.previous));
    }
    lines.push("");
  }
  if (attachedPhotoCount > 0) {
    lines.push("รูปแนบ:", `- แนบรูปแล้ว ${attachedPhotoCount} รูป`, "");
  }
  lines.push("ถ้ารายการผิด กรุณาเปิดลิงก์นี้เพื่อแก้ไข/ลบ:");
  lines.push(reviewUrl || buildLineOrderReviewUrl({ plate: carTitle }));
  return lines.join("\n");
}

export function evaluateLineAutoSaveEligibility(params: {
  row: AutoSaveInboxRow;
  payload: LineInboxAnalyzeResponse;
  enabled?: boolean;
  allowedGroupIds?: string | null;
}): LineAutoSaveDecision {
  if (!params.enabled) return { eligible: false, blocked_reason: "auto_save_disabled" };
  const row = params.row;
  const payload = params.payload;

  if (cleanLine(row.source_type) !== "group") return { eligible: false, blocked_reason: "not_group_source" };
  const policy = parseLineAllowedGroups(params.allowedGroupIds);
  if (!isLineGroupAllowed(row.group_id, policy)) return { eligible: false, blocked_reason: "group_not_allowed" };
  if (isLineImageOnlyText(row.raw_text)) return { eligible: false, blocked_reason: "image_only" };
  if (isLineInboxNoiseOrSeparatorOnlyText(row.raw_text)) return { eligible: false, blocked_reason: "noise_or_separator" };
  if (payload.needs_human_review) return { eligible: false, blocked_reason: "needs_human_review" };

  const carRowId = cleanLine(payload.detected_car?.car_row_id) || cleanLine(row.car_row_id);
  if (!carRowId) return { eligible: false, blocked_reason: "missing_car" };

  const carConfidence = Number(payload.detected_car?.confidence ?? 0);
  if (carConfidence < AUTO_SAVE_MIN_CAR_CONFIDENCE && !isHighTargetConfidence(payload.aiTargetCarConfidence)) {
    return { eligible: false, blocked_reason: "car_confidence_low" };
  }

  const candidateCount = uniqueTextCount((payload.extractedCarCandidates ?? []).map((candidate) => candidate.text));
  if (candidateCount > 1 && !isHighTargetConfidence(payload.aiTargetCarConfidence)) {
    return { eligible: false, blocked_reason: "multiple_car_candidates" };
  }

  const items = payload.items ?? [];
  if (items.length === 0) return { eligible: false, blocked_reason: "no_items" };
  if (hasTooManyLineAutoSaveItems(items.length)) return { eligible: false, blocked_reason: "too_many_items" };

  const actions: PersistConfirmRow[] = [];
  for (const item of items) {
    const name = itemDisplayName(item);
    if (!name) return { eligible: false, blocked_reason: "blank_item" };
    if (isVagueAutoSaveItem(name)) return { eligible: false, blocked_reason: "vague_item" };
    if (Number(item.confidence ?? 0) < AUTO_SAVE_MIN_ITEM_CONFIDENCE) {
      return { eligible: false, blocked_reason: "item_confidence_low" };
    }

    const duplicateStatus = item.duplicate_status as DuplicateStatus;
    if (duplicateStatus === "new") {
      actions.push({
        action: "create",
        item_name: name,
        item_status: safeStatus(item),
        note: cleanLine(item.suggested_note) || undefined,
      });
      continue;
    }

    if (duplicateStatus === "duplicate" && cleanLine(item.matched_order_item_id)) {
      actions.push({
        action: "merge",
        order_item_id: cleanLine(item.matched_order_item_id),
        item_name: name,
        item_status: safeStatus(item),
        note: cleanLine(item.suggested_note) || undefined,
      });
      continue;
    }

    return { eligible: false, blocked_reason: `unsafe_duplicate_status_${duplicateStatus || "unknown"}` };
  }

  return actions.length > 0 ? { eligible: true, actions } : { eligible: false, blocked_reason: "no_actions" };
}

async function fetchSaleAssigneeMap(supabase: SupabaseClient): Promise<Record<string, string>> {
  try {
    const { data, error } = await supabase
      .from(STAFF_ROSTER_TABLE)
      .select("sale_assignees")
      .eq("id", STAFF_ROSTER_ROW_ID)
      .maybeSingle();
    if (error) return {};
    return normalizeSaleAssigneesMap(data?.sale_assignees) as Record<string, string>;
  } catch {
    return {};
  }
}

function applyDefaultAssignee(actions: PersistConfirmRow[], assignee: string): PersistConfirmRow[] {
  const clean = cleanLine(assignee);
  if (!clean) return actions;
  return actions.map((action) => ({
    ...action,
    assignee_staff: cleanLine(action.assignee_staff) || clean,
  }));
}

function attachmentMetaFromPayload(payload: unknown): LineInboxAttachmentMeta[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as { line_attachments?: unknown };
  return Array.isArray(body.line_attachments) ? (body.line_attachments as LineInboxAttachmentMeta[]) : [];
}

function isStoredAttachment(attachment: LineInboxAttachmentMeta): boolean {
  return attachment.status === "stored" && Boolean(cleanLine(attachment.storage_path));
}

async function findRelatedLineAttachments(
  supabase: SupabaseClient,
  row: AutoSaveInboxRow
): Promise<{ rowsToConfirm: string[]; attachments: LineInboxAttachmentMeta[] }> {
  const sourceType = cleanLine(row.source_type);
  const sourceId = cleanLine(row.group_id) || cleanLine(row.user_id);
  const receivedMs = Date.parse(cleanLine(row.received_at));
  if (!sourceType || !sourceId || !Number.isFinite(receivedMs)) {
    return { rowsToConfirm: [], attachments: [] };
  }

  const fromIso = new Date(receivedMs).toISOString();
  const toIso = new Date(receivedMs + LINE_IMAGE_AFTER_TEXT_WINDOW_MS).toISOString();
  let query = supabase
    .from(LINE_INBOX_MESSAGES_TABLE)
    .select("id,raw_text,source_type,group_id,user_id,received_at,workflow_status,analyze_status,analyze_payload")
    .eq("source_type", sourceType)
    .gte("received_at", fromIso)
    .lte("received_at", toIso)
    .order("received_at", { ascending: true })
    .limit(20);

  if (sourceType === "group") query = query.eq("group_id", sourceId);
  else query = query.eq("user_id", sourceId);

  const { data, error } = await query;
  if (error) {
    console.warn("[line-auto-save] related image lookup skipped", { error: cleanError(error) });
    return { rowsToConfirm: [], attachments: [] };
  }

  const rows = (data ?? []) as RelatedAttachmentRow[];
  const rowsToConfirm: string[] = [];
  const attachments: LineInboxAttachmentMeta[] = [];
  for (const item of rows) {
    const id = cleanLine(item.id);
    if (!id || id === row.id) continue;
    if (!isLineImageOnlyText(item.raw_text)) continue;
    const meta = attachmentMetaFromPayload(item.analyze_payload).filter(isStoredAttachment);
    if (meta.length === 0) continue;
    rowsToConfirm.push(id);
    attachments.push(...meta);
  }

  const unique = new Map<string, LineInboxAttachmentMeta>();
  for (const attachment of attachments) {
    const key = cleanLine(attachment.storage_path) || cleanLine(attachment.line_message_id);
    if (key && !unique.has(key)) unique.set(key, attachment);
  }
  return { rowsToConfirm, attachments: Array.from(unique.values()) };
}

function isMissingPhotoTableError(message: string): boolean {
  const m = message.toLowerCase();
  const mentionsPhotoTable = m.includes(ORDER_TRACKING_PHOTOS_TABLE);
  if (!mentionsPhotoTable) return false;
  return (
    (m.includes("relation") && m.includes("does not exist")) ||
    (m.includes("table") && m.includes("does not exist")) ||
    (m.includes("schema cache") && m.includes("could not find") && (m.includes("table") || m.includes("column"))) ||
    (m.includes("column") && m.includes("does not exist"))
  );
}

function isDuplicatePhotoError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("duplicate key") || m.includes("already exists") || m.includes("unique");
}

async function attachLinePhotosToSavedItem(
  supabase: SupabaseClient,
  input: {
    carRowId: string;
    orderItemId: string;
    attachments: LineInboxAttachmentMeta[];
  }
): Promise<number> {
  const carRowId = cleanLine(input.carRowId);
  const orderItemId = cleanLine(input.orderItemId);
  if (!carRowId || !orderItemId || input.attachments.length === 0) return 0;

  let attached = 0;
  for (const attachment of input.attachments) {
    const storagePath = cleanLine(attachment.storage_path);
    if (!storagePath) continue;
    const insert = await supabase.from(ORDER_TRACKING_PHOTOS_TABLE).insert({
      target_type: "item",
      order_item_id: orderItemId,
      car_row_id: carRowId,
      car_id: null,
      storage_bucket: cleanLine(attachment.storage_bucket) || "order-tracking-photos",
      storage_path: storagePath,
      mime_type: cleanLine(attachment.mime_type) || null,
      size_bytes: Number.isFinite(Number(attachment.size_bytes)) ? Number(attachment.size_bytes) : null,
      uploaded_by: null,
    });

    if (insert.error) {
      const msg = insert.error.message;
      if (isDuplicatePhotoError(msg)) continue;
      if (isMissingPhotoTableError(msg)) {
        console.warn("[line-auto-save] photo attach skipped - order_tracking_photos unavailable");
        return attached;
      }
      console.warn("[line-auto-save] photo attach skipped", { error: cleanError(insert.error) });
      continue;
    }
    attached += 1;
  }
  return attached;
}

function pickPhotoTargetItem(params: {
  saved: SavedReplyItem[];
  actions: PersistConfirmRow[];
}): SavedReplyItem | null {
  const photoActionIndex = params.actions.findIndex((action) => hasPhotoReference(action.item_name));
  if (photoActionIndex >= 0) return params.saved[photoActionIndex] ?? params.saved[0] ?? null;
  return params.saved[0] ?? null;
}

function reviewUrlFor(payload: LineInboxAnalyzeResponse, carRowId: string): string {
  return buildLineOrderReviewUrl({
    carRowId,
    plate: cleanLine(payload.detected_car?.plate_text) || detectedCarTitle(payload),
  });
}

function sourceTarget(row: AutoSaveInboxRow): string {
  if (cleanLine(row.source_type) === "group") return cleanLine(row.group_id);
  return "";
}

async function maybeSendAutoSaveReply(params: {
  row: AutoSaveInboxRow;
  text: string;
}): Promise<{ attempted: boolean; sent: boolean; error?: string }> {
  if (!isTruthyEnvFlag(process.env.LINE_AUTO_SAVE_REPLY_ENABLED)) return { attempted: false, sent: false };
  const token = cleanLine(process.env.LINE_CHANNEL_ACCESS_TOKEN);
  const target = sourceTarget(params.row);
  if (!token || !target) return { attempted: false, sent: false, error: !token ? "missing_token" : "missing_target" };

  const sent = await pushLineTextMessage({ accessToken: token, to: target, text: params.text });
  if (sent.ok) return { attempted: true, sent: true };
  return { attempted: true, sent: false, error: sent.error };
}

function savedReplyItems(saved: Array<{ order_item_id: string; label: string; action: string }>, actions: PersistConfirmRow[]): SavedReplyItem[] {
  return saved.map((item, index) => ({
    order_item_id: item.order_item_id,
    label: item.label,
    action: item.action,
    assignee_staff: cleanLine(actions[index]?.assignee_staff),
    status: cleanLine(actions[index]?.item_status) || "เช็ค",
  }));
}

function payloadWithAutoSaveStatus(
  payload: LineInboxAnalyzeResponse,
  status: string,
  extra: Record<string, unknown> = {}
): LineInboxAnalyzeResponse & { auto_save: Record<string, unknown> } {
  const existing =
    payload && typeof payload === "object" && "auto_save" in payload && typeof (payload as { auto_save?: unknown }).auto_save === "object"
      ? ((payload as { auto_save?: Record<string, unknown> }).auto_save ?? {})
      : {};
  return {
    ...payload,
    auto_save: {
      ...existing,
      status,
      ...extra,
      updated_at: new Date().toISOString(),
    },
  };
}

async function claimLineInboxMessageForAutoSave(
  supabase: SupabaseClient,
  rowId: string,
  payload: LineInboxAnalyzeResponse
): Promise<boolean> {
  // The production migration currently restricts workflow_status to
  // pending/confirmed/skipped, so confirmed is used as the durable atomic lock.
  // analyze_payload.auto_save.status carries the more specific processing state.
  const { data, error } = await supabase
    .from(LINE_INBOX_MESSAGES_TABLE)
    .update({
      workflow_status: "confirmed",
      analyze_payload: payloadWithAutoSaveStatus(payload, "processing_lock"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", rowId)
    .eq("workflow_status", "pending")
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean(data?.id);
}

async function updateLineInboxAutoSaveStatus(
  supabase: SupabaseClient,
  rowId: string,
  payload: LineInboxAnalyzeResponse,
  status: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await supabase
    .from(LINE_INBOX_MESSAGES_TABLE)
    .update({
      analyze_payload: payloadWithAutoSaveStatus(payload, status, extra),
      updated_at: new Date().toISOString(),
    })
    .eq("id", rowId);
  if (error) {
    console.warn("[line-auto-save] status update skipped", {
      inbox_message_id: rowId,
      error: cleanError(error),
    });
  }
}

export async function maybeAutoSaveAnalyzedLineInbox(
  supabase: SupabaseClient,
  params: {
    row: AutoSaveInboxRow;
    payload: LineInboxAnalyzeResponse;
  }
): Promise<LineAutoSaveRunResult> {
  const enabled = isTruthyEnvFlag(process.env.LINE_AUTO_SAVE_ENABLED);
  const dryRun = isTruthyEnvFlag(process.env.LINE_AUTO_SAVE_DRY_RUN_ENABLED);
  const baseDisabled: LineAutoSaveRunResult = {
    enabled,
    dry_run: dryRun,
    attempted: false,
    saved: false,
    saved_count: 0,
    would_save_count: 0,
    attached_photo_count: 0,
    reply_enabled: isTruthyEnvFlag(process.env.LINE_AUTO_SAVE_REPLY_ENABLED),
    reply_attempted: false,
    reply_sent: false,
  };

  const decision = evaluateLineAutoSaveEligibility({
    row: params.row,
    payload: params.payload,
    enabled: enabled || dryRun,
    allowedGroupIds: process.env.LINE_AUTO_SAVE_ALLOWED_GROUP_IDS,
  });
  if (!decision.eligible) return { ...baseDisabled, blocked_reason: decision.blocked_reason };
  if (dryRun) {
    return {
      ...baseDisabled,
      attempted: true,
      blocked_reason: "dry_run",
      would_save_count: decision.actions.length,
    };
  }

  const claimed = await claimLineInboxMessageForAutoSave(supabase, params.row.id, params.payload);
  if (!claimed) return { ...baseDisabled, blocked_reason: "not_pending_or_already_claimed" };

  const saleAssignees = await fetchSaleAssigneeMap(supabase);
  const defaultAssignee = resolveSaleStaffForOrder(params.payload.detected_car?.sale ?? "", saleAssignees);
  const actions = applyDefaultAssignee(decision.actions, defaultAssignee);
  const carRowId = cleanLine(params.payload.detected_car?.car_row_id) || cleanLine(params.row.car_row_id);
  const existingById = existingItemById(params.payload);

  let orderTaskId = "";
  let saved: Array<{ order_item_id: string; label: string; action: string }> = [];
  try {
    const persisted = await persistLineInboxConfirmations(supabase, {
      car_row_id: carRowId,
      car_id: null,
      actionable: actions,
      line_inbox_msg_ref_for_audit: `${params.row.id}:auto-save`,
    });
    orderTaskId = persisted.order_task_id;
    saved = persisted.saved;
  } catch (error) {
    await updateLineInboxAutoSaveStatus(supabase, params.row.id, params.payload, "error_after_lock", {
      error: cleanError(error),
    });
    throw error;
  }

  const savedItems = savedReplyItems(saved, actions);
  await updateLineInboxAutoSaveStatus(supabase, params.row.id, params.payload, "saved", {
    saved_count: savedItems.length,
  });

  let related: { rowsToConfirm: string[]; attachments: LineInboxAttachmentMeta[] } = {
    rowsToConfirm: [],
    attachments: [],
  };
  let attachedPhotoCount = 0;
  try {
    related = await findRelatedLineAttachments(supabase, params.row);
    const photoTarget = pickPhotoTargetItem({ saved: savedItems, actions });
    attachedPhotoCount =
      photoTarget && related.attachments.length > 0
        ? await attachLinePhotosToSavedItem(supabase, {
            carRowId,
            orderItemId: photoTarget.order_item_id,
            attachments: related.attachments,
          })
        : 0;
  } catch (error) {
    console.warn("[line-auto-save] photo attach failed after save", {
      inbox_message_id: params.row.id,
      error: cleanError(error),
    });
  }

  try {
    await createOrderTaskUpdate(supabase, {
      order_task_id: orderTaskId,
      action_type: "intake_saved",
      old_value: null,
      new_value: {
        source: "line_auto_save",
        line_inbox_message_id: params.row.id,
        saved_count: savedItems.length,
        attached_photo_count: attachedPhotoCount,
      },
      note: "LINE auto-save completed",
      updated_by: "line-auto-save",
      role: "sales",
    });
  } catch (error) {
    console.warn("[line-auto-save] audit log failed after save", {
      inbox_message_id: params.row.id,
      error: cleanError(error),
    });
  }

  if (attachedPhotoCount > 0) {
    for (const imageRowId of related.rowsToConfirm) {
      try {
        await markLineInboxMessageWorkflowConfirmed(supabase, imageRowId);
      } catch (error) {
        console.warn("[line-auto-save] related image row confirm skipped", {
          inbox_message_id: imageRowId,
          error: cleanError(error),
        });
      }
    }
  }

  const created = savedItems.filter((item) => item.action === "create").map(lineApprovalItem);
  const updated = savedItems
    .filter((item) => item.action === "merge")
    .map((item) => ({ item, previous: existingById.get(item.order_item_id) }));
  const reviewUrl = reviewUrlFor(params.payload, carRowId);
  const replyText = buildLineAutoSaveAcknowledgementText({
    carTitle: detectedCarTitle(params.payload),
    createdItems: created,
    updatedItems: updated,
    attachedPhotoCount,
    reviewUrl,
  });

  let reply: { attempted: boolean; sent: boolean; error?: string } = { attempted: false, sent: false };
  try {
    reply = await maybeSendAutoSaveReply({ row: params.row, text: replyText });
  } catch (error) {
    reply = { attempted: true, sent: false, error: cleanError(error) };
    console.warn("[line-auto-save] acknowledgement failed", { error: reply.error });
  }

  return {
    enabled: true,
    dry_run: false,
    attempted: true,
    saved: savedItems.length > 0,
    saved_count: savedItems.length,
    would_save_count: 0,
    attached_photo_count: attachedPhotoCount,
    reply_enabled: isTruthyEnvFlag(process.env.LINE_AUTO_SAVE_REPLY_ENABLED),
    reply_attempted: reply.attempted,
    reply_sent: reply.sent,
    reply_error: reply.error,
    review_url: reviewUrl,
  };
}
