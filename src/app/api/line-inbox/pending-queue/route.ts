import { NextResponse } from "next/server";
import { requireMutateRole } from "@/lib/auth/mutation-guard";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { LINE_INBOX_MESSAGES_TABLE } from "@/lib/line-inbox/line-inbox-messages";
import { buildFallbackAnalyzeItemsFromRawText } from "@/lib/line-inbox/fallback-analyze-items";
import { buildFallbackAnalyzePayloadFromRawText } from "@/lib/line-inbox/fallback-analyze-payload";
import { isLineInboxNoiseOrSeparatorOnlyText } from "@/lib/line-inbox/split-line-text";
import { buildLineOrderReviewUrl } from "@/lib/line-inbox/review-link";
import type {
  DuplicateStatus,
  ExistingOrderItemRow,
  LineInboxCarCandidate,
  LineInboxAnalyzeItem,
  LineInboxAnalyzeResponse,
  LineInboxAttachmentMeta,
} from "@/lib/line-inbox/types";

export const dynamic = "force-dynamic";
const LINE_IMAGE_AFTER_TEXT_WINDOW_MS = 5 * 60 * 1000;

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
  related_photo_ids: string[];
  relatedPhotoIds: string[];
  line_photo_count: number;
  linePhotoCount: number;
  has_photo_reference: boolean;
  hasPhotoReference: boolean;
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
  source_type: string;
  group_id_display: string;
  source_label: string;
  raw_text_preview: string;
  car_row_id: string;
  plate_display: string;
  car_title: string;
  fallback_title: string;
  fallback_description: string;
  fallbackTitle: string;
  fallbackDescription: string;
  fallback_subtitle: string;
  fallbackSubtitle: string;
  rawTextPreview: string;
  related_text_message_id: string;
  relatedTextMessageId: string;
  line_photo_count: number;
  linePhotoCount: number;
  extractedCarCandidates: LineInboxCarCandidate[];
  aiTargetCarReference: string;
  aiTargetCarConfidence: string;
  matchReason: string;
  inheritedCarRowId: string;
  sale: string;
  needs_human_review: boolean;
  status: "not_linked";
};

type PendingQueueDetectedCar = {
  plate_text: string;
  spec_text: string;
  chassis: string;
  car_row_id: string;
  sale: string;
  confidence: number;
};

type PendingQueueMsg = {
  inbox_id: string;
  received_at: string;
  source_type: string;
  group_id_display: string;
  source_label: string;
  plate_display: string;
  car_title: string;
  fallback_title: string;
  fallback_description: string;
  fallbackTitle: string;
  fallbackDescription: string;
  fallback_subtitle: string;
  fallbackSubtitle: string;
  rawTextPreview: string;
  related_text_message_id: string;
  relatedTextMessageId: string;
  line_photo_count: number;
  linePhotoCount: number;
  extractedCarCandidates: LineInboxCarCandidate[];
  aiTargetCarReference: string;
  aiTargetCarConfidence: string;
  matchReason: string;
  inheritedCarRowId: string;
  related_photo_ids: string[];
  relatedPhotoIds: string[];
  suggestedItems: string[];
  extractionStatus: "ok" | "no_items" | "needs_manual_review" | "matched_no_work";
  matchStatus: "matched" | "unresolved";
  reviewUrl: string;
  review_url: string;
  car_row_id: string;
  sale: string;
  raw_text: string;
  raw_text_preview: string;
  detected_car: PendingQueueDetectedCar | null;
  manual_review_reason: string;
  new_lines: PendingQueueNewLine[];
  new_line_count: number;
  action_lines: PendingQueueActionLine[];
  action_line_count: number;
  existing_items: ExistingOrderItemRow[];
  attachments: PendingQueueAttachment[];
  needs_human_review: boolean;
  group_anchor_id: string;
};

