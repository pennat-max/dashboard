"use client";

/* eslint-disable @typescript-eslint/no-unused-vars -- helpers kept for future advanced LINE paste panel */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolveSaleStaffForOrder } from "@/lib/orders/sale-assignees-shared";
import {
  LINE_ORDER_REVIEW_URL,
  buildLineCarDisplayLabel,
  buildLineOrderReviewUrl,
} from "@/lib/line-inbox/review-link";
import {
  LINE_INBOX_QUEUE_REFRESH_MS,
  lineInboxQueueGroupMatchesFilter,
  lineInboxQueueMessageNeedsManualReview,
  todayYmdBangkokForLineInboxQueue,
  type LineInboxQueueFilter,
  type LineInboxQueueFilterCounts,
} from "@/lib/line-inbox/pending-queue-view";
import { deriveLineInboxCarSearchQuery } from "@/lib/line-inbox/resolve-car";
import { matchesVehicleSearch } from "@/lib/order-tracking/vehicle-search";
import type {
  DuplicateStatus,
  ExistingOrderItemRow,
  LineInboxCarCandidate,
  LineInboxMatchedCarCandidate,
  LineInboxAnalyzeItem,
  LineInboxAnalyzeResponse,
} from "@/lib/line-inbox/types";

export type LineInboxAiOrderPick = {
  id: string;
  fullPlate: string;
  car: string;
  chassis?: string | null;
  sale?: string | null;
  carRowId: string | null;
  carId: number | null;
};

type UiLang = "th" | "en";

type PendingQueueNewLine = {
  item_index: number;
  raw_text: string;
  suggested_item_name: string;
  suggested_status: string;
  reason: string;
  related_photo_ids?: string[];
  relatedPhotoIds?: string[];
  line_photo_count?: number;
  linePhotoCount?: number;
  has_photo_reference?: boolean;
  hasPhotoReference?: boolean;
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

type PendingQueueDetectedCar = {
  plate_text?: string;
  spec_text?: string;
  chassis?: string;
  car_row_id?: string;
  sale?: string;
  confidence?: number;
};

type PendingQueueMessage = {
  inbox_id: string;
  received_at: string;
  source_type?: string;
  group_id_display?: string;
  source_label?: string;
  plate_display: string;
  car_title?: string;
  fallback_title?: string;
  fallback_description?: string;
  fallbackTitle?: string;
  fallbackDescription?: string;
  fallback_subtitle?: string;
  fallbackSubtitle?: string;
  rawTextPreview?: string;
  related_text_message_id?: string;
  relatedTextMessageId?: string;
  line_photo_count?: number;
  linePhotoCount?: number;
  extractedCarCandidates?: LineInboxCarCandidate[];
  matchedCarCandidates?: LineInboxMatchedCarCandidate[];
  aiTargetCarReference?: string;
  aiTargetCarConfidence?: string;
  matchReason?: string;
  inheritedCarRowId?: string;
  context_source?: string;
  contextSource?: string;
  reply_context?: LineInboxAnalyzeResponse["reply_context"] | null;
  replyContext?: LineInboxAnalyzeResponse["reply_context"] | null;
  related_photo_ids?: string[];
  relatedPhotoIds?: string[];
  suggestedItems?: string[];
  extractionStatus?: "ok" | "no_items" | "needs_manual_review" | "matched_no_work";
  matchStatus?: "matched" | "waiting_for_car_record" | "ambiguous_vehicle" | "no_vehicle_context" | "unresolved";
  unmatchedReason?: "" | "pending_car_record" | "multiple_candidates" | "no_car_candidate";
  unmatched_reason?: "" | "pending_car_record" | "multiple_candidates" | "no_car_candidate";
  reviewUrl?: string;
  review_url?: string;
  car_row_id: string;
  sale?: string;
  raw_text?: string;
  raw_text_preview: string;
  detected_car?: PendingQueueDetectedCar | null;
  manual_review_reason?: string;
  new_lines: PendingQueueNewLine[];
  new_line_count: number;
  action_lines?: PendingQueueActionLine[];
  action_line_count?: number;
  existing_items?: ExistingOrderItemRow[];
  attachments?: PendingQueueAttachment[];
  needs_human_review: boolean;
};

type PendingQueueAttachment = {
  inbox_id: string;
  line_message_id: string;
  url: string;
  file_name: string | null;
  mime_type: string | null;
  received_at: string;
  source_type?: string;
  group_id_display?: string;
  source_label?: string;
  raw_text_preview?: string;
  car_row_id?: string;
  plate_display?: string;
  car_title?: string;
  fallback_title?: string;
  fallback_description?: string;
  fallbackTitle?: string;
  fallbackDescription?: string;
  fallback_subtitle?: string;
  fallbackSubtitle?: string;
  rawTextPreview?: string;
  related_text_message_id?: string;
  relatedTextMessageId?: string;
  line_photo_count?: number;
  linePhotoCount?: number;
  extractedCarCandidates?: LineInboxCarCandidate[];
  matchedCarCandidates?: LineInboxMatchedCarCandidate[];
  aiTargetCarReference?: string;
  aiTargetCarConfidence?: string;
  matchReason?: string;
  inheritedCarRowId?: string;
  context_source?: string;
  contextSource?: string;
  reply_context?: LineInboxAnalyzeResponse["reply_context"] | null;
  replyContext?: LineInboxAnalyzeResponse["reply_context"] | null;
  sale?: string;
  needs_human_review?: boolean;
  status?: "not_linked" | "attached" | "ignored" | string;
};

type PendingQueueGroup = {
  group_key: string;
  car_row_id: string;
  plate_display: string;
  car_title: string;
  fallback_title?: string;
  fallback_description?: string;
  fallbackTitle?: string;
  fallbackDescription?: string;
  fallback_subtitle?: string;
  fallbackSubtitle?: string;
  rawTextPreview?: string;
  related_text_message_id?: string;
  relatedTextMessageId?: string;
  line_photo_count?: number;
  linePhotoCount?: number;
  extractedCarCandidates?: LineInboxCarCandidate[];
  matchedCarCandidates?: LineInboxMatchedCarCandidate[];
  aiTargetCarReference?: string;
  aiTargetCarConfidence?: string;
  matchReason?: string;
  inheritedCarRowId?: string;
  context_source?: string;
  contextSource?: string;
  reply_context?: LineInboxAnalyzeResponse["reply_context"] | null;
  replyContext?: LineInboxAnalyzeResponse["reply_context"] | null;
  related_photo_ids?: string[];
  relatedPhotoIds?: string[];
  suggestedItems?: string[];
  extractionStatus?: "ok" | "no_items" | "needs_manual_review" | "matched_no_work";
  matchStatus?: "matched" | "waiting_for_car_record" | "ambiguous_vehicle" | "no_vehicle_context" | "unresolved";
  unmatchedReason?: "" | "pending_car_record" | "multiple_candidates" | "no_car_candidate";
  unmatched_reason?: "" | "pending_car_record" | "multiple_candidates" | "no_car_candidate";
  reviewUrl?: string;
  review_url?: string;
  sale: string;
  source_label?: string;
  source_type?: string;
  group_id_display?: string;
  is_unresolved: boolean;
  total_action_lines: number;
  total_new_lines: number;
  total_manual_reviews?: number;
  existing_items: ExistingOrderItemRow[];
  attachments: PendingQueueAttachment[];
  messages: PendingQueueMessage[];
};

type QueueActionDraft = {
  included: boolean;
  action: "create" | "merge" | "skip";
  itemName: string;
  assignee: string;
  status: string;
  note: string;
  dueDate: string;
  orderItemId: string;
};

type RowDraft = LineInboxAnalyzeItem & {
  action: "skip" | "create" | "merge";
  note: string;
  included: boolean;
  itemName: string;
  assignee: string;
  status: string;
  dueDate: string;
};

type LineInboxItemPhoto = {
  id: string;
  url: string;
  created_at?: string | null;
};

type LineInboxStagedPhoto = {
  id: string;
  file: File;
  previewUrl: string;
};

type SuggestionPhotoSheetState = {
  rowKey: string;
  rowIndex: number;
  itemName?: string;
};

function defaultAction(item: LineInboxAnalyzeItem): RowDraft["action"] {
  if (item.duplicate_status === "duplicate" && String(item.matched_order_item_id ?? "").trim()) {
    return "merge";
  }
  if (
    item.duplicate_status === "possible_duplicate" &&
    String(item.matched_order_item_id ?? "").trim()
  ) {
    return "skip";
  }
  return "create";
}

function duplicateLabelTh(status: DuplicateStatus): string {
  switch (status) {
    case "new":
      return "งานใหม่";
    case "duplicate":
      return "ซ้ำ";
    case "possible_duplicate":
      return "อาจซ้ำ";
    default:
      return "ไม่ชัด";
  }
}

function duplicateBadgeClass(status: DuplicateStatus): string {
  switch (status) {
    case "new":
      return "border-emerald-200 bg-emerald-50 text-emerald-950";
    case "duplicate":
      return "border-amber-200 bg-amber-50 text-amber-950";
    case "possible_duplicate":
      return "border-orange-200 bg-orange-50 text-orange-950";
    default:
      return "border-slate-200 bg-slate-100 text-slate-800";
  }
}

function normalizeLookup(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[\s-]+/g, "")
    .toUpperCase();
}

function buildDisplayCarLabel({
  plate,
  title,
  fallback,
  uiLang,
}: {
  plate: string | null | undefined;
  title: string | null | undefined;
  fallback?: string | null | undefined;
  uiLang: UiLang;
}): string {
  return buildLineCarDisplayLabel({ plate, title, fallback }) || (uiLang === "en" ? "Unmatched car" : "ยังไม่จับรถ");
}