type PendingQueueGroup = {
  group_key: string;
  car_row_id: string;
  plate_display: string;
  car_title: string;
  fallback_title: string;
  fallback_description: string;
  fallbackTitle: string;
  fallbackDescription: string;
  fallback_subtitle: string;
  fallbackSubtitle: string;
  rawTextPreview: string;
  related_text_message_id: string;
  relatedTextMessageId: string;
  line_photo_count: number;
  linePhotoCount: number;
  extractedCarCandidates: LineInboxCarCandidate[];
  aiTargetCarReference: string;
  aiTargetCarConfidence: string;
  matchReason: string;
  inheritedCarRowId: string;
  related_photo_ids: string[];
  relatedPhotoIds: string[];
  suggestedItems: string[];
  extractionStatus: "ok" | "no_items" | "needs_manual_review" | "matched_no_work";
  matchStatus: "matched" | "unresolved";
  reviewUrl: string;
  review_url: string;
  sale: string;
  source_label: string;
  source_type: string;
  group_id_display: string;
  is_unresolved: boolean;
  total_action_lines: number;
  total_new_lines: number;
  total_manual_reviews: number;
  existing_items: ExistingOrderItemRow[];
  attachments: PendingQueueAttachment[];
  messages: PendingQueueMsg[];
};

type PendingQueueDbRow = {
  id?: unknown;
  line_message_id?: unknown;
  received_at?: unknown;
  raw_text?: unknown;
  source_type?: unknown;
  group_id?: unknown;
  user_id?: unknown;
  workflow_status?: unknown;
  analyze_status?: unknown;
  analyze_payload?: unknown;
  car_row_id?: unknown;
  needs_human_review?: unknown;
};

type RelatedTextContext = {
  row: PendingQueueDbRow;
  payload: LineInboxAnalyzeResponse | null;
};

function isAnalyzePayload(body: unknown): body is LineInboxAnalyzeResponse {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  return Boolean(o.detected_car && typeof o.detected_car === "object" && Array.isArray(o.items));
}

function analyzePayloadOrNull(body: unknown): LineInboxAnalyzeResponse | null {
  return isAnalyzePayload(body) ? body : null;
}

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function lineMessageTimeMs(row: Pick<PendingQueueDbRow, "received_at">): number {
  const t = Date.parse(cleanString(row.received_at));
  return Number.isFinite(t) ? t : 0;
}

function sourceScopeKey(row: Pick<PendingQueueDbRow, "source_type" | "group_id" | "user_id">): string {
  const sourceType = cleanString(row.source_type) || "unknown";
  const id = cleanString(row.group_id) || cleanString(row.user_id);
  return `${sourceType}:${id}`;
}

function imageOnlyFallbackGroupAnchor(row: PendingQueueDbRow): string {
  const sourceKey = sourceScopeKey(row);
  const t = lineMessageTimeMs(row);
  const bucket = t ? Math.floor(t / LINE_IMAGE_AFTER_TEXT_WINDOW_MS) : cleanString(row.id);
  return `image-only:${sourceKey}:${bucket}`;
}

function maskLineSourceId(value: unknown): string {
  const clean = cleanString(value);
  if (!clean) return "";
  if (clean.length <= 8) return clean;
  return `${clean.slice(0, 4)}…${clean.slice(-4)}`;
}

function groupIdDisplay(row: Pick<PendingQueueDbRow, "group_id" | "user_id" | "source_type">): string {
  const sourceType = cleanString(row.source_type);
  if (sourceType === "group") return maskLineSourceId(row.group_id);
  if (sourceType === "user") return maskLineSourceId(row.user_id);
  return maskLineSourceId(row.group_id) || maskLineSourceId(row.user_id);
}

function isLineImageOnlyText(value: unknown): boolean {
  return /^\[LINE\s+(?:image|file)\]$/i.test(cleanString(value));
}

function canBuildFallbackPayloadForRow(row: PendingQueueDbRow): boolean {
  return Boolean(cleanString(row.id)) && !isLineImageOnlyText(row.raw_text) && Boolean(cleanString(row.raw_text));
}

function firstRawTextLine(value: unknown): string {
  return cleanString(value)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find((line) => line && !isLineImageOnlyText(line)) ?? "";
}

function linePreview(value: unknown, max = 160): string {
  const clean = cleanString(value).replace(/\r?\n+/g, " / ").replace(/\s+/g, " ").trim();
  return clean.slice(0, max);
}

function detectedCarTitle(payload: LineInboxAnalyzeResponse | null, storedCarRowId: string): string {
  const plate = cleanString(payload?.detected_car?.plate_text);
  const spec = cleanString(payload?.detected_car?.spec_text);
  const title = [plate && plate !== "-" ? plate : "", spec].filter(Boolean).join(" ").trim();
  if (title) return title;
  return storedCarRowId ? `car_row_id: ${storedCarRowId}` : "";
}

function effectiveCarRowId(
  payload: LineInboxAnalyzeResponse,
  row: PendingQueueDbRow,
  related: RelatedTextContext | null
): string {
  return (
    cleanString(payload.detected_car?.car_row_id) ||
    cleanString(row.car_row_id) ||
    cleanString(related?.payload?.detected_car?.car_row_id) ||
    cleanString(related?.row.car_row_id)
  );
}

function findNearbyTextContext(row: PendingQueueDbRow, rows: PendingQueueDbRow[]): RelatedTextContext | null {
  const raw = cleanString(row.raw_text);
  const isImageRow = isLineImageOnlyText(raw);
  const rowTime = lineMessageTimeMs(row);
  const sourceKey = sourceScopeKey(row);
  if (!isImageRow || !rowTime || sourceKey.endsWith(":")) return null;

  const candidates = rows
    .filter((candidate) => {
      if (candidate.id === row.id) return false;
      if (sourceScopeKey(candidate) !== sourceKey) return false;
      if (isLineImageOnlyText(candidate.raw_text)) return false;
      const t = lineMessageTimeMs(candidate);
      if (!t) return false;
      const delta = rowTime - t;
      return delta >= 0 && delta <= LINE_IMAGE_AFTER_TEXT_WINDOW_MS;
    })
    .map((candidate) => {
      const payload = analyzePayloadOrNull(candidate.analyze_payload);
      const hasCar =
        Boolean(cleanString(candidate.car_row_id)) ||
        Boolean(cleanString(payload?.detected_car?.car_row_id)) ||
        Boolean(cleanString(payload?.detected_car?.plate_text));
      const pendingWeight = cleanString(candidate.workflow_status) === "pending" ? 0 : LINE_IMAGE_AFTER_TEXT_WINDOW_MS;
      const carWeight = hasCar ? -1_000 : 0;
      return {
        row: candidate,
        payload,
        score: rowTime - lineMessageTimeMs(candidate) + pendingWeight + carWeight,
      };
    })
    .sort((a, b) => a.score - b.score);

  const best = candidates[0];
  return best ? { row: best.row, payload: best.payload } : null;
}

function findFollowingImageContexts(row: PendingQueueDbRow, rows: PendingQueueDbRow[]): RelatedTextContext[] {
  const raw = cleanString(row.raw_text);
  const rowTime = lineMessageTimeMs(row);
  const sourceKey = sourceScopeKey(row);
  if (isLineImageOnlyText(raw) || !rowTime || sourceKey.endsWith(":")) return [];

  return rows
    .filter((candidate) => {
      if (candidate.id === row.id) return false;
      if (sourceScopeKey(candidate) !== sourceKey) return false;
      if (!isLineImageOnlyText(candidate.raw_text)) return false;
      const t = lineMessageTimeMs(candidate);
      if (!t) return false;
      const delta = t - rowTime;
      return delta >= 0 && delta <= LINE_IMAGE_AFTER_TEXT_WINDOW_MS;
    })
    .map((candidate) => ({ row: candidate, payload: analyzePayloadOrNull(candidate.analyze_payload) }))
    .filter((context): context is RelatedTextContext => Boolean(context.payload))
    .sort((a, b) => lineMessageTimeMs(a.row) - lineMessageTimeMs(b.row))
    .slice(0, 20);
}

function fallbackTitleForQueue(input: {
  row: PendingQueueDbRow;
  related: RelatedTextContext | null;
  carTitle: string;
  carRowId: string;
}): string {
  const carTitle = cleanString(input.carTitle);
  if (carTitle && carTitle !== "-") return carTitle;

  const relatedTitle = firstRawTextLine(input.related?.row.raw_text);
  if (relatedTitle) return relatedTitle.slice(0, 120);

  const ownTitle = firstRawTextLine(input.row.raw_text);
  if (ownTitle) return ownTitle.slice(0, 120);

  if (isLineImageOnlyText(input.row.raw_text)) return "รูปจาก LINE ยังไม่ผูกกับข้อความ/รถ";
  return input.carRowId ? `car_row_id: ${input.carRowId}` : "ข้อความ LINE รอตรวจด้วยมือ";
}