const buildOrderReviewUrl = buildLineOrderReviewUrl;
function safeDateValue(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  const m = raw.match(/^\d{4}-\d{2}-\d{2}/);
  return m?.[0] ?? "";
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function buildLineReplyText({
  plate,
  lines,
  reviewUrl,
  uiLang,
}: {
  plate: string;
  lines: Array<{ name: string; status: string; assignee?: string }>;
  reviewUrl?: string;
  uiLang: UiLang;
}): string {
  const safePlate = plate.trim() || "-";
  const safeReviewUrl = String(reviewUrl ?? "").trim() || LINE_ORDER_REVIEW_URL;
  const itemLines =
    lines.length > 0
      ? lines
          .map((line, index) => {
            const assignee = String(line.assignee ?? "").trim() || (uiLang === "en" ? "Unassigned" : "ยังไม่ระบุ");
            const status = line.status.trim() || (uiLang === "en" ? "Unspecified" : "ยังไม่ระบุ");
            return `${index + 1}. ${line.name.trim() || "-"} : ${assignee}/${status}`;
          })
          .join("\n")
      : "-";

  if (uiLang === "en") {
    return [
      "Received the request.",
      `Car: ${safePlate}`,
      "Items:",
      itemLines,
      "Review the saved work:",
      safeReviewUrl,
    ].join("\n");
  }

  return [
    "รับทราบค่ะ ✅",
    "",
    "บันทึกงานเรียบร้อย",
    "",
    `รถ: ${safePlate}`,
    "รายการ:",
    itemLines,
    "",
    "ดูงาน:",
    safeReviewUrl,
  ].join("\n");
}

function buildLineAcknowledgementReplyText({
  plate,
  reviewUrl,
  uiLang,
}: {
  plate: string;
  reviewUrl?: string;
  uiLang: UiLang;
}): string {
  const safePlate = plate.trim() || "-";
  const safeReviewUrl = String(reviewUrl ?? "").trim() || LINE_ORDER_REVIEW_URL;

  if (uiLang === "en") {
    return [
      "Received the LINE request.",
      "",
      safePlate !== "-" ? `Car: ${safePlate}` : "The system is reading the LINE message.",
      "Please review the AI result before saving:",
      safeReviewUrl,
    ].join("\n");
  }

  return [
    "รับงานแล้วครับ",
    "",
    safePlate !== "-" ? `รถ: ${safePlate}` : "ระบบกำลังอ่านงานจาก LINE",
    "กรุณาตรวจสอบงานที่ AI จับได้ก่อนบันทึก:",
    safeReviewUrl,
  ].join("\n");
}

function buildQueueAcceptedReplyText(group: PendingQueueGroup, uiLang: UiLang): string {
  const carTitle = queueGroupDisplayTitle(group, uiLang);
  const plate = String(group.plate_display ?? "").trim();
  const carRowId = String(group.car_row_id ?? group.inheritedCarRowId ?? "").trim();
  return buildLineAcknowledgementReplyText({
    plate: group.is_unresolved ? "" : carTitle,
    reviewUrl: buildOrderReviewUrl({ carRowId, plate: plate && plate !== "-" ? plate : carTitle }),
    uiLang,
  });
}

function addUniqueOption(target: string[], value: string | null | undefined) {
  const clean = String(value ?? "").trim();
  if (!clean) return;
  const key = clean.toLowerCase();
  if (target.some((v) => v.toLowerCase() === key)) return;
  target.push(clean);
}

function actionLabelTh(action: RowDraft["action"]): string {
  if (action === "merge") return "อัปเดตงานเดิม";
  if (action === "skip") return "ข้าม";
  return "เพิ่มงานใหม่";
}

const LINE_INBOX_PHOTO_REF_SPLIT_REGEX = /(ตามรูป|ตามภาพ|ref\s*pic|as\s+photo|see\s+photo)/gi;
const LINE_INBOX_PHOTO_REF_EXACT_REGEX = /^(ตามรูป|ตามภาพ|ref\s*pic|as\s+photo|see\s+photo)$/i;

function hasLineInboxPhotoReference(value: string | null | undefined): boolean {
  const hasRef = LINE_INBOX_PHOTO_REF_SPLIT_REGEX.test(String(value ?? ""));
  LINE_INBOX_PHOTO_REF_SPLIT_REGEX.lastIndex = 0;
  return hasRef;
}

function queueSuggestionRowKey(inboxId: string, itemIndex: number): string {
  return `queue:${inboxId}:${itemIndex}`;
}

function queueActionDraftForLine(
  line: PendingQueueActionLine,
  fallbackAssignee: string
): QueueActionDraft {
  return {
    included: Boolean(line.included_by_default) && line.default_action !== "skip",
    action: line.default_action,
    itemName: String(line.suggested_item_name || line.raw_text || "").trim(),
    assignee: fallbackAssignee,
    status: String(line.suggested_status ?? "").trim(),
    note: "",
    dueDate: "",
    orderItemId: String(line.matched_order_item_id ?? "").trim(),
  };
}

function safeQueueAction(action: string): QueueActionDraft["action"] {
  if (action === "merge" || action === "skip") return action;
  return "create";
}

function formatQueueTabLabel(base: string, count: number): string {
  return count > 0 ? `${base} (${count})` : base;
}

function queueMessageActionCount(message: PendingQueueMessage): number {
  return queueMessageWorkActionLines(message).length;
}

function queueMessageNeedsManualReview(message: PendingQueueMessage): boolean {
  if (lineInboxQueueMessageNeedsManualReview(message)) return true;
  if (queueMessageHasWorkItems(message)) return false;
  const hasImagePlaceholderOnly =
    (message.action_lines ?? []).some((line) =>
      isLineInboxImagePlaceholderText(line.raw_text) || isLineInboxImagePlaceholderText(line.suggested_item_name)
    ) && queueMessageWorkActionLines(message).length === 0;
  if (hasImagePlaceholderOnly) return true;
  return Boolean(queueMessageRawText(message));
}

function queueMessageHasMatchedCar(message: PendingQueueMessage): boolean {
  return (
    String(message.car_row_id ?? "").trim().length > 0 ||
    String(message.detected_car?.car_row_id ?? "").trim().length > 0 ||
    String(message.matchStatus ?? "").trim() === "matched"
  );
}

const LINE_INBOX_IMAGE_PLACEHOLDER_REGEX = /^\[LINE (image|file)\]$/i;

function isLineInboxImagePlaceholderText(text: string | null | undefined): boolean {
  return LINE_INBOX_IMAGE_PLACEHOLDER_REGEX.test(String(text ?? "").trim());
}

function queueGroupHasMatchedCar(group: PendingQueueGroup): boolean {
  return (
    String(group.car_row_id ?? "").trim().length > 0 ||
    String(group.matchStatus ?? "").trim() === "matched" ||
    group.messages.some((message) => queueMessageHasMatchedCar(message))
  );
}

function queueGroupIsUnresolved(group: PendingQueueGroup): boolean {
  return !queueGroupHasMatchedCar(group) && Boolean(group.is_unresolved);
}

function queueMessageIsWaitingForCarRecord(message: PendingQueueMessage): boolean {
  return (
    String(message.matchStatus ?? "").trim() === "waiting_for_car_record" ||
    String(message.unmatchedReason ?? message.unmatched_reason ?? "").trim() === "pending_car_record"
  );
}

function queueGroupIsWaitingForCarRecord(group: PendingQueueGroup): boolean {
  return (
    !queueGroupHasMatchedCar(group) &&
    (String(group.matchStatus ?? "").trim() === "waiting_for_car_record" ||
      String(group.unmatchedReason ?? group.unmatched_reason ?? "").trim() === "pending_car_record" ||
      group.messages.some(queueMessageIsWaitingForCarRecord))
  );
}

function queueMessageIsAmbiguousVehicle(message: PendingQueueMessage): boolean {
  return (
    !queueMessageHasMatchedCar(message) &&
    !queueMessageIsWaitingForCarRecord(message) &&
    (String(message.matchStatus ?? "").trim() === "ambiguous_vehicle" ||
      String(message.unmatchedReason ?? message.unmatched_reason ?? "").trim() === "multiple_candidates")
  );
}

function queueGroupIsAmbiguousVehicle(group: PendingQueueGroup): boolean {
  return (
    !queueGroupHasMatchedCar(group) &&
    !queueGroupIsWaitingForCarRecord(group) &&
    (String(group.matchStatus ?? "").trim() === "ambiguous_vehicle" ||
      String(group.unmatchedReason ?? group.unmatched_reason ?? "").trim() === "multiple_candidates" ||
      group.messages.some(queueMessageIsAmbiguousVehicle))
  );
}

type LineInboxQueueCardKind = "actionable" | "matched_no_work" | "waiting_for_car_record" | "unresolved";

function queueMessageIsMatchedNoWork(message: PendingQueueMessage): boolean {
  if (queueMessageHasWorkItems(message)) return false;
  if (queueMessageIsWaitingForCarRecord(message)) return false;
  return (
    String(message.extractionStatus ?? "").trim() === "matched_no_work" ||
    (queueMessageHasMatchedCar(message) && !queueMessageHasWorkItems(message))
  );
}

function queueMessageCardKind(message: PendingQueueMessage): LineInboxQueueCardKind {
  if (queueMessageHasWorkItems(message)) return "actionable";
  if (queueMessageIsWaitingForCarRecord(message)) return "waiting_for_car_record";
  if (queueMessageIsMatchedNoWork(message)) return "matched_no_work";
  return "unresolved";
}

function queueMessageStatusHeadline(message: PendingQueueMessage, uiLang: UiLang): string {
  switch (queueMessageCardKind(message)) {
    case "matched_no_work":
      return uiLang === "en" ? "Car matched" : "จับรถได้แล้ว ✅";
    case "waiting_for_car_record":
      return uiLang === "en" ? "Waiting for car record" : "รอรถเข้าระบบ 🚧";
    case "unresolved":
      return uiLang === "en" ? "Car not identified yet" : "ยังไม่รู้ว่ารถคันไหน";
    default:
      return uiLang === "en" ? "New LINE work" : "งานใหม่จาก LINE";
  }
}

function queueMessageStatusSubline(message: PendingQueueMessage, uiLang: UiLang): string {
  const reason = String(message.manual_review_reason ?? "").trim();
  switch (queueMessageCardKind(message)) {
    case "matched_no_work":
      return uiLang === "en"
        ? "No actionable work item found. Open this car to add tasks manually."
        : "ยังไม่พบรายการงาน\nแตะเพื่อเปิดรถคันนี้และเพิ่มงานเอง";
    case "waiting_for_car_record":
      return uiLang === "en"
        ? "This vehicle is not in the current records yet. It may not be in Record / not synced / ref mismatch."
        : "ระบบยังไม่พบรถคันนี้ในข้อมูลปัจจุบัน\nอาจเป็นรถที่ยังไม่เข้า Record / ยังไม่ sync / เลขอ้างอิงยังไม่ตรง";
    case "unresolved":
      return uiLang === "en"
        ? "Choose or search for a car, or skip this message."
        : "กรุณาเลือก/ค้นหารถเอง หรือข้าม";
    default:
      return "";
  }
}

/** Vehicle hint for waiting-for-record rows — not treated as a matched car title. */
function queueMessageWaitingVehiclePreview(message: PendingQueueMessage): string {
  const aiRef = String(message.aiTargetCarReference ?? "").trim();
  if (aiRef) return aiRef;
  const detected = message.detected_car ?? null;
  const plate = String(detected?.plate_text ?? message.plate_display ?? "").trim();
  const spec = String(detected?.spec_text ?? message.car_title ?? "").trim();
  const parts = [plate && plate !== "-" ? plate : "", spec].filter(Boolean);
  if (parts.length > 0) return parts.join(" ").trim();
  return String(message.fallback_description ?? message.fallbackDescription ?? "").trim();
}

/** Primary label for queue cards — never use raw LINE text as the car title when car_row_id is missing. */
function queueMessagePrimaryCarLabel(message: PendingQueueMessage, uiLang: UiLang): string {
  if (queueMessageIsWaitingForCarRecord(message)) {
    return queueMessageWaitingVehiclePreview(message);
  }
  const carRowId = String(message.car_row_id ?? "").trim();
  if (carRowId) {
    const detected = queueDetectedCarLabel(message);
    if (detected) return detected;
    const titled = queueMessageDisplayTitle(message, uiLang);
    if (titled && titled !== "-" && titled !== "ยังไม่จับรถ") return titled;
  }
  const aiRef = String(message.aiTargetCarReference ?? "").trim();
  if (aiRef) return aiRef;
  const detected = queueDetectedCarLabel(message);
  if (detected) return detected;
  const candidates = queueCandidateLabels(message.extractedCarCandidates);
  if (candidates.length > 0) return candidates[0] ?? "";
  return "";
}

function queueMessageWorkActionLines(message: PendingQueueMessage): PendingQueueActionLine[] {
  return (message.action_lines ?? []).filter(
    (line) =>
      !isLineInboxImagePlaceholderText(line.raw_text) &&
      !isLineInboxImagePlaceholderText(line.suggested_item_name)
  );
}

function queueMessageSuggestedItemNames(message: PendingQueueMessage): string[] {
  const names = (message.suggestedItems ?? []).map((item) => String(item).trim()).filter(Boolean);
  if (names.length > 0) return names;
  const groupNames = (message as PendingQueueMessage & { suggested_items?: string[] }).suggested_items;
  return (groupNames ?? []).map((item) => String(item).trim()).filter(Boolean);
}

function queueMessageDisplayActionLines(message: PendingQueueMessage): PendingQueueActionLine[] {
  const workLines = queueMessageWorkActionLines(message);
  if (workLines.length > 0) return workLines;
  return queueMessageSuggestedItemNames(message).map((name, itemIndex) => ({
    item_index: 10_000 + itemIndex,
    raw_text: name,
    suggested_item_name: name,
    suggested_note: "",
    suggested_status: "เช็ค",
    duplicate_status: "new" as DuplicateStatus,
    matched_order_item_id: "",
    matched_item_name: "",
    confidence: 0.55,
    reason: "",
    default_action: "create" as const,
    included_by_default: true,
  }));
}

function queueMessageHasWorkItems(message: PendingQueueMessage): boolean {
  return queueMessageDisplayActionLines(message).length > 0;
}

function queueMessageLineAttachments(
  message: PendingQueueMessage,
  group: PendingQueueGroup
): PendingQueueAttachment[] {
  const messageId = String(message.inbox_id ?? "").trim();
  const combined = [...(message.attachments ?? []), ...(group.attachments ?? [])];
  const seen = new Set<string>();
  const out: PendingQueueAttachment[] = [];
  for (const attachment of combined) {
    const url = String(attachment.url ?? "").trim();
    if (!url || seen.has(url)) continue;
    const related = String(attachment.related_text_message_id ?? attachment.relatedTextMessageId ?? "").trim();
    const preview = String(attachment.raw_text_preview ?? attachment.rawTextPreview ?? "").trim();
    const isImageRow = isLineInboxImagePlaceholderText(preview);
    if (messageId && related && related !== messageId) continue;
    if (!related && !isImageRow && !(message.attachments ?? []).some((item) => item.url === url)) continue;
    seen.add(url);
    out.push(attachment);
  }
  return out;
}

function queueMessageRawText(message: PendingQueueMessage): string {
  const raw = String(message.raw_text || message.raw_text_preview || "").trim();
  if (isLineInboxImagePlaceholderText(raw)) return "";
  return raw;
}

function queueMessageManualReviewTitle(message: PendingQueueMessage, uiLang: UiLang): string {
  return queueMessageStatusHeadline(message, uiLang);
}

function queueMessageManualReviewReason(message: PendingQueueMessage, uiLang: UiLang): string {
  const reason = String(message.manual_review_reason ?? "").trim();
  if (reason) return reason;
  if (queueMessageIsWaitingForCarRecord(message)) {
    return uiLang === "en"
      ? "This looks like a vehicle from LINE, but it is not in the current car records yet. Check Record/sync/ref number before saving."
      : "ระบบยังไม่พบรถคันนี้ในข้อมูลปัจจุบัน อาจเป็นรถที่ยังไม่เข้า Record / ยังไม่ sync / เลขอ้างอิงยังไม่ตรง กรุณาตรวจสอบอีกครั้ง";
  }
  if (queueMessageIsAmbiguousVehicle(message)) {
    return uiLang === "en"
      ? "This LINE text matches multiple vehicle candidates. Search/select the car before saving."
      : "ข้อความนี้คล้ายข้อมูลรถหลายคัน กรุณาค้นหา/เลือกเองก่อนบันทึก";
  }
  if (queueMessageHasMatchedCar(message)) {
    return uiLang === "en"
      ? "AI could not split work items yet - manual review needed."
      : "AI ยังแยกงานไม่ได้ — รอตรวจด้วยมือ";
  }
  return uiLang === "en"
    ? "This message has no clear plate, stock/ref, or vehicle context. Search/select a car, or skip it."
    : "ข้อความนี้ยังไม่มีทะเบียน เลขรถ หรือข้อมูลรถที่ชัดเจน กรุณาค้นหา/เลือกคันรถเอง หรือข้าม";
}

function queueDetectedCarLabel(message: PendingQueueMessage): string {
  const detected = message.detected_car ?? null;
  const hasDetectedCar =
    Boolean(String(detected?.car_row_id ?? "").trim()) ||
    Boolean(String(detected?.plate_text ?? "").trim()) ||
    Boolean(String(detected?.spec_text ?? "").trim()) ||
    Boolean(String(message.car_row_id ?? "").trim());
  if (!hasDetectedCar) return "";
  const plate = String(detected?.plate_text ?? "").trim();
  const spec = String(detected?.spec_text ?? message.car_title ?? "").trim();
  const chassis = String(detected?.chassis ?? "").trim();
  const parts = [plate && plate !== "-" ? plate : "", spec, chassis].filter(Boolean);
  const label = parts.join(" ").trim();
  if (label) return label;
  if (String(message.car_row_id ?? "").trim()) {
    return (
      String(message.car_title ?? "").trim() ||
      String(message.fallback_title ?? message.fallbackTitle ?? "").trim() ||
      `car_row_id: ${message.car_row_id}`
    );
  }
  return "";
}

function queueCandidateLabels(candidates: LineInboxCarCandidate[] | undefined): string[] {
  const out: string[] = [];
  for (const candidate of candidates ?? []) {
    const text = String(candidate.text ?? "").trim();
    if (!text) continue;
    const suffix = String(candidate.confidence ?? "").trim();
    const label = suffix ? `${text} (${suffix})` : text;
    if (!out.some((item) => item.toLowerCase() === label.toLowerCase())) out.push(label);
    if (out.length >= 4) break;
  }
  return out;
}

function formatQueueMessageReceivedAt(value: string, uiLang: UiLang): string {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString(uiLang === "en" ? "en-US" : "th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function duplicateLabel(uiLang: UiLang, status: DuplicateStatus): string {
  if (uiLang === "en") {
    switch (status) {
      case "new":
        return "New";
      case "duplicate":
        return "Duplicate";
      case "possible_duplicate":
        return "Maybe dup.";
      default:
        return "Unclear";
    }
  }
  return duplicateLabelTh(status);
}

function queueGroupDisplayTitle(group: PendingQueueGroup, uiLang: UiLang): string {
  const plate = String(group.plate_display ?? "").trim();
  const title = String(group.car_title ?? "").trim();
  const fallback = String(group.fallback_title ?? group.fallbackTitle ?? "").trim();
  return buildDisplayCarLabel({ plate, title, fallback, uiLang });
}

function queueMessageDisplayTitle(message: PendingQueueMessage, uiLang: UiLang): string {
  const plate = String(message.plate_display ?? "").trim();
  const title = String(message.car_title ?? "").trim();
  const fallback = String(message.fallback_title ?? message.fallbackTitle ?? "").trim();
  return buildDisplayCarLabel({ plate, title, fallback, uiLang });
}

type QueueMatchedCarOption = {
  key: string;
  carRowId: string;
  carId: number | null;
  label: string;
  order: LineInboxAiOrderPick | null;
};

function orderPickLabel(order: LineInboxAiOrderPick): string {
  return [String(order.fullPlate ?? "").trim(), String(order.car ?? "").trim()].filter(Boolean).join(" ").trim();
}

function optionFromMatchedCandidate(candidate: LineInboxMatchedCarCandidate): QueueMatchedCarOption | null {
  const carRowId = String(candidate.car_row_id ?? "").trim();
  if (!carRowId) return null;
  const carId = Number(candidate.car_id);
  return {
    key: carRowId,
    carRowId,
    carId: Number.isFinite(carId) ? carId : null,
    label:
      String(candidate.label ?? "").trim() ||
      [String(candidate.plate_text ?? "").trim(), String(candidate.spec_text ?? "").trim()].filter(Boolean).join(" ").trim() ||
      carRowId,
    order: null,
  };
}

function optionFromOrderPick(order: LineInboxAiOrderPick): QueueMatchedCarOption | null {
  const carRowId = String(order.carRowId ?? "").trim();
  if (!carRowId) return null;
  const carId = Number(order.carId);
  return {
    key: carRowId,
    carRowId,
    carId: Number.isFinite(carId) ? carId : null,
    label: orderPickLabel(order) || carRowId,
    order,
  };
}

function uniqueQueueMatchedCarOptions(options: Array<QueueMatchedCarOption | null>): QueueMatchedCarOption[] {
  const out: QueueMatchedCarOption[] = [];
  const seen = new Set<string>();
  for (const option of options) {
    if (!option) continue;
    const key = option.carRowId || option.key;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(option);
  }
  return out;
}

function imageOnlyQueueMessage(uiLang: UiLang, count: number): string {
  const safeCount = Math.max(0, count);
  return uiLang === "en"
    ? `No new text messages. ${safeCount} LINE photo(s) are waiting for review.`
    : `ไม่มีข้อความใหม่ มีรูปจาก LINE ${safeCount} รูปรอตรวจ`;
}

function ImageOnlyEmptyCallout({
  uiLang,
  photoCount,
  onOpenPhotosTab,
}: {
  uiLang: UiLang;
  photoCount: number;
  onOpenPhotosTab: () => void;
}) {
  if (photoCount <= 0) return null;
  return (
    <div className="rounded-xl bg-violet-50/90 px-3 py-3 ring-1 ring-violet-200">
      <p className="text-[12px] leading-relaxed text-violet-950">{imageOnlyQueueMessage(uiLang, photoCount)}</p>
      <button
        type="button"
        onClick={onOpenPhotosTab}
        className="mt-2.5 min-h-11 w-full rounded-full bg-violet-700 px-4 text-[12px] font-bold text-white ring-1 ring-violet-600 touch-manipulation active:bg-violet-800"
      >
        {uiLang === "en" ? `Open LINE photos (${photoCount})` : `เปิดแท็บ รูปจาก LINE (${photoCount})`}
      </button>
    </div>
  );
}

function formatQueueAttachmentTime(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function queueAttachmentCarLabel(attachment: PendingQueueAttachment, uiLang: UiLang): string {
  const carTitle = String(attachment.car_title ?? "").trim();
  const plate = String(attachment.plate_display ?? "").trim();
  const fallback = String(attachment.fallback_title ?? attachment.fallbackTitle ?? "").trim();
  const sale = String(attachment.sale ?? "").trim();
  const base = (carTitle && carTitle !== "-" ? carTitle : "") || (plate && plate !== "-" ? plate : "") || fallback;
  if (!base) return uiLang === "en" ? "No car selected yet" : "ยังไม่ได้เลือกรถ";
  return sale ? `${base} · ${sale}` : base;
}

function revokeStagedPhotoMap(map: Record<string, LineInboxStagedPhoto[]>) {
  Object.values(map).forEach((list) => {
    list.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
  });
}

function stablePillIndex(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

const LINE_INBOX_ASSIGNEE_SURFACE_CLASSES = [
  "bg-emerald-100 text-emerald-950 ring-emerald-300",
  "bg-cyan-100 text-cyan-950 ring-cyan-300",
  "bg-lime-100 text-lime-950 ring-lime-300",
  "bg-violet-100 text-violet-950 ring-violet-300",
  "bg-fuchsia-100 text-fuchsia-950 ring-fuchsia-300",
  "bg-amber-100 text-amber-950 ring-amber-300",
  "bg-sky-100 text-sky-950 ring-sky-300",
  "bg-rose-100 text-rose-950 ring-rose-300",
];

function lineInboxAssigneeLinkClasses(assignee: string | null | undefined): string {
  const name = String(assignee ?? "").trim();
  if (!name) return "bg-white text-slate-700 ring-slate-200";
  return LINE_INBOX_ASSIGNEE_SURFACE_CLASSES[
    stablePillIndex(name) % LINE_INBOX_ASSIGNEE_SURFACE_CLASSES.length
  ]!;
}

function lineInboxStatusLinkClasses(status: string | null | undefined): string {
  const s = String(status ?? "").trim();
  if (!s) return "bg-white text-slate-700 ring-slate-200";
  if (s === "จบ") return "bg-sky-50 text-sky-800 ring-sky-300";
  if (s === "สั่ง" || s === "เช็ค") return "bg-white text-amber-900 ring-slate-200";
  return "bg-white text-emerald-900 ring-slate-200";
}

function lineInboxAssigneePillClasses(assignee: string | null | undefined): string {
  return lineInboxAssigneeLinkClasses(assignee);
}

function lineInboxStatusPillClasses(status: string | null | undefined): string {
  return lineInboxStatusLinkClasses(status);
}

function LineInboxInlineSelectLink({
  value,
  options,
  onChange,
  title,
  emptyLabel,
  className,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  title: string;
  emptyLabel: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      title={title}
      aria-label={title}
      className={cn(
        "h-11 min-h-[44px] w-[76px] min-w-[4.5rem] shrink-0 touch-manipulation rounded-full border-0 px-2 py-1.5 text-xs font-semibold shadow-sm outline-none ring-1 focus-visible:ring-2 sm:w-[88px]",
        className
      )}
    >
      <option value="">{emptyLabel}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function LineInboxSuggestedItemNameField({
  value,
  uiLang,
  onChange,
  onPhotoReference,
}: {
  value: string;
  uiLang: UiLang;
  onChange: (value: string) => void;
  onPhotoReference: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const text = String(value ?? "");
  const trimmed = text.trim();
  const hasPhotoReference = hasLineInboxPhotoReference(text);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    try {
      el.setSelectionRange(len, len);
    } catch {
      /* ignore */
    }
  }, [editing]);

  const inputClass =
    "min-w-0 flex-1 basis-0 rounded-xl bg-transparent px-1.5 py-1.5 text-sm font-semibold text-slate-900 outline-none focus:bg-white focus:ring-2 focus:ring-slate-300/80";

  if (!hasPhotoReference || editing) {
    return (
      <input
        ref={inputRef}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setEditing(false)}
        placeholder={uiLang === "en" ? "Task name" : "ชื่องาน"}
        className={inputClass}
      />
    );
  }

  const parts = trimmed.split(LINE_INBOX_PHOTO_REF_SPLIT_REGEX).filter(Boolean);
  return (
    <div
      data-line-inbox-item-name-preview=""
      role="button"
      tabIndex={0}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-line-inbox-photo-link]")) return;
        setEditing(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setEditing(true);
        }
      }}
      className="inline-flex max-w-full min-w-0 flex-1 cursor-text flex-nowrap items-baseline gap-0 overflow-x-auto rounded-xl bg-transparent px-1.5 py-1.5 text-sm font-semibold leading-snug text-slate-900 ring-1 ring-transparent hover:bg-slate-50/80 focus:outline-none focus:ring-slate-300"
      title={uiLang === "en" ? "Tap to edit task name" : "ชื่องาน — แตะเพื่อแก้ไข"}
    >
      {parts.map((part, index) => {
        const isPhotoRef = LINE_INBOX_PHOTO_REF_EXACT_REGEX.test(part.trim());
        if (!isPhotoRef) {
          return (
            <span key={`${part}-${index}`} className="whitespace-pre-wrap break-words">
              {part}
            </span>
          );
        }
        return (
          <button
            type="button"
            data-line-inbox-photo-link=""
            key={`${part}-${index}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onPhotoReference();
            }}
            className="inline shrink-0 cursor-pointer border-0 bg-transparent p-0 align-baseline font-inherit font-semibold text-sky-600 underline decoration-sky-400 decoration-2 underline-offset-2 hover:text-sky-700 active:text-sky-800"
            title={uiLang === "en" ? "Upload/view photos for this item" : "เพิ่มรูปและดูรูปตามรายการนี้"}
          >
            {part}
          </button>
        );
      })}
    </div>
  );
}

export type LineInboxPickCarPayload = {
  orderId: string | null;
  carRowId: string | null;
  plate: string;
};

export type LineInboxAiToolbarProps = {
  orders: LineInboxAiOrderPick[];
  uiLang: UiLang;
  preferredOrderId?: string | null;
  staffOptions?: string[];
  saleAssigneesBySale?: Record<string, string>;
  statusOptions?: string[];
  onSaved?: () => void;
  /** Order card to show inline AI queue (per-car flow). */
  focusedOrderId?: string | null;
  onPickCar?: (payload: LineInboxPickCarPayload) => void;
};

type LineInboxCarPickerRow = {
  groupKey: string;
  orderId: string | null;
  carRowId: string | null;
  plate: string;
  spec: string;
  sale: string;
  jobCount: number;
  manualReviewCount: number;
  photoCount: number;
  isUnresolved: boolean;
  isWaitingForCarRecord: boolean;
  isAmbiguousVehicle: boolean;
  manualReviewPreview: string;
  detectedCarLabel: string;
  extractedCarCandidates: LineInboxCarCandidate[];
  aiTargetCarReference: string;
  aiTargetCarConfidence: string;
  matchReason: string;
  contextSource: string;
  replyContextPreview: string;
  sourceLabel: string;
  groupIdDisplay: string;
  fallbackSubtitle: string;
  latestMessageAt: number;
};

type LineInboxQueueDateFilter = LineInboxQueueFilter;

type LineInboxBridgeContextValue = {
  uiLang: UiLang;
  open: boolean;
  setOpen: (open: boolean) => void;
  floatingNavigator: ReactNode;
  overlays: ReactNode;
  renderCarAiSection: (orderId: string, carRowId: string | null, active: boolean) => ReactNode;
};

function groupLatestReceivedMs(group: PendingQueueGroup): number {
  let max = 0;
  for (const m of group.messages) {
    const t = Date.parse(m.received_at);
    if (Number.isFinite(t) && t > max) max = t;
  }
  for (const a of group.attachments ?? []) {
    const t = Date.parse(a.received_at);
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max;
}

function groupMatchesLineInboxFilter(
  group: PendingQueueGroup,
  filter: LineInboxQueueDateFilter,
  todayYmd: string
): boolean {
  return lineInboxQueueGroupMatchesFilter(group, filter, todayYmd);
}

function queueGroupPhotoCount(group: PendingQueueGroup): number {
  return Math.max(0, Number(group.linePhotoCount ?? group.line_photo_count ?? group.attachments?.length ?? 0));
}

function formatLatestLineMessageTime(ms: number, uiLang: UiLang): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(uiLang === "en" ? "en-US" : "th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const LineInboxBridgeContext = createContext<LineInboxBridgeContextValue | null>(null);

export function useLineInboxBridge(): LineInboxBridgeContextValue {
  const ctx = useContext(LineInboxBridgeContext);
  if (!ctx) {
    throw new Error("useLineInboxBridge must be used within LineInboxBridgeProvider");
  }
  return ctx;
}

export function LineInboxBridgeProvider({
  children,
  ...props
}: LineInboxAiToolbarProps & { children: ReactNode }) {
  const bridge = useLineInboxBridgeState(props);
  return (
    <LineInboxBridgeContext.Provider value={bridge}>
      {children}
      {bridge.overlays}
    </LineInboxBridgeContext.Provider>
  );
}

/** Fixed bottom-right FAB + car list bottom sheet (Issue #64). */
export function LineInboxFloatingNavigator() {
  const { floatingNavigator } = useLineInboxBridge();
  return <>{floatingNavigator}</>;
}

export function LineInboxCarAiSection({
  orderId,
  carRowId,
  active,
}: {
  orderId: string;
  carRowId: string | null;
  active: boolean;
}) {
  const { renderCarAiSection } = useLineInboxBridge();
  return <>{renderCarAiSection(orderId, carRowId, active)}</>;
}

/** @deprecated Use LineInboxBridgeProvider + LineInboxFloatingNavigator. */
export function LineInboxAiToolbar(props: LineInboxAiToolbarProps) {
  return (
    <LineInboxBridgeProvider {...props}>
      <LineInboxFloatingNavigator />
    </LineInboxBridgeProvider>
  );
}

/* Manual paste / legacy full-panel helpers kept for a future advanced entry — per-car flow uses queue only. */
/* eslint-disable @typescript-eslint/no-unused-vars */
function useLineInboxBridgeState({
  orders,
  uiLang,
  preferredOrderId,
  staffOptions = [],
  saleAssigneesBySale = {},
  statusOptions = [],
  onSaved,
  focusedOrderId,
  onPickCar,
}: LineInboxAiToolbarProps) {
  const [open, setOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [carSearch, setCarSearch] = useState("");
  const [rawText, setRawText] = useState("");
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState<LineInboxAnalyzeResponse["detected_car"] | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [ignoredVehicleLines, setIgnoredVehicleLines] = useState<string[]>([]);
  const [ignoredMentionLines, setIgnoredMentionLines] = useState<string[]>([]);
  const [ignoredNoiseLines, setIgnoredNoiseLines] = useState<string[]>([]);
  const [existingItems, setExistingItems] = useState<ExistingOrderItemRow[]>([]);
  const [rows, setRows] = useState<RowDraft[]>([]);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [suggestionPhotoSheet, setSuggestionPhotoSheet] = useState<SuggestionPhotoSheetState | null>(null);
  const [suggestionItemPhotos, setSuggestionItemPhotos] = useState<LineInboxItemPhoto[]>([]);
  const [suggestionPhotosLoading, setSuggestionPhotosLoading] = useState(false);
  const [stagedSuggestionPhotos, setStagedSuggestionPhotos] = useState<Record<string, LineInboxStagedPhoto[]>>({});
  const [stagedLineAttachments, setStagedLineAttachments] = useState<Record<string, PendingQueueAttachment[]>>({});
  const [photoBusyRowKey, setPhotoBusyRowKey] = useState<string | null>(null);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyCopied, setReplyCopied] = useState(false);
  const [copiedQueueReplyKey, setCopiedQueueReplyKey] = useState<string | null>(null);

  const [queueMessages, setQueueMessages] = useState<PendingQueueMessage[]>([]);
  const [queueGroups, setQueueGroups] = useState<PendingQueueGroup[]>([]);
  const [queueAttachments, setQueueAttachments] = useState<PendingQueueAttachment[]>([]);
  const [queueTotalNew, setQueueTotalNew] = useState(0);
  const [queueTotalAction, setQueueTotalAction] = useState(0);
  const [queueTotalManualReview, setQueueTotalManualReview] = useState(0);
  const [queueFilterCounts, setQueueFilterCounts] = useState<LineInboxQueueFilterCounts>({
    all: 0,
    today: 0,
    yesterday: 0,
    manual: 0,
    waiting_for_car: 0,
  });
  const [queueTab, setQueueTab] = useState<"actions" | "messages" | "photos">("actions");
  const [queueDateFilter, setQueueDateFilter] = useState<LineInboxQueueDateFilter>("all");
  const [queueDrafts, setQueueDrafts] = useState<Record<string, QueueActionDraft>>({});
  const [queueSelectedCars, setQueueSelectedCars] = useState<Record<string, QueueMatchedCarOption>>({});
  /** Unchecked = not saved when user clicks save (default: all lines selected) */
  const [queueDeselected, setQueueDeselected] = useState<Record<string, Set<number>>>({});
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [savingInboxId, setSavingInboxId] = useState<string | null>(null);
  const queueSigRef = useRef<string>("");
  const queueHasLoadedRef = useRef(false);

  const fetchQueue = useCallback(async (options: { background?: boolean } = {}) => {
    const background = Boolean(options.background);
    if (!background) setQueueLoading(true);
    setQueueError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const params = new URLSearchParams({
        mode: "summary",
        filter: queueDateFilter,
      });
      const res = await fetch(`/api/line-inbox/pending-queue?${params.toString()}`, {
        credentials: "same-origin",
        signal: controller.signal,
      });
      const data = (await res.json()) as {
        ok?: boolean;
        filter_counts?: Partial<LineInboxQueueFilterCounts>;
        total_new_lines?: number;
        total_action_lines?: number;
        total_manual_reviews?: number;
        messages?: PendingQueueMessage[];
        groups?: PendingQueueGroup[];
        recent_attachments?: PendingQueueAttachment[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || res.statusText);
      const list = data.messages ?? [];
      const groups = data.groups ?? [];
      const attachments = (data.recent_attachments ?? []).filter((attachment) => attachment.url);
      const todayYmd = todayYmdBangkokForLineInboxQueue();
      const fallbackCounts: LineInboxQueueFilterCounts = {
        all: groups.filter((group) => groupMatchesLineInboxFilter(group, "all", todayYmd)).length,
        today: groups.filter((group) => groupMatchesLineInboxFilter(group, "today", todayYmd)).length,
        yesterday: groups.filter((group) => groupMatchesLineInboxFilter(group, "yesterday", todayYmd)).length,
        manual: groups.filter((group) => groupMatchesLineInboxFilter(group, "manual", todayYmd)).length,
        waiting_for_car: groups.filter((group) => groupMatchesLineInboxFilter(group, "waiting_for_car", todayYmd))
          .length,
      };
      setQueueFilterCounts({
        all: Number(data.filter_counts?.all ?? fallbackCounts.all) || 0,
        today: Number(data.filter_counts?.today ?? fallbackCounts.today) || 0,
        yesterday: Number(data.filter_counts?.yesterday ?? fallbackCounts.yesterday) || 0,
        manual: Number(data.filter_counts?.manual ?? fallbackCounts.manual) || 0,
        waiting_for_car: Number(data.filter_counts?.waiting_for_car ?? fallbackCounts.waiting_for_car) || 0,
      });
      setQueueTotalNew(typeof data.total_new_lines === "number" ? data.total_new_lines : 0);
      setQueueTotalAction(typeof data.total_action_lines === "number" ? data.total_action_lines : 0);
      setQueueTotalManualReview(typeof data.total_manual_reviews === "number" ? data.total_manual_reviews : 0);
      setQueueMessages(list);
      setQueueGroups(groups);
      setQueueAttachments(attachments);
      queueHasLoadedRef.current = true;

      const sig = list
        .map(
          (m) =>
            `${m.inbox_id}:${queueMessageNeedsManualReview(m) ? "manual" : "items"}:${(m.action_lines ?? m.new_lines)
              .map((l) => l.item_index)
              .join(",")}:${m.received_at}`
        )
        .join("|");
      if (sig !== queueSigRef.current) {
        queueSigRef.current = sig;
        setQueueDeselected((prev) => {
          const nextDes: Record<string, Set<number>> = { ...prev };
          for (const m of list) nextDes[m.inbox_id] = new Set(prev[m.inbox_id] ?? []);
          return nextDes;
        });
        setQueueDrafts((prev) => {
          const nextDrafts: Record<string, QueueActionDraft> = { ...prev };
          for (const group of groups) {
            const fallbackAssignee = resolveSaleStaffForOrder(group.sale, saleAssigneesBySale);
            for (const message of group.messages) {
              for (const line of message.action_lines ?? []) {
                const rowKey = queueSuggestionRowKey(message.inbox_id, line.item_index);
                nextDrafts[rowKey] = prev[rowKey] ?? queueActionDraftForLine(line, fallbackAssignee);
              }
            }
          }
          return nextDrafts;
        });
      }
    } catch (e) {
      const msg = e instanceof Error && e.name === "AbortError"
        ? uiLang === "en"
          ? "LINE queue took too long to load. Try refresh."
          : "โหลดคิว LINE นานเกินไป ลองกดรีเฟรชอีกครั้ง"
        : e instanceof Error
          ? e.message
          : String(e);
      setQueueError(msg);
      if (!background) {
        setQueueMessages([]);
        setQueueGroups([]);
        setQueueAttachments([]);
        setQueueTotalNew(0);
        setQueueTotalAction(0);
        setQueueTotalManualReview(0);
        queueHasLoadedRef.current = false;
      }
    } finally {
      window.clearTimeout(timeout);
      if (!background) setQueueLoading(false);
    }
  }, [queueDateFilter, saleAssigneesBySale, uiLang]);

  useEffect(() => {
    void fetchQueue();
    const t = window.setInterval(() => void fetchQueue({ background: true }), LINE_INBOX_QUEUE_REFRESH_MS);
    return () => window.clearInterval(t);
  }, [fetchQueue]);

  useEffect(() => {
    if (open) void fetchQueue({ background: queueHasLoadedRef.current });
  }, [open, fetchQueue]);

  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (orders.length === 0) {
      setSelectedOrderId("");
      return;
    }
    const pref = String(preferredOrderId ?? "").trim();
    if (pref && orders.some((o) => o.id === pref)) {
      setSelectedOrderId(pref);
      return;
    }
    setSelectedOrderId((prev) => {
      if (prev && orders.some((o) => o.id === prev)) return prev;
      return "";
    });
  }, [orders, preferredOrderId]);

  const selected = useMemo(
    () => orders.find((o) => o.id === selectedOrderId) ?? null,
    [orders, selectedOrderId]
  );

  const visibleOrders = useMemo(() => {
    const q = carSearch.trim();
    const filtered = q
      ? orders.filter((o) =>
          matchesVehicleSearch(
            {
              plate: String(o.fullPlate ?? "").replace(/\D/g, ""),
              fullPlate: o.fullPlate,
              chassis: o.chassis,
              car: `${o.car} ${o.sale ?? ""} ${o.carRowId ?? ""} ${o.carId ?? ""}`,
            },
            q
          )
        )
      : orders;
    if (selected && !filtered.some((o) => o.id === selected.id)) {
      return [selected, ...filtered];
    }
    return filtered;
  }, [carSearch, orders, selected]);

  const ordersByCarRowId = useMemo(() => {
    const map = new Map<string, LineInboxAiOrderPick>();
    for (const order of orders) {
      const id = String(order.carRowId ?? "").trim();
      if (id) map.set(id, order);
    }
    return map;
  }, [orders]);

  const openCarFromQueue = useCallback(
    (message: PendingQueueMessage, group: PendingQueueGroup) => {
      const carRowId = String(message.car_row_id ?? group.car_row_id ?? "").trim();
      const plateHint =
        queueMessagePrimaryCarLabel(message, uiLang) ||
        queueDetectedCarLabel(message) ||
        String(message.plate_display ?? "").trim() ||
        "-";
      let order = carRowId ? ordersByCarRowId.get(carRowId) ?? null : null;
      if (!order && plateHint && plateHint !== "-") {
        const plateKey = normalizeLookup(plateHint);
        order =
          orders.find((o) => {
            const fullPlateKey = normalizeLookup(o.fullPlate);
            return fullPlateKey === plateKey || fullPlateKey.includes(plateKey) || plateKey.includes(fullPlateKey);
          }) ?? null;
      }
      setOpen(false);
      onPickCar?.({
        orderId: order?.id ?? null,
        carRowId: carRowId || order?.carRowId || null,
        plate: order?.fullPlate || plateHint,
      });
    },
    [onPickCar, orders, ordersByCarRowId, uiLang]
  );

  const searchCarFromQueue = useCallback(
    (message: PendingQueueMessage) => {
      const plateHint =
        queueMessagePrimaryCarLabel(message, uiLang) ||
        queueDetectedCarLabel(message) ||
        String(message.aiTargetCarReference ?? "").trim() ||
        String(message.plate_display ?? "").trim() ||
        "-";
      setOpen(false);
      if (plateHint && plateHint !== "-") setCarSearch(plateHint);
      onPickCar?.({ orderId: null, carRowId: null, plate: plateHint });
    },
    [onPickCar, uiLang]
  );

  const detectedOrder = useMemo(() => {
    if (!detected) return null;

    const rowId = String(detected.car_row_id ?? "").trim();
    if (rowId) {
      const byRow = orders.find((o) => String(o.carRowId ?? "").trim() === rowId);
      if (byRow) return byRow;
    }

    const plateKey = normalizeLookup(detected.plate_text);
    if (plateKey) {
      const byPlate = orders.find((o) => {
        const fullPlateKey = normalizeLookup(o.fullPlate);
        return fullPlateKey === plateKey || fullPlateKey.includes(plateKey) || plateKey.includes(fullPlateKey);
      });
      if (byPlate) return byPlate;
    }

    const chassisKey = normalizeLookup(detected.chassis);
    if (chassisKey) {
      const byChassis = orders.find((o) => normalizeLookup(o.chassis).includes(chassisKey));
      if (byChassis) return byChassis;
    }

    return selected;
  }, [detected, orders, selected]);

  const detectedCarTitle = useMemo(() => {
    if (!detected) return "";
    const plate = String(detectedOrder?.fullPlate || detected.plate_text || "").trim();
    const car = String(detectedOrder?.car || detected.spec_text || "").trim();
    const title = [plate, car].filter(Boolean).join(" ").trim();
    return title || String(detected.chassis ?? "").trim();
  }, [detected, detectedOrder]);

  const detectedChassis = useMemo(() => {
    if (!detected) return "";
    return String(detectedOrder?.chassis || detected.chassis || "").trim();
  }, [detected, detectedOrder]);

  const detectedSale = String(detectedOrder?.sale || detected?.sale || "").trim();

  const resolveMappedAssigneeForDetectedCar = useCallback(
    (detectedCar: LineInboxAnalyzeResponse["detected_car"] | null) => {
      if (!detectedCar) return "";

      let matchedOrder: LineInboxAiOrderPick | null = null;
      const rowId = String(detectedCar.car_row_id ?? "").trim();
      if (rowId) {
        matchedOrder = orders.find((o) => String(o.carRowId ?? "").trim() === rowId) ?? null;
      }

      const plateKey = normalizeLookup(detectedCar.plate_text);
      if (!matchedOrder && plateKey) {
        matchedOrder =
          orders.find((o) => {
            const fullPlateKey = normalizeLookup(o.fullPlate);
            return fullPlateKey === plateKey || fullPlateKey.includes(plateKey) || plateKey.includes(fullPlateKey);
          }) ?? null;
      }

      const chassisKey = normalizeLookup(detectedCar.chassis);
      if (!matchedOrder && chassisKey) {
        matchedOrder = orders.find((o) => normalizeLookup(o.chassis).includes(chassisKey)) ?? null;
      }

      if (!matchedOrder && selected) matchedOrder = selected;
      const sale = String(matchedOrder?.sale || detectedCar.sale || "").trim();
      return resolveSaleStaffForOrder(sale, saleAssigneesBySale);
    },
    [orders, saleAssigneesBySale, selected]
  );

  const showDebugDetails =
    process.env.NODE_ENV !== "production" &&
    Boolean(
      String(detected?.car_row_id ?? "").trim() ||
        ignoredVehicleLines.length ||
        ignoredMentionLines.length ||
        ignoredNoiseLines.length ||
        rows.some((row) => String(row.reason ?? "").trim())
    );

  const effectiveCarRowId = useMemo(() => {
    const fromAnalyze = String(detected?.car_row_id ?? "").trim();
    return fromAnalyze || String(selected?.carRowId ?? "").trim();
  }, [detected, selected]);

  const effectiveCarId = useMemo(() => {
    const id = selected?.carId;
    return id != null && Number.isFinite(Number(id)) ? Number(id) : null;
  }, [selected]);
  const hasEffectiveCar = Boolean(effectiveCarRowId || effectiveCarId != null);

  const staffChoices = useMemo(() => {
    const out: string[] = [];
    for (const name of staffOptions) addUniqueOption(out, name);
    for (const item of existingItems) addUniqueOption(out, item.assignee_staff);
    for (const row of rows) addUniqueOption(out, row.assignee);
    for (const draft of Object.values(queueDrafts)) addUniqueOption(out, draft.assignee);
    return out;
  }, [existingItems, queueDrafts, rows, staffOptions]);

  const statusChoices = useMemo(() => {
    const out: string[] = [];
    for (const status of statusOptions) addUniqueOption(out, status);
    for (const status of ["เช็ค", "มี", "สั่ง", "มา", "รถนอก", "ช่างนอก", "จบ"]) {
      addUniqueOption(out, status);
    }
    for (const item of existingItems) addUniqueOption(out, item.status);
    for (const row of rows) addUniqueOption(out, row.status);
    for (const draft of Object.values(queueDrafts)) addUniqueOption(out, draft.status);
    return out;
  }, [existingItems, queueDrafts, rows, statusOptions]);

  const pendingSaveCount = useMemo(
    () => rows.filter((r) => r.included && r.action !== "skip").length,
    [rows]
  );
  const selectedRiskCount = useMemo(
    () => rows.filter((r) => r.included && r.action !== "skip" && r.duplicate_status !== "new").length,
    [rows]
  );

  const suggestionPhotoSheetRow = useMemo(() => {
    if (!suggestionPhotoSheet) return null;
    if (suggestionPhotoSheet.rowIndex < 0) return null;
    return rows[suggestionPhotoSheet.rowIndex] ?? null;
  }, [rows, suggestionPhotoSheet]);

  const suggestionPhotoSheetItemId = String(
    suggestionPhotoSheetRow?.matched_order_item_id ?? ""
  ).trim();
  const canUseSuggestionPhotoSheet = Boolean(
    suggestionPhotoSheetItemId && (effectiveCarRowId || effectiveCarId != null)
  );
  const stagedPhotosForOpenSheet = suggestionPhotoSheet
    ? stagedSuggestionPhotos[suggestionPhotoSheet.rowKey] ?? []
    : [];
  const stagedLineAttachmentsForOpenSheet = suggestionPhotoSheet
    ? stagedLineAttachments[suggestionPhotoSheet.rowKey] ?? []
    : [];

  const queueManualReviewCount =
    queueTotalManualReview || queueMessages.reduce((sum, message) => sum + (queueMessageNeedsManualReview(message) ? 1 : 0), 0);
  const queueActionCount = Math.max(0, queueTotalAction + queueManualReviewCount);
  const queueMessageCount = Math.max(
    0,
    queueTotalNew || queueMessages.reduce((sum, message) => sum + Math.max(0, message.new_line_count || 0), 0)
  );
  const queuePhotoCount =
    queueGroups.length > 0
      ? queueGroups.reduce((sum, group) => sum + queueGroupPhotoCount(group), 0)
      : queueAttachments.length;
  const queueMessagesWithNewLines = useMemo(
    () => queueMessages.filter((message) => (message.new_line_count || 0) > 0 && message.new_lines.length > 0),
    [queueMessages]
  );
  const queueHasOnlyPhotos =
    queueActionCount === 0 && queueMessageCount === 0 && pendingSaveCount === 0 && queuePhotoCount > 0;
  /** No new text, but LINE photos waiting — badge should not read as generic "งานใหม่" from action-line totals alone. */
  const queueBadgePrefersPhotos =
    queueManualReviewCount === 0 &&
    queueMessageCount === 0 &&
    pendingSaveCount === 0 &&
    queuePhotoCount > 0 &&
    queueActionCount > 0;
  const queueBadgeIsPhotoLed = queueHasOnlyPhotos || queueBadgePrefersPhotos;
  const rawBadgeTotal = queueBadgeIsPhotoLed
    ? queuePhotoCount
    : (queueActionCount || queueMessageCount) + pendingSaveCount;
  const showBadgeDot = rawBadgeTotal > 0;
  const aiLineBadgeLabel = queueBadgeIsPhotoLed
    ? uiLang === "en"
      ? "new photos"
      : "รูปใหม่"
    : uiLang === "en"
      ? "new jobs"
      : "งานใหม่";

  const carPickerRows = useMemo((): LineInboxCarPickerRow[] => {
    const todayYmd = todayYmdBangkokForLineInboxQueue();
    const rows: LineInboxCarPickerRow[] = [];
    for (const group of queueGroups) {
      if (!groupMatchesLineInboxFilter(group, queueDateFilter, todayYmd)) continue;
      const carRowId = String(group.car_row_id ?? "").trim() || null;
      const matched = carRowId
        ? orders.find((o) => String(o.carRowId ?? "").trim() === carRowId)
        : null;
      const manualReviewCount = Math.max(0, group.total_manual_reviews ?? 0);
      const actionCount = Math.max(0, group.total_action_lines ?? 0);
      const newCount = Math.max(0, group.total_new_lines ?? 0);
      const jobCount = Math.max(actionCount, newCount) + manualReviewCount;
      const photoCount = queueGroupPhotoCount(group);
      const manualReviewMessage = group.messages.find(queueMessageNeedsManualReview) ?? null;
      const fallbackTitle = String(group.fallback_title ?? group.fallbackTitle ?? "").trim();
      const fallbackDescription = String(group.fallback_description ?? group.fallbackDescription ?? "").trim();
      const displayTitle = queueGroupDisplayTitle(group, uiLang);
      const isWaitingForCarRecord = queueGroupIsWaitingForCarRecord(group);
      const isAmbiguousVehicle = queueGroupIsAmbiguousVehicle(group);
      const isUnresolved = queueGroupIsUnresolved(group);
      const vehiclePreview = manualReviewMessage ? queueMessageWaitingVehiclePreview(manualReviewMessage) : "";
      const primaryLabel =
        manualReviewMessage && !isWaitingForCarRecord
          ? queueMessagePrimaryCarLabel(manualReviewMessage, uiLang)
          : "";
      const rowPlate = isWaitingForCarRecord
        ? uiLang === "en"
          ? "Waiting for car record"
          : "รอรถเข้าระบบ 🚧"
        : isUnresolved
          ? uiLang === "en"
            ? "Car not identified"
            : "ยังไม่รู้ว่ารถคันไหน"
          : "";
      const rowSpec = isWaitingForCarRecord
        ? vehiclePreview || String(group.aiTargetCarReference ?? "").trim() || fallbackDescription || ""
        : isUnresolved
          ? primaryLabel || String(group.aiTargetCarReference ?? "").trim() || fallbackDescription || ""
          : "";
      if (jobCount === 0 && photoCount === 0 && !isWaitingForCarRecord) continue;
      rows.push({
        groupKey: group.group_key,
        orderId: matched?.id ?? null,
        carRowId,
        plate:
          rowPlate ||
          matched?.fullPlate ||
          primaryLabel ||
          (displayTitle !== "-" && displayTitle !== "ยังไม่จับรถ" ? displayTitle : "") ||
          (isUnresolved ? "-" : fallbackTitle) ||
          "-",
        spec: rowSpec || String(group.car_title ?? "").trim() || matched?.car || fallbackDescription || "",
        sale: String(group.sale ?? "").trim() || String(matched?.sale ?? "").trim(),
        jobCount,
        manualReviewCount,
        photoCount,
        isUnresolved,
        isWaitingForCarRecord,
        isAmbiguousVehicle,
        manualReviewPreview: manualReviewMessage ? queueMessageRawText(manualReviewMessage).slice(0, 180) : "",
        detectedCarLabel: manualReviewMessage ? queueDetectedCarLabel(manualReviewMessage) : "",
        extractedCarCandidates: group.extractedCarCandidates ?? manualReviewMessage?.extractedCarCandidates ?? [],
        aiTargetCarReference: String(group.aiTargetCarReference ?? manualReviewMessage?.aiTargetCarReference ?? "").trim(),
        aiTargetCarConfidence: String(group.aiTargetCarConfidence ?? manualReviewMessage?.aiTargetCarConfidence ?? "").trim(),
        matchReason: String(group.matchReason ?? manualReviewMessage?.matchReason ?? "").trim(),
        contextSource: String(group.contextSource ?? group.context_source ?? manualReviewMessage?.contextSource ?? manualReviewMessage?.context_source ?? "").trim(),
        replyContextPreview: String(
          group.replyContext?.source_raw_text_preview ??
            group.reply_context?.source_raw_text_preview ??
            manualReviewMessage?.replyContext?.source_raw_text_preview ??
            manualReviewMessage?.reply_context?.source_raw_text_preview ??
            ""
        ).trim(),
        sourceLabel: String(group.source_label ?? manualReviewMessage?.source_label ?? "").trim(),
        groupIdDisplay: String(group.group_id_display ?? manualReviewMessage?.group_id_display ?? "").trim(),
        fallbackSubtitle: String(group.fallback_subtitle ?? group.fallbackSubtitle ?? "").trim(),
        latestMessageAt: groupLatestReceivedMs(group),
      });
    }
    return rows.sort((a, b) => b.latestMessageAt - a.latestMessageAt);
  }, [orders, queueDateFilter, queueGroups, uiLang]);

  /** Badge = number of ready-to-approve LINE/AI groups, not manual review rows. */
  const lineInboxCarCount = queueFilterCounts.all;

  const queueDateFilterOptions = useMemo(() => {
    const todayYmd = todayYmdBangkokForLineInboxQueue();
    const options: Array<{ value: LineInboxQueueDateFilter; label: string; count: number }> = [
      {
        value: "all",
        label: uiLang === "en" ? "Ready to approve" : "พร้อมตรวจงาน",
        count: queueFilterCounts.all,
      },
      {
        value: "today",
        label: uiLang === "en" ? "Today" : "วันนี้",
        count: queueFilterCounts.today,
      },
      {
        value: "yesterday",
        label: uiLang === "en" ? "Yesterday" : "เมื่อวาน",
        count: queueFilterCounts.yesterday,
      },
      {
        value: "manual",
        label: uiLang === "en" ? "Manual review" : "ต้องตรวจเอง",
        count: queueFilterCounts.manual,
      },
      {
        value: "waiting_for_car",
        label: uiLang === "en" ? "Waiting for car" : "รอรถเข้า",
        count: queueFilterCounts.waiting_for_car,
      },
    ];
    return options;
  }, [queueFilterCounts, uiLang]);

  const toggleQueueLine = useCallback((inboxId: string, itemIndex: number) => {
    setQueueDeselected((prev) => {
      const copy = { ...prev };
      const set = new Set(copy[inboxId] ?? []);
      if (set.has(itemIndex)) set.delete(itemIndex);
      else set.add(itemIndex);
      copy[inboxId] = set;
      return copy;
    });
  }, []);

  const updateQueueDraft = useCallback((rowKey: string, patch: Partial<QueueActionDraft>) => {
    setQueueDrafts((prev) => ({
      ...prev,
      [rowKey]: {
        ...(prev[rowKey] ?? {
          included: false,
          action: "create",
          itemName: "",
          assignee: "",
          status: "",
          note: "",
          dueDate: "",
          orderItemId: "",
        }),
        ...patch,
      },
    }));
  }, []);

  const selectedIndicesForInbox = useCallback(
    (m: PendingQueueMessage) => {
      const des = queueDeselected[m.inbox_id] ?? new Set();
      return m.new_lines.map((l) => l.item_index).filter((idx) => !des.has(idx));
    },
    [queueDeselected]
  );

  const selectedQueueActionsForInbox = useCallback(
    (m: PendingQueueMessage, fallbackAssigneeOverride = "") => {
      const fallbackAssignee =
        String(fallbackAssigneeOverride ?? "").trim() ||
        resolveSaleStaffForOrder(String(m.sale ?? ""), saleAssigneesBySale);
      return queueMessageDisplayActionLines(m).flatMap((line) => {
        const rowKey = queueSuggestionRowKey(m.inbox_id, line.item_index);
        const draft = queueDrafts[rowKey] ?? queueActionDraftForLine(line, fallbackAssignee);
        if (!draft.included || draft.action === "skip") return [];
        return [
          {
            item_index: line.item_index,
            action: draft.action,
            order_item_id: draft.action === "merge" ? draft.orderItemId || line.matched_order_item_id : undefined,
            item_name: draft.itemName || line.suggested_item_name || line.raw_text,
            item_status: draft.status || line.suggested_status || undefined,
            note: draft.note || undefined,
            assignee_staff: draft.assignee || undefined,
            due_date: safeDateValue(draft.dueDate) || undefined,
          },
        ];
      });
    },
    [queueDrafts, saleAssigneesBySale]
  );

  const clearStagedForRowKeys = useCallback((rowKeys: string[]) => {
    const keySet = new Set(rowKeys);
    if (keySet.size === 0) return;
    setStagedSuggestionPhotos((prev) => {
      const next = { ...prev };
      keySet.forEach((key) => {
        (next[key] ?? []).forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
        delete next[key];
      });
      return next;
    });
    setStagedLineAttachments((prev) => {
      const next = { ...prev };
      keySet.forEach((key) => delete next[key]);
      return next;
    });
  }, []);

  const runAnalyze = useCallback(async () => {
    setError(null);
    setSaveHint(null);
    setReplyText("");
    setReplyCopied(false);
    setAnalyzeLoading(true);
    setExistingItems([]);
    try {
      const res = await fetch("/api/line-inbox/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_text: rawText,
          car_row_id: selected?.carRowId?.trim() || undefined,
          car_id: effectiveCarId,
        }),
      });
      const data = (await res.json()) as LineInboxAnalyzeResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || res.statusText || "analyze failed");
      setDetected(data.detected_car);
      setNeedsReview(Boolean(data.needs_human_review));
      setIgnoredVehicleLines(data.ignored_vehicle_spec_lines ?? []);
      setIgnoredMentionLines(data.ignored_mention_lines ?? []);
      setIgnoredNoiseLines(data.ignored_noise_lines ?? []);
      const existingFromAnalyze = data.existing_items ?? [];
      setExistingItems(existingFromAnalyze);
      const existingById = new Map(
        existingFromAnalyze.map((item) => [String(item.id ?? "").trim(), item])
      );
      const mappedAssignee = resolveMappedAssigneeForDetectedCar(data.detected_car);
      const next: RowDraft[] = (data.items ?? []).map((item) => {
        const action = defaultAction(item);
        const matched = existingById.get(String(item.matched_order_item_id ?? "").trim());
        return {
          ...item,
          action,
          note: "",
          included: action !== "skip",
          itemName: item.suggested_item_name || item.raw_text,
          assignee: matched?.assignee_staff || mappedAssignee || "",
          status: item.suggested_status || matched?.status || "",
          dueDate: safeDateValue(matched?.due_date),
        };
      });
      setRows(next);
      setExpandedRows({});
      setSuggestionPhotoSheet(null);
      setSuggestionItemPhotos([]);
      setStagedSuggestionPhotos((prev) => {
        revokeStagedPhotoMap(prev);
        return {};
      });
      setStagedLineAttachments({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
      setExpandedRows({});
      setSuggestionPhotoSheet(null);
      setSuggestionItemPhotos([]);
      setStagedSuggestionPhotos((prev) => {
        revokeStagedPhotoMap(prev);
        return {};
      });
      setStagedLineAttachments({});
      setDetected(null);
      setExistingItems([]);
      setIgnoredVehicleLines([]);
      setIgnoredMentionLines([]);
      setIgnoredNoiseLines([]);
    } finally {
      setAnalyzeLoading(false);
    }
  }, [rawText, selected, effectiveCarId, resolveMappedAssigneeForDetectedCar]);

  const updateRow = useCallback((index: number, patch: Partial<RowDraft>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }, []);

  const toggleRowExpanded = useCallback((rowKey: string) => {
    setExpandedRows((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }));
  }, []);

  const openSuggestionPhotoSheet = useCallback((rowKey: string, rowIndex: number, itemName?: string) => {
    setSuggestionPhotoSheet({ rowKey, rowIndex, itemName });
    setSuggestionItemPhotos([]);
  }, []);

  const closeSuggestionPhotoSheet = useCallback(() => {
    setSuggestionPhotoSheet(null);
    setSuggestionItemPhotos([]);
  }, []);

  const clearStagedSuggestionPhotos = useCallback(() => {
    setStagedSuggestionPhotos((prev) => {
      revokeStagedPhotoMap(prev);
      return {};
    });
  }, []);

  const clearStagedLineAttachments = useCallback(() => {
    setStagedLineAttachments({});
  }, []);

  const stageSuggestionPhotos = useCallback((rowKey: string, files: FileList | null) => {
    const images = Array.from(files ?? []).filter((file) => String(file.type ?? "").startsWith("image/"));
    if (!images.length) return;
    setStagedSuggestionPhotos((prev) => ({
      ...prev,
      [rowKey]: [
        ...(prev[rowKey] ?? []),
        ...images.map((file) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          file,
          previewUrl: URL.createObjectURL(file),
        })),
      ],
    }));
  }, []);

  const removeStagedSuggestionPhoto = useCallback((rowKey: string, photoId: string) => {
    setStagedSuggestionPhotos((prev) => {
      const current = prev[rowKey] ?? [];
      const target = current.find((photo) => photo.id === photoId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      const nextList = current.filter((photo) => photo.id !== photoId);
      const next = { ...prev };
      if (nextList.length) next[rowKey] = nextList;
      else delete next[rowKey];
      return next;
    });
  }, []);

  const toggleStagedLineAttachment = useCallback((rowKey: string, attachment: PendingQueueAttachment) => {
    const id = String(attachment.line_message_id || attachment.url).trim();
    if (!id || !attachment.url) return;
    setStagedLineAttachments((prev) => {
      const current = prev[rowKey] ?? [];
      const exists = current.some((item) => String(item.line_message_id || item.url).trim() === id);
      const nextList = exists
        ? current.filter((item) => String(item.line_message_id || item.url).trim() !== id)
        : [...current, attachment];
      const next = { ...prev };
      if (nextList.length) next[rowKey] = nextList;
      else delete next[rowKey];
      return next;
    });
  }, []);

  const loadSuggestionItemPhotos = useCallback(
    async (orderItemId: string) => {
      const itemId = String(orderItemId ?? "").trim();
      if (!itemId || (!effectiveCarRowId && effectiveCarId == null)) {
        setSuggestionItemPhotos([]);
        return;
      }
      setSuggestionPhotosLoading(true);
      try {
        const params = new URLSearchParams();
        if (effectiveCarRowId) params.set("car_row_id", effectiveCarRowId);
        if (effectiveCarId != null) params.set("car_id", String(effectiveCarId));
        const res = await fetch(`/api/m/order-photos/list?${params.toString()}`, {
          credentials: "same-origin",
        });
        const data = (await res.json()) as {
          error?: string;
          itemPhotosByItemId?: Record<string, LineInboxItemPhoto[]>;
        };
        if (!res.ok) throw new Error(data.error || res.statusText || "load photos failed");
        setSuggestionItemPhotos(data.itemPhotosByItemId?.[itemId] ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setSuggestionItemPhotos([]);
      } finally {
        setSuggestionPhotosLoading(false);
      }
    },
    [effectiveCarId, effectiveCarRowId]
  );

  const uploadSuggestionPhotos = useCallback(
    async (
      rowKey: string,
      orderItemId: string | null | undefined,
      files: FileList | File[] | null,
      options: { silent?: boolean; carRowId?: string | null; carId?: number | null } = {}
    ) => {
      const itemId = String(orderItemId ?? "").trim();
      if (!itemId || !files?.length) return;
      const uploadCarRowId = String(options.carRowId ?? effectiveCarRowId ?? "").trim();
      const uploadCarId = options.carId !== undefined ? options.carId : effectiveCarId;
      if (!uploadCarRowId && uploadCarId == null) return;
      setPhotoBusyRowKey(rowKey);
      setError(null);
      if (!options.silent) setSaveHint(null);
      try {
        const form = new FormData();
        form.append("target_type", "item");
        form.append("order_item_id", itemId);
        if (uploadCarRowId) form.append("car_row_id", uploadCarRowId);
        if (uploadCarId != null) form.append("car_id", String(uploadCarId));
        Array.from(files).forEach((file) => form.append("files", file));
        const res = await fetch("/api/m/order-photos/upload", {
          method: "POST",
          body: form,
          credentials: "same-origin",
        });
        const data = (await res.json()) as { ok?: boolean; error?: string; uploaded?: unknown[] };
        if (!res.ok) throw new Error(data.error || res.statusText || "upload failed");
        const count = Array.isArray(data.uploaded) ? data.uploaded.length : files.length;
        if (!options.silent) {
          setSaveHint(uiLang === "en" ? `Attached ${count} photo(s).` : `แนบรูปแล้ว ${count} รูป`);
        }
        await loadSuggestionItemPhotos(itemId);
        onSaved?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPhotoBusyRowKey((cur) => (cur === rowKey ? null : cur));
      }
    },
    [effectiveCarId, effectiveCarRowId, loadSuggestionItemPhotos, onSaved, uiLang]
  );

  const attachSuggestionPhotoUrls = useCallback(
    async (
      rowKey: string,
      orderItemId: string | null | undefined,
      urls: string[],
      options: { silent?: boolean; carRowId?: string | null; carId?: number | null } = {}
    ) => {
      const itemId = String(orderItemId ?? "").trim();
      const uniqueUrls = Array.from(new Set(urls.map((url) => String(url ?? "").trim()).filter(Boolean)));
      if (!itemId || uniqueUrls.length === 0) return;
      const uploadCarRowId = String(options.carRowId ?? effectiveCarRowId ?? "").trim();
      const uploadCarId = options.carId !== undefined ? options.carId : effectiveCarId;
      if (!uploadCarRowId && uploadCarId == null) return;
      setPhotoBusyRowKey(rowKey);
      setError(null);
      if (!options.silent) setSaveHint(null);
      try {
        const res = await fetch("/api/m/order-photos/fetch-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            target_type: "item",
            order_item_id: itemId,
            car_row_id: uploadCarRowId || undefined,
            car_id: uploadCarId,
            urls: uniqueUrls,
          }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string; uploaded?: unknown[] };
        if (!res.ok) throw new Error(data.error || res.statusText || "attach URL failed");
        const count = Array.isArray(data.uploaded) ? data.uploaded.length : uniqueUrls.length;
        if (!options.silent) {
          setSaveHint(uiLang === "en" ? `Attached ${count} LINE photo(s).` : `แนบรูปจาก LINE แล้ว ${count} รูป`);
        }
        await loadSuggestionItemPhotos(itemId);
        onSaved?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPhotoBusyRowKey((cur) => (cur === rowKey ? null : cur));
      }
    },
    [effectiveCarId, effectiveCarRowId, loadSuggestionItemPhotos, onSaved, uiLang]
  );

  const saveQueueCard = useCallback(
    async (m: PendingQueueMessage, fallbackAssignee = "") => {
      const actions = selectedQueueActionsForInbox(m, fallbackAssignee);
      const indices = actions.length > 0 ? [] : selectedIndicesForInbox(m);
      const selectedCount = actions.length || indices.length;
      if (selectedCount === 0) return;
      const selectedOverride = queueSelectedCars[m.inbox_id] ?? null;
      const manualCarRowId = String(selectedOverride?.carRowId ?? m.car_row_id ?? "").trim();
      if (!manualCarRowId) {
        setError(uiLang === "en" ? "Please select a car before saving." : "กรุณาเลือกคันรถก่อนบันทึก");
        return;
      }
      const riskyCount = (m.action_lines ?? []).filter((line) => {
        const rowKey = queueSuggestionRowKey(m.inbox_id, line.item_index);
        const draft = queueDrafts[rowKey] ?? queueActionDraftForLine(line, fallbackAssignee);
        return draft.included && draft.action !== "skip" && line.duplicate_status !== "new";
      }).length;
      if (riskyCount > 0) {
        const ok = window.confirm(`${riskyCount} selected queue item(s) may be duplicate or unclear. Continue?`);
        if (!ok) return;
      }
      setSavingInboxId(m.inbox_id);
      setError(null);
      setSaveHint(null);
      setReplyText("");
      setReplyCopied(false);
      try {
        const res = await fetch("/api/line-inbox/pending-save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            saves: [
              actions.length > 0
                ? { inbox_message_id: m.inbox_id, car_row_id: selectedOverride?.carRowId, actions }
                : { inbox_message_id: m.inbox_id, car_row_id: selectedOverride?.carRowId, item_indices: indices },
            ],
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          results?: Array<{
            inbox_message_id: string;
            saved_items?: Array<{
              item_index: number;
              order_item_id: string;
              label?: string;
              status?: string;
              assignee_staff?: string;
            }>;
            reply_text?: string;
            copy_ready_reply_text?: string;
            copyReadyReplyText?: string;
            auto_reply?: {
              enabled?: boolean;
              attempted?: boolean;
              sent?: boolean;
              skipped_reason?: string;
              error_reason?: string;
              errorReason?: string;
              error_status?: number;
              errorStatus?: number;
              error?: string;
            };
            autoReply?: {
              enabled?: boolean;
              attempted?: boolean;
              sent?: boolean;
              skipped_reason?: string;
              error_reason?: string;
              errorReason?: string;
              error_status?: number;
              errorStatus?: number;
              error?: string;
            };
          }>;
        };
        if (!res.ok) throw new Error(data.error || res.statusText);

        const resultForMessage = data.results?.find((result) => result.inbox_message_id === m.inbox_id);
        const savedItems =
          resultForMessage?.saved_items ?? [];
        let attachedPhotoCount = 0;
        const touchedRowKeys: string[] = [];

        for (const saved of savedItems) {
          const rowKey = queueSuggestionRowKey(m.inbox_id, saved.item_index);
          const savedItemId = String(saved.order_item_id ?? "").trim();
          if (!savedItemId) continue;
          touchedRowKeys.push(rowKey);

          const staged = stagedSuggestionPhotos[rowKey] ?? [];
          const stagedLineUrls = (stagedLineAttachments[rowKey] ?? [])
            .map((attachment) => attachment.url)
            .filter(Boolean);

          if (staged.length > 0) {
            await uploadSuggestionPhotos(
              rowKey,
              savedItemId,
              staged.map((photo) => photo.file),
              { silent: true, carRowId: manualCarRowId }
            );
            attachedPhotoCount += staged.length;
          }

          if (stagedLineUrls.length > 0) {
            await attachSuggestionPhotoUrls(rowKey, savedItemId, stagedLineUrls, {
              silent: true,
              carRowId: manualCarRowId,
            });
            attachedPhotoCount += stagedLineUrls.length;
          }
        }

        clearStagedForRowKeys(touchedRowKeys);
        const autoReply = resultForMessage?.auto_reply ?? resultForMessage?.autoReply;
        const autoReplyErrorReason = String(autoReply?.error_reason ?? autoReply?.errorReason ?? "");
        const autoReplyErrorStatus = Number(autoReply?.error_status ?? autoReply?.errorStatus ?? 0);
        const isLineQuotaLimit = autoReplyErrorReason === "line_quota_limit" || autoReplyErrorStatus === 429;
        const autoReplyHint =
          autoReply?.sent
            ? uiLang === "en"
              ? " + sent LINE acknowledgement"
              : " + ส่ง LINE รับทราบแล้ว"
            : autoReply?.enabled && autoReply.skipped_reason && autoReply.skipped_reason !== "disabled"
              ? isLineQuotaLimit
                ? uiLang === "en"
                  ? " + LINE reply failed because the monthly quota is not enough for this group. Use Copy below."
                  : " + บันทึกงานแล้ว แต่ LINE ตอบกลับไม่ได้ เพราะ quota รายเดือนเหลือไม่พอสำหรับส่งเข้ากลุ่มนี้ กรุณากด Copy แล้ววางใน LINE เอง"
                : uiLang === "en"
                  ? " + LINE auto-send skipped; copy-ready fallback is below"
                  : " + ส่ง LINE อัตโนมัติไม่สำเร็จ/ข้ามไว้ ใช้ข้อความคัดลอกด้านล่างแทน"
              : "";
        setSaveHint(
          uiLang === "en"
            ? `Saved ${selectedCount} item(s) from LINE queue${attachedPhotoCount ? ` + attached ${attachedPhotoCount} photo(s)` : ""}${autoReplyHint}.`
            : `บันทึกจากคิว LINE แล้ว ${selectedCount} งาน${attachedPhotoCount ? ` + แนบรูป ${attachedPhotoCount} รูป` : ""}${autoReplyHint}`
        );
        const savedLines =
          actions.length > 0
            ? actions.map((line) => ({
                name: String(line.item_name ?? "").trim(),
                status: String(line.item_status ?? "").trim() || "เช็ค",
                assignee: String(line.assignee_staff ?? "").trim(),
              }))
            : m.new_lines
                .filter((line) => indices.includes(line.item_index))
                .map((line) => ({
                  name: line.suggested_item_name || line.raw_text,
                  status: line.suggested_status || "เช็ค",
                  assignee: "",
                }));
        setReplyText(
          String(
            resultForMessage?.copy_ready_reply_text ??
              resultForMessage?.copyReadyReplyText ??
              resultForMessage?.reply_text ??
              ""
          ).trim() ||
            buildLineReplyText({
              plate: queueMessageDisplayTitle(m, uiLang),
              lines: savedLines,
              reviewUrl: buildOrderReviewUrl({ carRowId: manualCarRowId, plate: selectedOverride?.label || m.plate_display }),
              uiLang,
            })
        );
        await fetchQueue();
        onSaved?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingInboxId(null);
      }
    },
    [
      attachSuggestionPhotoUrls,
      clearStagedForRowKeys,
      fetchQueue,
      onSaved,
      queueDrafts,
      queueSelectedCars,
      selectedQueueActionsForInbox,
      selectedIndicesForInbox,
      stagedLineAttachments,
      stagedSuggestionPhotos,
      uiLang,
      uploadSuggestionPhotos,
    ]
  );

  const skipQueueCard = useCallback(
    async (m: PendingQueueMessage) => {
      setSavingInboxId(m.inbox_id);
      setError(null);
      setSaveHint(null);
      try {
        const res = await fetch("/api/line-inbox/pending-save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            saves: [{ inbox_message_id: m.inbox_id, skip_all: true }],
          }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok) throw new Error(data.error || res.statusText);
        const rowKeys = (m.action_lines ?? m.new_lines).map((line) =>
          queueSuggestionRowKey(m.inbox_id, line.item_index)
        );
        clearStagedForRowKeys(rowKeys);
        setSaveHint(uiLang === "en" ? "Skipped this LINE queue message." : "ข้ามข้อความ LINE นี้แล้ว");
        await fetchQueue();
        onSaved?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingInboxId(null);
      }
    },
    [clearStagedForRowKeys, fetchQueue, onSaved, uiLang]
  );

  const skipImageOnlyAttachment = useCallback(
    async (attachment: PendingQueueAttachment) => {
      const inboxId = String(attachment.inbox_id ?? "").trim();
      if (!inboxId) return;
      setSavingInboxId(inboxId);
      setError(null);
      setSaveHint(null);
      try {
        const res = await fetch("/api/line-inbox/pending-save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            saves: [{ inbox_message_id: inboxId, skip_all: true }],
          }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok) throw new Error(data.error || res.statusText);
        setStagedLineAttachments((prev) => {
          const next: Record<string, PendingQueueAttachment[]> = {};
          for (const [rowKey, list] of Object.entries(prev)) {
            const kept = list.filter((item) => item.line_message_id !== attachment.line_message_id);
            if (kept.length > 0) next[rowKey] = kept;
          }
          return next;
        });
        setSaveHint(uiLang === "en" ? "Skipped this LINE photo." : "ข้ามรูปจาก LINE นี้แล้ว");
        await fetchQueue();
        onSaved?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingInboxId(null);
      }
    },
    [fetchQueue, onSaved, uiLang]
  );

  useEffect(() => {
    if (!suggestionPhotoSheet) return;
    if (!suggestionPhotoSheetItemId || !canUseSuggestionPhotoSheet) {
      setSuggestionItemPhotos([]);
      return;
    }
    void loadSuggestionItemPhotos(suggestionPhotoSheetItemId);
  }, [
    canUseSuggestionPhotoSheet,
    loadSuggestionItemPhotos,
    suggestionPhotoSheet,
    suggestionPhotoSheetItemId,
  ]);

  const copyReply = useCallback(async () => {
    const text = replyText.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setReplyCopied(true);
      window.setTimeout(() => setReplyCopied(false), 1400);
    } catch {
      window.prompt(uiLang === "en" ? "Copy LINE reply" : "คัดลอกข้อความตอบ LINE", text);
    }
  }, [replyText, uiLang]);

  const copyQueueReply = useCallback(
    async (group: PendingQueueGroup) => {
      const text = buildQueueAcceptedReplyText(group, uiLang).trim();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        setCopiedQueueReplyKey(group.group_key);
        window.setTimeout(
          () => setCopiedQueueReplyKey((current) => (current === group.group_key ? null : current)),
          1400
        );
      } catch {
        window.prompt(uiLang === "en" ? "Copy LINE reply" : "คัดลอกข้อความตอบ LINE", text);
      }
    },
    [uiLang]
  );

  const runConfirm = useCallback(async () => {
    setError(null);
    setSaveHint(null);
    setReplyText("");
    setReplyCopied(false);
    setConfirmLoading(true);
    try {
      if (!effectiveCarRowId && effectiveCarId == null) {
        throw new Error(
          uiLang === "en"
            ? "Pick a car from the list or run analyze so the car matches."
            : "เลือกรถจากรายการ หรือให้วิเคราะห์จับคู่รถได้ก่อนบันทึก"
        );
      }
      const selectedRows = rows.filter((r) => r.included && r.action !== "skip");
      const riskyRows = selectedRows.filter((r) => r.duplicate_status !== "new");
      if (riskyRows.length > 0) {
        const ok = window.confirm(
          uiLang === "en"
            ? `${riskyRows.length} selected line(s) may be duplicate or unclear. Continue saving?`
            : `มี ${riskyRows.length} รายการที่อาจซ้ำหรือไม่ชัด ต้องการบันทึกต่อหรือไม่?`
        );
        if (!ok) return;
      }
      const confirmations = rows.map((r) => {
        const itemName = String(r.itemName || r.suggested_item_name || r.raw_text).trim();
        const status = String(r.status || r.suggested_status || "").trim();
        const note = String(r.note ?? "").trim();
        const assignee = String(r.assignee ?? "").trim();
        const dueDate = safeDateValue(r.dueDate);
        if (!r.included || r.action === "skip") {
          return {
            action: "skip" as const,
            item_name: itemName,
          };
        }
        return {
          action: r.action,
          order_item_id: r.action === "merge" ? r.matched_order_item_id : undefined,
          item_name: itemName,
          item_status: status || undefined,
          note: note || undefined,
          assignee_staff: assignee || undefined,
          due_date: dueDate || undefined,
        };
      });

      const res = await fetch("/api/line-inbox/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          car_row_id: effectiveCarRowId || undefined,
          car_id: effectiveCarId,
          confirmations,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        saved?: Array<{ order_item_id: string }>;
        skipped_all?: boolean;
      };
      if (!res.ok) throw new Error(data.error || res.statusText || "confirm failed");
      const count = data.skipped_all ? 0 : (data.saved ?? []).length;
      const actionableRowKeys = rows
        .map((r, index) => ({
          row: r,
          rowKey: `${r.raw_text}-${r.matched_order_item_id ?? ""}-${index}`,
        }))
        .filter(({ row }) => row.included && row.action !== "skip");
      let attachedPhotoCount = 0;
      for (let i = 0; i < actionableRowKeys.length; i += 1) {
        const savedItemId = String(data.saved?.[i]?.order_item_id ?? "").trim();
        const rowKey = actionableRowKeys[i]?.rowKey ?? "";
        const staged = rowKey ? stagedSuggestionPhotos[rowKey] ?? [] : [];
        const stagedLineUrls = rowKey
          ? (stagedLineAttachments[rowKey] ?? []).map((attachment) => attachment.url).filter(Boolean)
          : [];
        if (!savedItemId) continue;
        if (staged.length > 0) {
          await uploadSuggestionPhotos(
            rowKey,
            savedItemId,
            staged.map((photo) => photo.file),
            { silent: true }
          );
          attachedPhotoCount += staged.length;
        }
        if (stagedLineUrls.length > 0) {
          await attachSuggestionPhotoUrls(rowKey, savedItemId, stagedLineUrls, { silent: true });
          attachedPhotoCount += stagedLineUrls.length;
        }
      }
      setSaveHint(
        uiLang === "en"
          ? `Saved ${count} line(s)${attachedPhotoCount ? ` + attached ${attachedPhotoCount} photo(s)` : ""}.`
          : `บันทึกแล้ว ${count} รายการ${attachedPhotoCount ? ` + แนบรูป ${attachedPhotoCount} รูป` : ""}`
      );
      setReplyText(
        buildLineReplyText({
          plate: buildDisplayCarLabel({
            plate: detectedOrder?.fullPlate || selected?.fullPlate || detected?.plate_text || "",
            title: detectedOrder?.car || selected?.car || detected?.spec_text || "",
            fallback: detected?.chassis || "",
            uiLang,
          }),
          lines: selectedRows.map((row) => ({
            name: String(row.itemName || row.suggested_item_name || row.raw_text).trim(),
            status: String(row.status || row.suggested_status || "เช็ค").trim(),
            assignee: String(row.assignee ?? "").trim(),
          })),
          reviewUrl: buildOrderReviewUrl({
            carRowId: effectiveCarRowId,
            plate: detectedOrder?.fullPlate || selected?.fullPlate || detected?.plate_text || "",
          }),
          uiLang,
        })
      );
      setRows([]);
      setExpandedRows({});
      setSuggestionPhotoSheet(null);
      setSuggestionItemPhotos([]);
      clearStagedSuggestionPhotos();
      clearStagedLineAttachments();
      setDetected(null);
      setExistingItems([]);
      setIgnoredVehicleLines([]);
      setIgnoredMentionLines([]);
      setIgnoredNoiseLines([]);
      setRawText("");
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirmLoading(false);
    }
  }, [
    attachSuggestionPhotoUrls,
    clearStagedLineAttachments,
    clearStagedSuggestionPhotos,
    detected,
    detectedOrder,
    effectiveCarId,
    effectiveCarRowId,
    rows,
    onSaved,
    selected,
    stagedLineAttachments,
    stagedSuggestionPhotos,
    uiLang,
    uploadSuggestionPhotos,
  ]);

  const carDrawerList = (
    <ul className="space-y-2 pb-2 pr-0.5">
      {carPickerRows.map((row) => (
        <li key={row.groupKey}>
          <button
            type="button"
            disabled={!row.orderId}
            onClick={() => {
              if (!row.orderId) return;
              setOpen(false);
              onPickCar?.({ orderId: row.orderId, carRowId: row.carRowId, plate: row.plate });
            }}
            className={cn(
              "w-full rounded-2xl px-3 py-3 text-left ring-1 touch-manipulation",
              row.orderId
                ? "bg-slate-50 ring-slate-200/80 active:bg-violet-50"
                : "cursor-not-allowed bg-slate-100/80 ring-slate-200/60 opacity-70"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 truncate text-base font-bold text-slate-950">{row.plate}</p>
              {row.latestMessageAt > 0 ? (
                <span className="shrink-0 text-[10px] font-semibold tabular-nums text-slate-500">
                  {formatLatestLineMessageTime(row.latestMessageAt, uiLang)}
                </span>
              ) : null}
            </div>
            {row.spec ? (
              <p className="mt-0.5 line-clamp-2 text-[12px] font-medium text-slate-600">{row.spec}</p>
            ) : null}
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-semibold text-slate-500">
              {row.sale ? <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-slate-200">{row.sale}</span> : null}
              {row.jobCount > 0 ? (
                <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-emerald-800 ring-1 ring-emerald-200">
                  {uiLang === "en" ? `${row.jobCount} new jobs` : `งานใหม่ ${row.jobCount}`}
                </span>
              ) : null}
              {row.photoCount > 0 ? (
                <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-violet-800 ring-1 ring-violet-200">
                  {uiLang === "en" ? `${row.photoCount} LINE photos` : `รูป LINE ${row.photoCount}`}
                </span>
              ) : null}
              {row.manualReviewCount > 0 ? (
                <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-800 ring-1 ring-amber-200">
                  {uiLang === "en" ? "Manual review" : "รอตรวจด้วยมือ"}
                </span>
              ) : null}
              {row.isWaitingForCarRecord ? (
                <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-sky-800 ring-1 ring-sky-200">
                  {uiLang === "en" ? "Waiting for car record" : "รถยังไม่มีข้อมูล"}
                </span>
              ) : null}
              {row.isAmbiguousVehicle ? (
                <span className="rounded-full bg-orange-50 px-1.5 py-0.5 text-orange-800 ring-1 ring-orange-200">
                  {uiLang === "en" ? "Multiple car candidates" : "พบรถหลายคัน"}
                </span>
              ) : null}
              {row.isUnresolved ? (
                <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-rose-800 ring-1 ring-rose-200">
                  {uiLang === "en" ? "Needs car match - manual review" : "ยังจับรถไม่ได้ — รอตรวจด้วยมือ"}
                </span>
              ) : null}
            </div>
            {row.sourceLabel || row.groupIdDisplay ? (
              <p className="mt-1 text-[10px] font-semibold text-slate-500">
                {[row.sourceLabel, row.groupIdDisplay ? `group: ${row.groupIdDisplay}` : ""].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            {row.fallbackSubtitle ? (
              <p className="mt-1 line-clamp-2 text-[10px] font-medium text-slate-500">{row.fallbackSubtitle}</p>
            ) : null}
            {row.contextSource === "reply_context" || row.contextSource === "fallback_previous_message" ? (
              <p className="mt-1 rounded-lg bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-800 ring-1 ring-sky-100">
                {row.contextSource === "fallback_previous_message"
                  ? uiLang === "en"
                    ? "Possible reference to a previous LINE message - please review before saving"
                    : "ระบบเดาว่าอาจอ้างอิงจากข้อความก่อนหน้า · กรุณาตรวจสอบก่อนบันทึก"
                  : uiLang === "en"
                    ? "Referenced from previous LINE message"
                    : "อ้างอิงจากข้อความก่อนหน้า"}
                {row.replyContextPreview ? ` · ${row.replyContextPreview}` : ""}
              </p>
            ) : null}
            {row.isWaitingForCarRecord ? (
              <div
                className="mt-2 rounded-xl bg-sky-50 px-2 py-2 text-[11px] font-medium leading-relaxed text-sky-950 ring-1 ring-sky-100"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800 ring-1 ring-sky-200">
                  {uiLang === "en" ? "Not in records yet" : "รถยังไม่มีข้อมูล"}
                </span>
                <p className="mt-1.5 text-sm font-bold leading-snug">
                  {uiLang === "en" ? "Waiting for car record" : "รอรถเข้าระบบ 🚧"}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[11px]">
                  {uiLang === "en"
                    ? "This vehicle is not in the current records yet. It may not be in Record / not synced / ref mismatch."
                    : "ระบบยังไม่พบรถคันนี้ในข้อมูลปัจจุบัน\nอาจเป็นรถที่ยังไม่เข้า Record / ยังไม่ sync / เลขอ้างอิงยังไม่ตรง"}
                </p>
                {row.spec ? (
                  <p className="mt-1.5 line-clamp-3 text-sm font-semibold text-slate-800">{row.spec}</p>
                ) : null}
                {row.manualReviewPreview ? (
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[10px] text-slate-500">{row.manualReviewPreview}</p>
                ) : null}
              </div>
            ) : row.manualReviewCount > 0 ? (
              <div
                className={cn(
                  "mt-2 rounded-xl px-2 py-2 text-[11px] font-medium leading-relaxed ring-1",
                  row.isUnresolved ? "bg-rose-50 text-rose-950 ring-rose-100" : "bg-emerald-50 text-emerald-950 ring-emerald-100"
                )}
                onClick={(event) => event.stopPropagation()}
              >
                <p className="font-bold">
                  {row.isUnresolved
                    ? uiLang === "en"
                      ? "Car not identified yet"
                      : "ยังไม่รู้ว่ารถคันไหน"
                    : uiLang === "en"
                      ? "Car matched"
                      : "จับรถได้แล้ว ✅"}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[11px]">
                  {row.isUnresolved
                    ? uiLang === "en"
                      ? "This message has no clear plate, stock/ref, or vehicle context. Search/select a car, or skip it."
                      : "ข้อความนี้ยังไม่มีทะเบียน เลขรถ หรือข้อมูลรถที่ชัดเจน กรุณาค้นหา/เลือกคันรถเอง หรือข้าม"
                    : uiLang === "en"
                      ? "No work items found yet."
                      : "ยังไม่พบรายการงาน"}
                </p>
                {row.detectedCarLabel && !row.isUnresolved ? (
                  <p className="mt-1 line-clamp-2 text-sm font-bold text-slate-800">{row.detectedCarLabel}</p>
                ) : null}
                {row.manualReviewPreview ? (
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[10px] text-slate-500">{row.manualReviewPreview}</p>
                ) : null}
              </div>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );

  const floatingNavigator = (
    <>
      <button
        type="button"
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={uiLang === "en" ? "LINE cars with pending work" : "รถที่มีงาน LINE รอดำเนินการ"}
        className={cn(
          "fixed z-[65] flex h-14 min-w-[3.5rem] items-center justify-center gap-1 rounded-full px-4 text-xs font-bold text-white shadow-lg ring-2 touch-manipulation",
          "bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(0.75rem,env(safe-area-inset-right))]",
          open ? "bg-violet-800 ring-violet-500" : "bg-violet-600 ring-violet-400/80 active:bg-violet-700"
        )}
      >
        <span className="leading-tight">AI · LINE</span>
        {lineInboxCarCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-bold tabular-nums ring-2 ring-white">
            {lineInboxCarCount > 99 ? "99+" : lineInboxCarCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label={uiLang === "en" ? "Close" : "ปิด"}
            className="fixed inset-0 z-[70] bg-black/45 touch-manipulation"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="line-inbox-car-drawer-title"
            className="fixed inset-x-0 bottom-0 z-[71] flex max-h-[min(85dvh,640px)] flex-col rounded-t-2xl bg-white shadow-2xl ring-1 ring-slate-200/80"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0px)", overscrollBehavior: "contain" }}
          >
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-300" />
            <div className="shrink-0 border-b border-slate-100 px-4 pb-3 pt-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="line-inbox-car-drawer-title" className="text-base font-bold text-violet-950">
                    {uiLang === "en" ? "Pending LINE work" : "งาน LINE รอดำเนินการ"}
                  </h2>
                  <p className="mt-1 text-[11px] font-medium text-slate-500">
                    {uiLang === "en"
                      ? `${carPickerRows.length} shown · ${lineInboxCarCount} ready group(s)`
                      : `แสดง ${carPickerRows.length} รายการ · พร้อมตรวจงาน ${lineInboxCarCount} กลุ่ม`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void fetchQueue()}
                  className="min-h-8 shrink-0 rounded-full bg-slate-100 px-3 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200 touch-manipulation active:bg-slate-200"
                >
                  {uiLang === "en" ? "Refresh" : "รีเฟรช"}
                </button>
              </div>
              <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
                {queueDateFilterOptions.map((option) => {
                  const active = queueDateFilter === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setQueueDateFilter(option.value)}
                      className={cn(
                        "min-h-8 shrink-0 rounded-full px-3 text-[11px] font-bold ring-1 touch-manipulation",
                        active
                          ? "bg-violet-700 text-white ring-violet-700"
                          : "bg-slate-50 text-slate-700 ring-slate-200 active:bg-violet-50"
                      )}
                    >
                      {option.label} {option.count > 0 ? `(${option.count})` : ""}
                    </button>
                  );
                })}
              </div>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-2 [-webkit-overflow-scrolling:touch]"
              style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
            >
              {queueError ? (
                <div className="my-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-900">
                  <p>{queueError}</p>
                  <button
                    type="button"
                    onClick={() => void fetchQueue()}
                    className="mt-2 min-h-8 rounded-full bg-white px-3 text-[11px] font-bold text-amber-900 ring-1 ring-amber-200 touch-manipulation"
                  >
                    {uiLang === "en" ? "Try again" : "ลองใหม่"}
                  </button>
                </div>
              ) : queueLoading && carPickerRows.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">{uiLang === "en" ? "Loading…" : "กำลังโหลด…"}</p>
              ) : carPickerRows.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  {uiLang === "en" ? "No pending LINE work for this filter." : "ไม่มีงาน LINE รอดำเนินการในตัวกรองนี้"}
                </p>
              ) : (
                <>
                  {queueLoading ? (
                    <p className="pb-2 text-center text-[11px] font-semibold text-slate-500">
                      {uiLang === "en" ? "Refreshing..." : "กำลังรีเฟรช..."}
                    </p>
                  ) : null}
                  {carDrawerList}
                </>
              )}
            </div>
            <div className="shrink-0 px-4 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-11 w-full rounded-2xl bg-slate-100 text-sm font-semibold text-slate-800 touch-manipulation"
              >
                {uiLang === "en" ? "Close" : "ปิด"}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );

  const renderQueueGroupContent = (group: PendingQueueGroup) => {
    const acceptedReplyText = buildQueueAcceptedReplyText(group, uiLang);
    const acceptedReplyCopied = copiedQueueReplyKey === group.group_key;
    return (
    <div className="space-y-3">
      <div className="rounded-xl border border-sky-200 bg-sky-50 px-2.5 py-2 text-[11px] text-sky-950">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <p className="font-bold">
            {uiLang === "en" ? "Copy-ready LINE acknowledgement" : "ข้อความรับงาน LINE พร้อมคัดลอก"}
          </p>
          <button
            type="button"
            onClick={() => void copyQueueReply(group)}
            className="inline-flex min-h-8 items-center gap-1 rounded-full bg-slate-950 px-3 py-1 text-[11px] font-bold text-white touch-manipulation"
          >
            {acceptedReplyCopied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {acceptedReplyCopied
              ? uiLang === "en"
                ? "Copied"
                : "คัดลอกแล้ว"
              : uiLang === "en"
                ? "Copy"
                : "คัดลอก"}
          </button>
        </div>
        <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-white/85 p-2 text-[11px] leading-relaxed text-slate-800 ring-1 ring-sky-100">
          {acceptedReplyText}
        </pre>
      </div>
      {group.attachments.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {uiLang === "en" ? "LINE photos" : "รูปจาก LINE"} ({queueGroupPhotoCount(group)})
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {group.attachments.slice(0, 8).map((attachment) => (
              <a
                key={`${attachment.line_message_id}-${attachment.url}`}
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                className="block shrink-0 overflow-hidden rounded-xl ring-1 ring-slate-200"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={attachment.url} alt="" className="h-16 w-16 object-cover" loading="lazy" />
              </a>
            ))}
          </div>
        </div>
      ) : null}
      {group.messages.map((m) => {
        const displayLines = queueMessageDisplayActionLines(m);
        const showManual = queueMessageNeedsManualReview(m);
        const messageCarRowId = String(m.car_row_id ?? group.car_row_id ?? "").trim();
        const selectedQueueCar = queueSelectedCars[m.inbox_id] ?? null;
        const effectiveMessageCarRowId = selectedQueueCar?.carRowId || messageCarRowId;
        const candidateSearchQuery =
          String(m.aiTargetCarReference ?? "").trim() ||
          deriveLineInboxCarSearchQuery(queueMessageRawText(m)) ||
          deriveLineInboxCarSearchQuery(m.rawTextPreview ?? m.raw_text_preview ?? "");
        const backendCandidateOptions = uniqueQueueMatchedCarOptions(
          (m.matchedCarCandidates ?? group.matchedCarCandidates ?? []).map(optionFromMatchedCandidate)
        );
        const localCandidateOptions =
          candidateSearchQuery && !messageCarRowId
            ? uniqueQueueMatchedCarOptions(
                orders
                  .filter((order) =>
                    matchesVehicleSearch(
                      {
                        plate: String(order.fullPlate ?? "").replace(/\D/g, ""),
                        fullPlate: order.fullPlate,
                        chassis: order.chassis,
                        car: order.car,
                      },
                      candidateSearchQuery
                    )
                  )
                  .map(optionFromOrderPick)
              )
            : [];
        const carCandidateOptions = uniqueQueueMatchedCarOptions([
          ...backendCandidateOptions,
          ...localCandidateOptions,
        ]).slice(0, 8);
        const lineAttachments = (() => {
          const direct = queueMessageLineAttachments(m, group);
          if (direct.length > 0) return direct;
          if (!showManual) return direct;
          const seen = new Set<string>();
          return (group.attachments ?? []).filter((attachment) => {
            const url = String(attachment.url ?? "").trim();
            if (!url || seen.has(url)) return false;
            seen.add(url);
            return true;
          });
        })();
        const fallbackAssignee = resolveSaleStaffForOrder(group.sale, saleAssigneesBySale);
        const selectedActions = selectedQueueActionsForInbox(m, fallbackAssignee);
        const cardKind = queueMessageCardKind(m);
        const primaryCarLabel = queueMessagePrimaryCarLabel(m, uiLang);
        const newWorkCount = displayLines.filter((line) => line.duplicate_status === "new").length;
        const manualCardTone =
          cardKind === "matched_no_work"
            ? "border-emerald-200 bg-emerald-50 text-emerald-950"
            : cardKind === "waiting_for_car_record"
              ? "border-sky-200 bg-sky-50 text-sky-950"
              : "border-rose-200 bg-rose-50 text-rose-950";
        return (
          <div key={m.inbox_id} className="rounded-xl bg-white px-2.5 py-2.5 ring-1 ring-slate-200/80">
            {showManual ? (
              <div
                className={cn(
                  "mb-2.5 rounded-xl border px-3 py-2.5 text-[12px] leading-relaxed",
                  manualCardTone
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {cardKind === "waiting_for_car_record" ? (
                      <span className="inline-flex rounded-full bg-sky-100 px-2.5 py-0.5 text-[10px] font-bold text-sky-800 ring-1 ring-sky-200">
                        {uiLang === "en" ? "Not in records yet" : "รถยังไม่มีข้อมูล"}
                      </span>
                    ) : null}
                    <p className={cn("text-sm font-bold leading-snug", cardKind === "waiting_for_car_record" && "mt-1.5")}>
                      {queueMessageManualReviewTitle(m, uiLang)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-[12px] font-medium leading-relaxed opacity-95">
                      {queueMessageStatusSubline(m, uiLang)}
                    </p>
                  </div>
                  {m.received_at ? (
                    <span className="shrink-0 rounded-full bg-white/80 px-2 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-white/60">
                      {formatQueueMessageReceivedAt(m.received_at, uiLang)}
                    </span>
                  ) : null}
                </div>
                {cardKind === "waiting_for_car_record" && queueMessageWaitingVehiclePreview(m) ? (
                  <p className="mt-2 text-sm font-semibold text-slate-800">{queueMessageWaitingVehiclePreview(m)}</p>
                ) : primaryCarLabel ? (
                  <p className="mt-2 text-sm font-bold text-slate-900">{primaryCarLabel}</p>
                ) : null}
                {m.source_label || m.group_id_display ? (
                  <p className="mt-2 text-[10px] font-semibold text-slate-500">
                    {[m.source_label, m.group_id_display ? `group: ${m.group_id_display}` : ""].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {String(m.contextSource ?? m.context_source ?? "").trim() === "reply_context" ||
                String(m.contextSource ?? m.context_source ?? "").trim() === "fallback_previous_message" ? (
                  <p className="mt-2 rounded-lg bg-white/70 px-2 py-1 text-[10px] font-semibold text-sky-800 ring-1 ring-white/80">
                    {String(m.contextSource ?? m.context_source ?? "").trim() === "fallback_previous_message"
                      ? uiLang === "en"
                        ? "Possible reference to a previous LINE message - please review before saving"
                        : "ระบบเดาว่าอาจอ้างอิงจากข้อความก่อนหน้า · กรุณาตรวจสอบก่อนบันทึก"
                      : uiLang === "en"
                        ? "Referenced from previous LINE message"
                        : "อ้างอิงจากข้อความก่อนหน้า"}
                    {String(m.replyContext?.source_raw_text_preview ?? m.reply_context?.source_raw_text_preview ?? "").trim()
                      ? ` · ${String(m.replyContext?.source_raw_text_preview ?? m.reply_context?.source_raw_text_preview ?? "").trim()}`
                      : ""}
                  </p>
                ) : null}
                {m.car_row_id ? (
                  <p className="mt-1 break-all text-[10px] font-medium text-slate-500">car_row_id: {m.car_row_id}</p>
                ) : null}
                {m.aiTargetCarReference && !primaryCarLabel ? (
                  <p className="mt-1 text-[11px] font-semibold text-slate-700">
                    {uiLang === "en" ? "AI target: " : "AI ชี้รถ: "}
                    {m.aiTargetCarReference}
                    {m.aiTargetCarConfidence ? ` · ${m.aiTargetCarConfidence}` : ""}
                  </p>
                ) : null}
                {queueCandidateLabels(m.extractedCarCandidates).length > 0 ? (
                  <p className="mt-1 line-clamp-3 text-[10px] text-slate-600">
                    {uiLang === "en" ? "Candidates: " : "ตัวเลือกที่พบ: "}
                    {queueCandidateLabels(m.extractedCarCandidates).join(" · ")}
                  </p>
                ) : null}
                {carCandidateOptions.length > 0 && !messageCarRowId ? (
                  <div className="mt-2 rounded-lg bg-white/80 p-2 ring-1 ring-white/80">
                    <p className="text-[12px] font-bold text-slate-900">
                      {uiLang === "en"
                        ? `Found cars related to "${candidateSearchQuery}", please select one`
                        : `พบรถที่เกี่ยวข้องกับ "${candidateSearchQuery}" กรุณาเลือกคันรถ`}
                    </p>
                    {displayLines.length > 0 ? (
                      <div className="mt-2">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          {uiLang === "en" ? "Work found" : "งานที่เจอ"}
                        </p>
                        <ul className="mt-1 space-y-1">
                          {displayLines.slice(0, 4).map((line) => (
                            <li key={`candidate-work-${line.item_index}`} className="text-[12px] font-semibold text-slate-800">
                              {line.suggested_item_name || line.raw_text}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <div className="mt-2 space-y-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        {uiLang === "en" ? "Cars found" : "รถที่พบ"}
                      </p>
                      {carCandidateOptions.map((option) => {
                        const selectedOption = selectedQueueCar?.carRowId === option.carRowId;
                        return (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => {
                              setQueueSelectedCars((prev) => ({ ...prev, [m.inbox_id]: option }));
                              if (option.order?.id) setSelectedOrderId(option.order.id);
                              setError(null);
                            }}
                            className={cn(
                              "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-semibold ring-1 touch-manipulation",
                              selectedOption
                                ? "bg-emerald-700 text-white ring-emerald-700"
                                : "bg-white text-slate-800 ring-slate-200 active:bg-slate-100"
                            )}
                          >
                            <span className="min-w-0 flex-1 break-words">
                              {uiLang === "en" ? "Select this car" : "เลือกคันนี้"} {option.label}
                            </span>
                            {selectedOption ? <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
                          </button>
                        );
                      })}
                    </div>
                    {selectedQueueCar ? (
                      <p className="mt-2 text-[12px] font-bold text-emerald-800">
                        {uiLang === "en" ? "Selected: " : "เลือกแล้ว: "}
                        {selectedQueueCar.label} ✓
                      </p>
                    ) : null}
                  </div>
                ) : selectedQueueCar ? (
                  <p className="mt-2 rounded-lg bg-emerald-50 px-2 py-1.5 text-[12px] font-bold text-emerald-800 ring-1 ring-emerald-200">
                    {uiLang === "en" ? "Selected: " : "เลือกแล้ว: "}
                    {selectedQueueCar.label} ✓
                  </p>
                ) : null}
                {m.matchReason ? (
                  <p className="mt-1 line-clamp-2 text-[10px] text-slate-500">
                    {uiLang === "en" ? "Match: " : "เหตุผล match: "}
                    {m.matchReason}
                  </p>
                ) : null}
                {lineAttachments.length > 0 ? (
                  <div className="mt-2">
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-violet-800">
                      {uiLang === "en" ? "LINE photos" : "รูปจาก LINE"} ({lineAttachments.length})
                    </p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {lineAttachments.slice(0, 8).map((attachment) => (
                        <a
                          key={`${attachment.line_message_id}-${attachment.url}`}
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block shrink-0 overflow-hidden rounded-xl ring-1 ring-violet-200"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={attachment.url} alt="" className="h-16 w-16 object-cover" loading="lazy" />
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
                {queueMessageRawText(m) ? (
                  <div className="mt-2">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      {uiLang === "en" ? "Original LINE text" : "ข้อความ LINE ต้นฉบับ"}
                    </p>
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-white/70 p-2 text-[11px] leading-relaxed text-slate-600 ring-1 ring-white/80">
                      {queueMessageRawText(m)}
                    </pre>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-col gap-2">
                  {cardKind === "matched_no_work" ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={!messageCarRowId}
                        onClick={() => openCarFromQueue(m, group)}
                        className="min-h-11 touch-manipulation bg-emerald-700 hover:bg-emerald-800"
                      >
                        {uiLang === "en" ? "Open this car" : "เปิดรถคันนี้"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={savingInboxId === m.inbox_id}
                        onClick={() => void skipQueueCard(m)}
                        className="min-h-11 touch-manipulation"
                      >
                        {savingInboxId === m.inbox_id
                          ? uiLang === "en"
                            ? "Saving…"
                            : "กำลังบันทึก…"
                          : uiLang === "en"
                            ? "Skip"
                            : "ข้าม"}
                      </Button>
                    </div>
                  ) : cardKind === "waiting_for_car_record" ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={queueLoading}
                        onClick={() => void fetchQueue()}
                        className="min-h-11 touch-manipulation"
                      >
                        {uiLang === "en" ? "Check again" : "ตรวจอีกครั้ง"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => searchCarFromQueue(m)}
                        className="min-h-11 touch-manipulation bg-sky-700 hover:bg-sky-800"
                      >
                        {uiLang === "en" ? "Search car" : "ค้นหารถเอง"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={savingInboxId === m.inbox_id}
                        onClick={() => void skipQueueCard(m)}
                        className="min-h-11 touch-manipulation"
                      >
                        {savingInboxId === m.inbox_id
                          ? uiLang === "en"
                            ? "Saving…"
                            : "กำลังบันทึก…"
                          : uiLang === "en"
                            ? "Skip"
                            : "ข้าม"}
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => searchCarFromQueue(m)}
                        className="min-h-11 touch-manipulation bg-violet-700 hover:bg-violet-800"
                      >
                        {uiLang === "en" ? "Search car" : "ค้นหารถ"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={savingInboxId === m.inbox_id}
                        onClick={() => void skipQueueCard(m)}
                        className="min-h-11 touch-manipulation"
                      >
                        {savingInboxId === m.inbox_id
                          ? uiLang === "en"
                            ? "Saving…"
                            : "กำลังบันทึก…"
                          : uiLang === "en"
                            ? "Skip"
                            : "ข้าม"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
            {displayLines.length > 0 ? (
            <>
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex min-h-8 items-center rounded-full bg-emerald-100 px-3 text-xs font-bold text-emerald-900 ring-1 ring-emerald-200">
                  {uiLang === "en"
                    ? `${newWorkCount || displayLines.length} new job(s)`
                    : `งานใหม่ ${newWorkCount || displayLines.length}`}
                </span>
                {selectedActions.length > 0 ? (
                  <span className="text-[11px] font-semibold text-slate-600">
                    {uiLang === "en"
                      ? `${selectedActions.length} selected to save`
                      : `เลือกบันทึก ${selectedActions.length} รายการ`}
                  </span>
                ) : null}
              </div>
              {effectiveMessageCarRowId ? (
                <button
                  type="button"
                  onClick={() => {
                    if (selectedQueueCar) {
                      setOpen(false);
                      onPickCar?.({
                        orderId: selectedQueueCar.order?.id ?? null,
                        carRowId: selectedQueueCar.carRowId,
                        plate: selectedQueueCar.label,
                      });
                      return;
                    }
                    openCarFromQueue(m, group);
                  }}
                  className="min-h-9 shrink-0 rounded-full bg-violet-100 px-3 text-[11px] font-bold text-violet-900 ring-1 ring-violet-200 touch-manipulation active:bg-violet-200"
                >
                  {uiLang === "en" ? "Open car" : "เปิดรถ"}
                </button>
              ) : null}
            </div>
            <ul className="space-y-2.5">
              {displayLines.map((line) => {
                const rowKey = queueSuggestionRowKey(m.inbox_id, line.item_index);
                const draft = queueDrafts[rowKey] ?? queueActionDraftForLine(line, fallbackAssignee);
                const lineName = draft.itemName || line.suggested_item_name || line.raw_text;
                const hasPhotoRef = hasLineInboxPhotoReference(lineName);
                const stagedPhotoCount =
                  (stagedSuggestionPhotos[rowKey]?.length ?? 0) + (stagedLineAttachments[rowKey]?.length ?? 0);
                const canMerge = Boolean(line.matched_order_item_id || draft.orderItemId);
                return (
                  <li
                    key={line.item_index}
                    className={cn(
                      "space-y-2.5 rounded-xl border p-2.5",
                      draft.included ? "border-slate-200 bg-slate-100" : "border-slate-200 bg-slate-50 opacity-80",
                      line.duplicate_status === "new" ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-slate-300"
                    )}
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <input
                        type="checkbox"
                        checked={draft.included}
                        onChange={(event) =>
                          updateQueueDraft(rowKey, {
                            included: event.target.checked,
                            action: event.target.checked && draft.action === "skip" ? "create" : draft.action,
                          })
                        }
                        className="mt-0.5 h-6 w-6 shrink-0 rounded border-slate-400 touch-manipulation"
                      />
                      <LineInboxSuggestedItemNameField
                        value={lineName}
                        uiLang={uiLang}
                        onChange={(value) => updateQueueDraft(rowKey, { itemName: value })}
                        onPhotoReference={() => openSuggestionPhotoSheet(rowKey, -1, lineName)}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <LineInboxInlineSelectLink
                        value={draft.assignee}
                        options={staffChoices}
                        onChange={(value) => updateQueueDraft(rowKey, { assignee: value })}
                        title={uiLang === "en" ? "Owner" : "พนักงาน"}
                        emptyLabel="-"
                        className={lineInboxAssigneePillClasses(draft.assignee)}
                      />
                      <LineInboxInlineSelectLink
                        value={draft.status}
                        options={statusChoices}
                        onChange={(value) => updateQueueDraft(rowKey, { status: value })}
                        title={uiLang === "en" ? "Status" : "สถานะ"}
                        emptyLabel="-"
                        className={cn("w-[5.5rem] min-w-[5.5rem]", lineInboxStatusPillClasses(draft.status))}
                      />
                      <select
                        value={draft.action}
                        onChange={(event) => {
                          const action = safeQueueAction(event.target.value);
                          updateQueueDraft(rowKey, {
                            action,
                            included: action === "skip" ? false : true,
                            orderItemId:
                              action === "merge" ? draft.orderItemId || line.matched_order_item_id : draft.orderItemId,
                          });
                        }}
                        className="h-11 min-h-[44px] rounded-full bg-white px-2.5 text-[11px] font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 touch-manipulation"
                      >
                        <option value="create">{uiLang === "en" ? "Add new" : "เพิ่มงานใหม่"}</option>
                        <option value="merge" disabled={!canMerge}>
                          {uiLang === "en" ? "Merge" : "อัปเดตงานเดิม"}
                        </option>
                        <option value="skip">{uiLang === "en" ? "Skip" : "ข้าม"}</option>
                      </select>
                      {hasPhotoRef ? (
                        <button
                          type="button"
                          onClick={() => openSuggestionPhotoSheet(rowKey, -1, lineName)}
                          className={cn(
                            "h-11 min-h-[44px] rounded-full px-3 text-[11px] font-bold ring-1 touch-manipulation",
                            stagedPhotoCount > 0
                              ? "bg-violet-700 text-white ring-violet-700"
                              : "bg-sky-50 text-sky-700 ring-sky-200"
                          )}
                        >
                          {uiLang === "en" ? "Photo" : "รูป"}
                          {stagedPhotoCount > 0 ? ` ${stagedPhotoCount}` : ""}
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                type="button"
                size="sm"
                disabled={savingInboxId === m.inbox_id || selectedActions.length === 0}
                onClick={() => void saveQueueCard(m, fallbackAssignee)}
                className="min-h-11 touch-manipulation bg-slate-950 hover:bg-slate-900"
              >
                {savingInboxId === m.inbox_id
                  ? uiLang === "en"
                    ? "Saving…"
                    : "กำลังบันทึก…"
                  : uiLang === "en"
                    ? `Approve (${selectedActions.length})`
                    : `อนุมัติ (${selectedActions.length})`}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={savingInboxId === m.inbox_id}
                onClick={() => void skipQueueCard(m)}
                className="min-h-11 touch-manipulation"
              >
                {uiLang === "en" ? "Skip all" : "ข้ามทั้งหมด"}
              </Button>
            </div>
            </>
            ) : null}
          </div>
        );
      })}
    </div>
    );
  };

  const renderCarAiSection = (orderId: string, carRowId: string | null, active: boolean) => {
    if (!active || String(focusedOrderId ?? "").trim() !== orderId) return null;
    const rowId = String(carRowId ?? "").trim();
    const group = rowId ? queueGroups.find((g) => String(g.car_row_id ?? "").trim() === rowId) : null;
    if (!group) return null;
    return (
      <section
        id="line-inbox-car-ai-section"
        className="mb-3 scroll-mt-24 rounded-2xl border-2 border-violet-400 bg-violet-50/90 p-3 shadow-sm ring-2 ring-violet-300/60"
      >
        <h3 className="mb-2 text-sm font-bold text-violet-950">
          {uiLang === "en" ? "New from LINE (AI)" : "AI เพิ่มมาใหม่จาก LINE"}
        </h3>
        {renderQueueGroupContent(group)}
        {replyText ? (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] text-emerald-950">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold">
                {uiLang === "en" ? "Copy-ready LINE reply" : "ข้อความตอบ LINE หลังบันทึก พร้อมคัดลอก"}
              </p>
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => void copyReply()}
                className="inline-flex min-h-8 items-center gap-1 rounded-full bg-slate-950 px-3 py-1 text-[11px] font-bold text-white touch-manipulation"
              >
                {replyCopied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                {replyCopied
                  ? uiLang === "en"
                    ? "Copied"
                    : "คัดลอกแล้ว"
                  : uiLang === "en"
                    ? "Copy"
                    : "คัดลอก"}
              </button>
            </div>
            {saveHint ? <p className="mb-1.5 text-[11px] font-semibold text-emerald-900">{saveHint}</p> : null}
            <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-white/85 p-2 text-[11px] leading-relaxed text-slate-800 ring-1 ring-emerald-100">
              {replyText}
            </pre>
          </div>
        ) : null}
      </section>
    );
  };

  const overlays = (
    <>
      {suggestionPhotoSheet ? (
        <div
          role="presentation"
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-2 outline-none sm:p-3"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeSuggestionPhotoSheet();
          }}
        >
          <div className="mb-[max(env(safe-area-inset-bottom),0px)] w-full max-w-md rounded-2xl bg-white p-4 shadow-xl ring-1 ring-slate-200/80">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <b className="text-sm font-semibold text-slate-950">
                  {uiLang === "en" ? "Item Photos" : "รูปตามรายการ"}
                </b>
                <p className="mt-1 line-clamp-2 text-xs font-medium text-slate-600">
                  {String(
                    suggestionPhotoSheetRow?.itemName ||
                      suggestionPhotoSheetRow?.suggested_item_name ||
                      suggestionPhotoSheet.itemName ||
                      ""
                  ).trim() ||
                    (uiLang === "en" ? "Suggested item" : "งานที่ AI เสนอ")}
                </p>
              </div>
              <button
                type="button"
                onClick={closeSuggestionPhotoSheet}
                className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-800 touch-manipulation"
              >
                {uiLang === "en" ? "Close" : "ปิด"}
              </button>
            </div>

            <div className="mb-3">
              <label
                className={cn(
                  "inline-flex min-h-10 w-full cursor-pointer items-center justify-center rounded-xl px-3 text-xs font-semibold touch-manipulation",
                  photoBusyRowKey === suggestionPhotoSheet.rowKey
                    ? "cursor-not-allowed bg-slate-200 text-slate-500"
                    : "bg-sky-600 text-white"
                )}
              >
                {photoBusyRowKey === suggestionPhotoSheet.rowKey
                  ? uiLang === "en"
                    ? "Uploading..."
                    : "กำลังแนบรูป..."
                  : uiLang === "en"
                    ? "Add photo"
                    : "เพิ่มรูป"}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={photoBusyRowKey === suggestionPhotoSheet.rowKey}
                  className="hidden"
                  onChange={(event) => {
                    const files = event.currentTarget.files;
                    if (canUseSuggestionPhotoSheet) {
                      void uploadSuggestionPhotos(
                        suggestionPhotoSheet.rowKey,
                        suggestionPhotoSheetItemId,
                        files
                      );
                    } else {
                      stageSuggestionPhotos(suggestionPhotoSheet.rowKey, files);
                    }
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>

            {queueAttachments.length > 0 ? (
              <div className="mb-3">
                <p className="mb-2 text-[11px] font-semibold text-slate-600">
                  {uiLang === "en" ? "Recent LINE photos" : "รูปจาก LINE ล่าสุด"}
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {queueAttachments.slice(0, 20).map((attachment) => {
                    const selected = stagedLineAttachmentsForOpenSheet.some(
                      (item) => item.line_message_id === attachment.line_message_id
                    );
                    return (
                      <button
                        type="button"
                        key={`${attachment.inbox_id}-${attachment.line_message_id}`}
                        onClick={() => toggleStagedLineAttachment(suggestionPhotoSheet.rowKey, attachment)}
                        className={cn(
                          "relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-100 ring-2",
                          selected ? "ring-violet-500" : "ring-slate-200"
                        )}
                        title={uiLang === "en" ? "Use this LINE photo" : "เลือกรูปจาก LINE นี้"}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={attachment.url}
                          alt={uiLang === "en" ? "LINE photo" : "รูปจาก LINE"}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                        <span
                          className={cn(
                            "absolute inset-x-1 bottom-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                            selected ? "bg-violet-700 text-white" : "bg-white/90 text-slate-700"
                          )}
                        >
                          {selected ? (uiLang === "en" ? "Selected" : "เลือกแล้ว") : uiLang === "en" ? "Use" : "เลือก"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {stagedPhotosForOpenSheet.length > 0 ? (
              <div className="mb-3">
                <p className="mb-2 text-[11px] font-semibold text-slate-600">
                  {uiLang === "en"
                    ? `Ready to attach after save (${stagedPhotosForOpenSheet.length})`
                    : `พร้อมแนบหลังบันทึก (${stagedPhotosForOpenSheet.length})`}
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {stagedPhotosForOpenSheet.map((photo) => (
                    <div
                      key={photo.id}
                      className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.previewUrl}
                        alt={uiLang === "en" ? "Pending item photo" : "รูปที่รอแนบ"}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeStagedSuggestionPhoto(suggestionPhotoSheet.rowKey, photo.id)}
                        className="absolute right-1 top-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white"
                      >
                        {uiLang === "en" ? "Remove" : "ลบ"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {stagedLineAttachmentsForOpenSheet.length > 0 ? (
              <p className="mb-3 rounded-lg bg-violet-50 px-2 py-1.5 text-[11px] font-semibold text-violet-900 ring-1 ring-violet-100">
                {uiLang === "en"
                  ? `LINE photo(s) selected for this item: ${stagedLineAttachmentsForOpenSheet.length}`
                  : `เลือกรูปจาก LINE สำหรับรายการนี้แล้ว ${stagedLineAttachmentsForOpenSheet.length} รูป`}
              </p>
            ) : null}

            {canUseSuggestionPhotoSheet ? (
              suggestionPhotosLoading ? (
                <p className="mb-2 text-center text-xs font-medium text-slate-500">
                  {uiLang === "en" ? "Loading photos..." : "กำลังโหลดรูป..."}
                </p>
              ) : suggestionItemPhotos.length === 0 ? (
                <p className="text-center text-xs font-medium text-slate-500">
                  {uiLang === "en" ? "No photos yet - use Add photo" : "ยังไม่มีรูป - กดเพิ่มรูปได้"}
                </p>
              ) : (
                <div className="flex max-h-48 gap-2 overflow-x-auto overflow-y-auto pb-1">
                  {suggestionItemPhotos.map((photo) => (
                    <a
                      key={photo.id}
                      href={photo.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group relative h-28 w-28 shrink-0 overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.url}
                        alt={uiLang === "en" ? "Item photo thumbnail" : "รูปรายการ"}
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                        loading="lazy"
                      />
                    </a>
                  ))}
                </div>
              )
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );

  return {
    uiLang,
    open,
    setOpen,
    floatingNavigator,
    overlays,
    renderCarAiSection,
  };
}
/* eslint-enable @typescript-eslint/no-unused-vars */