function fallbackDescriptionForQueue(input: {
  row: PendingQueueDbRow;
  related: RelatedTextContext | null;
  fallbackTitle: string;
}): string {
  const relatedText = linePreview(input.related?.row.raw_text, 220);
  if (relatedText) return relatedText;
  const ownText = linePreview(input.row.raw_text, 220);
  if (ownText && ownText !== input.fallbackTitle) return ownText;
  if (isLineImageOnlyText(input.row.raw_text)) return "มีรูปจาก LINE รอให้พนักงานเลือกข้อความ/รถที่เกี่ยวข้อง";
  return "รอตรวจด้วยมือ";
}

function fallbackSubtitleForQueue(input: {
  row: PendingQueueDbRow;
  related: RelatedTextContext | null;
  carRowId: string;
}): string {
  const source = sourceLabel(input.row.source_type);
  const received = cleanString(input.row.received_at);
  const group = groupIdDisplay(input.row);
  const parts = [
    input.carRowId ? `car_row_id: ${input.carRowId}` : "",
    source,
    group ? `group: ${group}` : "",
    received,
  ].filter(Boolean);
  return parts.join(" · ");
}

function extractStoredAttachments(
  payload: LineInboxAnalyzeResponse,
  row: PendingQueueDbRow,
  overrides: {
    carRowId?: string;
    plateText?: string;
    carTitle?: string;
    sale?: string;
    fallbackTitle?: string;
    fallbackDescription?: string;
    fallbackSubtitle?: string;
    relatedTextMessageId?: string;
    linePhotoCount?: number;
    rawTextPreview?: string;
    extractedCarCandidates?: LineInboxCarCandidate[];
    aiTargetCarReference?: string;
    aiTargetCarConfidence?: string;
    matchReason?: string;
    inheritedCarRowId?: string;
  } = {}
): PendingQueueAttachment[] {
  const inboxId = String(row.id ?? "").trim();
  const receivedAt = String(row.received_at ?? "");
  const crPayload = String(payload.detected_car?.car_row_id ?? "").trim();
  const crStored = String(row.car_row_id ?? "").trim();
  const carRowId = cleanString(overrides.carRowId) || crPayload || crStored;
  const plateText = cleanString(overrides.plateText) || String(payload.detected_car?.plate_text ?? "").trim();
  const specText = String(payload.detected_car?.spec_text ?? "").trim();
  const carTitle = cleanString(overrides.carTitle) || [plateText, specText].filter(Boolean).join(" ").trim();
  const fallbackTitle = cleanString(overrides.fallbackTitle) || carTitle || "รูปจาก LINE ยังไม่ผูกกับข้อความ/รถ";
  const fallbackDescription = cleanString(overrides.fallbackDescription) || linePreview(row.raw_text);
  const fallbackSubtitle = cleanString(overrides.fallbackSubtitle);
  const relatedTextMessageId = cleanString(overrides.relatedTextMessageId);
  const linePhotoCount = Math.max(1, Number(overrides.linePhotoCount ?? 1));
  const extractedCarCandidates = overrides.extractedCarCandidates ?? payload.extractedCarCandidates ?? [];
  const aiTargetCarReference = cleanString(overrides.aiTargetCarReference) || cleanString(payload.aiTargetCarReference);
  const aiTargetCarConfidence = cleanString(overrides.aiTargetCarConfidence) || cleanString(payload.aiTargetCarConfidence);
  const matchReason = cleanString(overrides.matchReason) || cleanString(payload.matchReason);
  const inheritedCarRowId = cleanString(overrides.inheritedCarRowId);
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
      source_type: cleanString(row.source_type),
      group_id_display: groupIdDisplay(row),
      source_label: sourceLabel(row.source_type),
      raw_text_preview: cleanString(overrides.rawTextPreview) || String(row.raw_text ?? "").trim().slice(0, 120),
      car_row_id: carRowId,
      plate_display: plateText || fallbackTitle,
      car_title: carTitle,
      fallback_title: fallbackTitle,
      fallback_description: fallbackDescription,
      fallbackTitle,
      fallbackDescription,
      fallback_subtitle: fallbackSubtitle,
      fallbackSubtitle,
      rawTextPreview: cleanString(overrides.rawTextPreview) || fallbackDescription.slice(0, 120),
      related_text_message_id: relatedTextMessageId,
      relatedTextMessageId,
      line_photo_count: linePhotoCount,
      linePhotoCount,
      extractedCarCandidates,
      aiTargetCarReference,
      aiTargetCarConfidence,
      matchReason,
      inheritedCarRowId,
      sale: cleanString(overrides.sale) || String(payload.detected_car?.sale ?? "").trim(),
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

function hasLinePhotoReference(value: unknown): boolean {
  return /ตาม\s*(?:รูป|ภาพ)|เหมือน\s*รูป|รูปทุกอย่าง|\b(?:photo|image|pic|picture)\b/i.test(
    cleanString(value)
  );
}

function attachmentIds(items: PendingQueueAttachment[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    const id = cleanString(item.line_message_id) || cleanString(item.inbox_id);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
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

function detectedCarForQueue(
  payload: LineInboxAnalyzeResponse,
  storedCarRowId: string,
  related: RelatedTextContext | null = null
): PendingQueueDetectedCar | null {
  const ownDetected = payload.detected_car;
  const relatedDetected = related?.payload?.detected_car;
  const detected =
    cleanString(ownDetected?.car_row_id) ||
    cleanString(ownDetected?.plate_text) ||
    cleanString(ownDetected?.spec_text) ||
    cleanString(ownDetected?.chassis)
      ? ownDetected
      : relatedDetected;
  const plate = String(detected?.plate_text ?? "").trim();
  const spec = String(detected?.spec_text ?? "").trim();
  const chassis = String(detected?.chassis ?? "").trim();
  const carRowId = String(detected?.car_row_id ?? "").trim() || storedCarRowId || cleanString(related?.row.car_row_id);
  const sale = String(detected?.sale ?? "").trim();
  const confidence = Number(detected?.confidence ?? 0);
  if (!plate && !spec && !chassis && !carRowId && !sale) return null;
  return {
    plate_text: plate,
    spec_text: spec,
    chassis,
    car_row_id: carRowId,
    sale,
    confidence: Number.isFinite(confidence) ? confidence : 0,
  };
}

function payloadOrRelatedCandidates(
  payload: LineInboxAnalyzeResponse,
  related: RelatedTextContext | null
): LineInboxCarCandidate[] {
  const own = payload.extractedCarCandidates ?? [];
  if (own.length > 0) return own.slice(0, 8);
  return (related?.payload?.extractedCarCandidates ?? []).slice(0, 8);
}

function inheritedCarRowIdForQueue(
  payload: LineInboxAnalyzeResponse,
  row: PendingQueueDbRow,
  related: RelatedTextContext | null
): string {
  const own =
    cleanString(payload.detected_car?.car_row_id) ||
    cleanString(row.car_row_id);
  if (own) return "";
  return (
    cleanString(related?.payload?.detected_car?.car_row_id) ||
    cleanString(related?.row.car_row_id)
  );
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

function groupMessages(messages: PendingQueueMsg[]): PendingQueueGroup[] {
  const map = new Map<string, PendingQueueGroup>();

  for (const message of messages) {
    const carKey = message.car_row_id
      ? `car:${message.car_row_id}`
      : `unresolved:${message.group_anchor_id || message.inbox_id}`;
    const existing = map.get(carKey);
    if (existing) {
      existing.messages.push(message);
      existing.total_action_lines += message.action_line_count;
      existing.total_new_lines += message.new_line_count;
      existing.total_manual_reviews += message.needs_human_review && message.action_line_count === 0 ? 1 : 0;
      existing.existing_items = uniqueExistingItems([...existing.existing_items, ...message.existing_items]);
      existing.attachments = uniqueAttachments([...existing.attachments, ...message.attachments]);
      existing.line_photo_count = existing.attachments.length;
      existing.linePhotoCount = existing.attachments.length;
      if (!existing.fallback_title || existing.fallback_title === "-") existing.fallback_title = message.fallback_title;
      if (!existing.fallbackTitle || existing.fallbackTitle === "-") existing.fallbackTitle = message.fallbackTitle;
      if (!existing.fallback_description) existing.fallback_description = message.fallback_description;
      if (!existing.fallbackDescription) existing.fallbackDescription = message.fallbackDescription;
      if (!existing.fallback_subtitle) existing.fallback_subtitle = message.fallback_subtitle;
      if (!existing.fallbackSubtitle) existing.fallbackSubtitle = message.fallbackSubtitle;
      if (!existing.related_text_message_id) existing.related_text_message_id = message.related_text_message_id;
      if (!existing.relatedTextMessageId) existing.relatedTextMessageId = message.relatedTextMessageId;
      if (existing.extractedCarCandidates.length === 0) existing.extractedCarCandidates = message.extractedCarCandidates;
      if (!existing.aiTargetCarReference) existing.aiTargetCarReference = message.aiTargetCarReference;
      if (!existing.aiTargetCarConfidence) existing.aiTargetCarConfidence = message.aiTargetCarConfidence;
      if (!existing.matchReason) existing.matchReason = message.matchReason;
      if (!existing.inheritedCarRowId) existing.inheritedCarRowId = message.inheritedCarRowId;
      existing.related_photo_ids = attachmentIds(existing.attachments);
      existing.relatedPhotoIds = existing.related_photo_ids;
      existing.suggestedItems = Array.from(new Set([...existing.suggestedItems, ...message.suggestedItems]));
      existing.extractionStatus =
        existing.extractionStatus === "ok" || message.extractionStatus === "ok"
          ? "ok"
          : existing.extractionStatus === "matched_no_work" || message.extractionStatus === "matched_no_work"
            ? "matched_no_work"
          : existing.extractionStatus === "needs_manual_review" || message.extractionStatus === "needs_manual_review"
            ? "needs_manual_review"
            : "no_items";
      existing.matchStatus = existing.car_row_id ? "matched" : "unresolved";
      if (!existing.reviewUrl) existing.reviewUrl = message.reviewUrl;
      if (!existing.review_url) existing.review_url = message.review_url;
      continue;
    }

    map.set(carKey, {
      group_key: carKey,
      car_row_id: message.car_row_id,
      plate_display: message.plate_display,
      car_title: message.car_title,
      fallback_title: message.fallback_title,
      fallback_description: message.fallback_description,
      fallbackTitle: message.fallbackTitle,
      fallbackDescription: message.fallbackDescription,
      fallback_subtitle: message.fallback_subtitle,
      fallbackSubtitle: message.fallbackSubtitle,
      rawTextPreview: message.rawTextPreview,
      related_text_message_id: message.related_text_message_id,
      relatedTextMessageId: message.relatedTextMessageId,
      line_photo_count: message.attachments.length,
      linePhotoCount: message.attachments.length,
      extractedCarCandidates: message.extractedCarCandidates,
      aiTargetCarReference: message.aiTargetCarReference,
      aiTargetCarConfidence: message.aiTargetCarConfidence,
      matchReason: message.matchReason,
      inheritedCarRowId: message.inheritedCarRowId,
      related_photo_ids: message.related_photo_ids,
      relatedPhotoIds: message.relatedPhotoIds,
      suggestedItems: message.suggestedItems,
      extractionStatus: message.extractionStatus,
      matchStatus: message.matchStatus,
      reviewUrl: message.reviewUrl,
      review_url: message.review_url,
      sale: message.sale,
      source_label: message.source_label,
      source_type: message.source_type,
      group_id_display: message.group_id_display,
      is_unresolved: !message.car_row_id,
      total_action_lines: message.action_line_count,
      total_new_lines: message.new_line_count,
      total_manual_reviews: message.needs_human_review && message.action_line_count === 0 ? 1 : 0,
      existing_items: uniqueExistingItems(message.existing_items),
      attachments: uniqueAttachments(message.attachments),
      messages: [message],
    });
  }

  return Array.from(map.values()).map((group) => {
    const attachments = uniqueAttachments(group.attachments).slice(0, 20);
    const relatedPhotoIds = attachmentIds(attachments);
    return {
      ...group,
      attachments,
      line_photo_count: attachments.length,
      linePhotoCount: attachments.length,
      related_photo_ids: relatedPhotoIds,
      relatedPhotoIds,
    };
  });
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
      .select(
        "id,line_message_id,received_at,raw_text,source_type,group_id,user_id,workflow_status,analyze_status,analyze_payload,car_row_id,needs_human_review"
      )
      .in("workflow_status", ["pending", "confirmed"])
      .order("received_at", { ascending: false })
      .limit(500);

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
          total_manual_reviews: 0,
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
    let totalManualReview = 0;

    const rows = (data ?? []) as PendingQueueDbRow[];

    for (const row of rows) {
      const id = String(row.id ?? "").trim();
      const related = findNearbyTextContext(row, rows);
      if (!id || cleanString(row.workflow_status) !== "pending") continue;
      if (isLineInboxNoiseOrSeparatorOnlyText(String(row.raw_text ?? ""))) continue;

      if (isLineImageOnlyText(row.raw_text) && related) {
        continue;
      }

      const payloadRaw = row.analyze_payload;
      const storedPayload = analyzePayloadOrNull(payloadRaw);
      const payload =
        storedPayload && cleanString(row.analyze_status) === "ok"
          ? storedPayload
          : canBuildFallbackPayloadForRow(row)
            ? await buildFallbackAnalyzePayloadFromRawText(supabase, {
                raw_text: row.raw_text,
                car_row_id: row.car_row_id,
              })
            : storedPayload;
      if (!payload) continue;

      const followingImages = findFollowingImageContexts(row, rows);
      const rowNeedsHumanReview = Boolean(row.needs_human_review);

      const car_row_id = effectiveCarRowId(payload, row, related);
      const relatedCarTitle = detectedCarTitle(related?.payload ?? null, cleanString(related?.row.car_row_id));
      const plateTextRaw = String(payload.detected_car?.plate_text ?? "").trim();
      const specText = String(payload.detected_car?.spec_text ?? "").trim();
      const carTitleRaw = [plateTextRaw, specText].filter(Boolean).join(" ").trim();
      const carTitle = carTitleRaw || relatedCarTitle;
      const fallbackTitle = fallbackTitleForQueue({ row, related, carTitle, carRowId: car_row_id });
      const fallbackDescription = fallbackDescriptionForQueue({ row, related, fallbackTitle });
      const fallbackSubtitle = fallbackSubtitleForQueue({ row, related, carRowId: car_row_id });
      const relatedTextMessageId = cleanString(related?.row.id);
      const plateText = plateTextRaw || fallbackTitle;
      const sale = String(payload.detected_car?.sale ?? related?.payload?.detected_car?.sale ?? "").trim();
      const extractedCarCandidates = payloadOrRelatedCandidates(payload, related);
      const aiTargetCarReference =
        cleanString(payload.aiTargetCarReference) || cleanString(related?.payload?.aiTargetCarReference);
      const aiTargetCarConfidence =
        cleanString(payload.aiTargetCarConfidence) || cleanString(related?.payload?.aiTargetCarConfidence);
      const matchReason = cleanString(payload.matchReason) || cleanString(related?.payload?.matchReason);
      const inheritedCarRowId = inheritedCarRowIdForQueue(payload, row, related);
      const needsHumanReview = Boolean(payload.needs_human_review || rowNeedsHumanReview);
      const queueItems =
        (payload.items ?? []).length > 0
          ? payload.items ?? []
          : buildFallbackAnalyzeItemsFromRawText(row.raw_text, payload.existing_items ?? [], Boolean(car_row_id));
      const newEntries: PendingQueueNewLine[] = [];
      const actionEntries: PendingQueueActionLine[] = [];
      queueItems.forEach((item: LineInboxAnalyzeItem, idx: number) => {
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
        const hasPhotoReference = hasLinePhotoReference(displayName) || hasLinePhotoReference(item.raw_text);
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
          related_photo_ids: [],
          relatedPhotoIds: [],
          line_photo_count: 0,
          linePhotoCount: 0,
          has_photo_reference: hasPhotoReference,
          hasPhotoReference,
          default_action: defaultAction,
          included_by_default: st === "new",
        });
      });
      const manualReviewOnly = needsHumanReview && actionEntries.length === 0;
      const matchedNoWorkOnly = Boolean(car_row_id) && actionEntries.length === 0;

      if (actionEntries.length === 0 && !manualReviewOnly && !matchedNoWorkOnly) continue;

      const attachmentOverrides = {
        carRowId: car_row_id,
        plateText,
        carTitle,
        sale,
        fallbackTitle,
        fallbackDescription,
        fallbackSubtitle,
        relatedTextMessageId,
        linePhotoCount: payload.line_attachments?.length ?? 0,
        rawTextPreview: fallbackDescription.slice(0, 120),
        extractedCarCandidates,
        aiTargetCarReference,
        aiTargetCarConfidence,
        matchReason,
        inheritedCarRowId,
      };
      const messageAttachments = uniqueAttachments([
        ...extractStoredAttachments(payload, row, attachmentOverrides),
        ...followingImages.flatMap((context) =>
          context.payload
            ? extractStoredAttachments(context.payload, context.row, {
            ...attachmentOverrides,
            relatedTextMessageId: id,
            linePhotoCount: context.payload.line_attachments?.length ?? 0,
          })
            : []
        ),
      ]);
      recentAttachments.push(...messageAttachments);
      const relatedPhotoIds = attachmentIds(messageAttachments);
      const actionEntriesForMessage = actionEntries.map((entry) =>
        entry.has_photo_reference
          ? {
              ...entry,
              related_photo_ids: relatedPhotoIds,
              relatedPhotoIds,
              line_photo_count: relatedPhotoIds.length,
              linePhotoCount: relatedPhotoIds.length,
            }
          : entry
      );
      const suggestedItems = actionEntriesForMessage.map((entry) => entry.suggested_item_name).filter(Boolean);
      const extractionStatus =
        actionEntriesForMessage.length > 0
          ? "ok"
          : matchedNoWorkOnly
            ? "matched_no_work"
            : needsHumanReview
              ? "needs_manual_review"
              : "no_items";
      const matchStatus = car_row_id ? "matched" : "unresolved";
      const queueNeedsHumanReview = needsHumanReview || matchedNoWorkOnly;
      const reviewUrl = car_row_id
        ? buildLineOrderReviewUrl({ carRowId: car_row_id, plate: plateText || carTitle || fallbackTitle })
        : "";

      totalNew += newEntries.length;
      totalAction += actionEntriesForMessage.length;
      totalManualReview += manualReviewOnly || matchedNoWorkOnly ? 1 : 0;
      messages.push({
        inbox_id: id,
        received_at: String(row.received_at ?? ""),
        source_type: cleanString(row.source_type),
        group_id_display: groupIdDisplay(row),
        source_label: sourceLabel(row.source_type),
        plate_display: plateText,
        car_title: carTitle,
        fallback_title: fallbackTitle,
        fallback_description: fallbackDescription,
        fallbackTitle,
        fallbackDescription,
        fallback_subtitle: fallbackSubtitle,
        fallbackSubtitle,
        rawTextPreview: fallbackDescription.slice(0, 120),
        related_text_message_id: relatedTextMessageId,
        relatedTextMessageId,
        line_photo_count: messageAttachments.length,
        linePhotoCount: messageAttachments.length,
        extractedCarCandidates,
        aiTargetCarReference,
        aiTargetCarConfidence,
        matchReason,
        inheritedCarRowId,
        related_photo_ids: relatedPhotoIds,
        relatedPhotoIds,
        suggestedItems,
        extractionStatus,
        matchStatus,
        reviewUrl,
        review_url: reviewUrl,
        car_row_id: car_row_id || "",
        sale,
        raw_text: String(row.raw_text ?? "").trim(),
        raw_text_preview: fallbackDescription.slice(0, 120),
        detected_car: detectedCarForQueue(payload, car_row_id || "", related),
        manual_review_reason: matchedNoWorkOnly
          ? "จับรถได้แล้ว แต่ยังไม่พบรายการงาน"
          : manualReviewOnly
          ? car_row_id
            ? "AI ยังแยกงานไม่ได้ — รอตรวจด้วยมือ"
            : "AI ยังแยกงานไม่ได้"
          : "",
        new_lines: newEntries,
        new_line_count: newEntries.length,
        action_lines: actionEntriesForMessage,
        action_line_count: actionEntriesForMessage.length,
        existing_items: uniqueExistingItems(payload.existing_items ?? []),
        attachments: messageAttachments,
        needs_human_review: queueNeedsHumanReview,
        group_anchor_id: relatedTextMessageId || (isLineImageOnlyText(row.raw_text) ? imageOnlyFallbackGroupAnchor(row) : id),
      });
    }

    const recentUniqueAttachments = uniqueAttachments(recentAttachments).slice(0, 40);
    const groups = groupMessages(messages);

    return NextResponse.json({
      ok: true,
      total_new_lines: totalNew,
      total_action_lines: totalAction,
      total_manual_reviews: totalManualReview,
      messages,
      groups,
      recent_attachments: recentUniqueAttachments,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
