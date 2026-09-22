import type { LineInboxAnalyzeResponse } from "@/lib/line-inbox/types";

export type LineReplyCaptureContext = {
  quoted_message_id: string;
  quote_token?: string;
  context_source: "reply_context";
};

export type LineReplyAnalyzeContext = {
  context_source: "reply_context" | "fallback_previous_message";
  quoted_message_id?: string;
  source_line_message_id?: string;
  source_inbox_message_id?: string;
  source_car_row_id?: string;
  source_raw_text?: string;
  source_raw_text_preview?: string;
  source_detected_car?: Partial<LineInboxAnalyzeResponse["detected_car"]>;
  confidence?: "high" | "medium" | "low";
  reason?: string;
  fallback_window_ms?: number;
  ambiguous?: boolean;
};

export type FallbackPreviousMessageCandidate = {
  id?: unknown;
  line_message_id?: unknown;
  raw_text?: unknown;
  received_at?: unknown;
  analyze_status?: unknown;
  analyze_payload?: unknown;
  car_row_id?: unknown;
};

export const LINE_REPLY_FALLBACK_PREVIOUS_WINDOW_MS = 5 * 60 * 1000;

const THAI_PLATE_RE = /(?<![\u0E00-\u0E7F])\d{0,2}[\u0E01-\u0E2E]{1,3}[-\s]?\d{2,4}/;
const CHASSIS_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/i;
const VEHICLE_STOCK_CONTEXT_RE =
  /\b\d{4,6}\b.*\b(?:TRAVO|REVO|ROCCO|RAPTOR|FORTUNER|COMMUTER|RANGER|VIGO|HILUX|OVERLAND|4WD|2WD|D-?CAB|DOUBLE|CAB|SUV|VAN|AT|MT)\b/i;
const SHORT_STATUS_CONTEXT_RE =
  /(รถ\s*(?:เข้า|มา)\s*(?:มา)?แล้ว|รถ\s*(?:เข้า|มา)|มา\s*(?:แล้ว|เมื่อวาน)|เข้ามาแล้ว)/i;

function cleanLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values.map(cleanLine).filter(Boolean)) {
    if (!out.some((entry) => entry.toLowerCase() === value.toLowerCase())) out.push(value);
  }
  return out;
}

function isAnalyzePayload(body: unknown): body is LineInboxAnalyzeResponse {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  return Boolean(o.detected_car && typeof o.detected_car === "object" && Array.isArray(o.items));
}

function cleanRawTextForStatus(value: unknown): string {
  return cleanLine(value)
    .replace(/@\S+/g, " ")
    .replace(/[💕❤❤️✅🙏👍🚗🛻🚙]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasExplicitCarIdentity(value: unknown): boolean {
  const text = cleanLine(value);
  return THAI_PLATE_RE.test(text) || CHASSIS_RE.test(text) || VEHICLE_STOCK_CONTEXT_RE.test(text);
}

export function isFallbackPreviousMessageStatusLike(value: unknown): boolean {
  const text = cleanRawTextForStatus(value);
  if (!text || text.length > 80) return false;
  if (hasExplicitCarIdentity(text)) return false;
  return SHORT_STATUS_CONTEXT_RE.test(text);
}

function detectedCarFromPayload(
  payload: LineInboxAnalyzeResponse | null
): Partial<LineInboxAnalyzeResponse["detected_car"]> | undefined {
  if (!payload?.detected_car) return undefined;
  const car = payload.detected_car;
  if (
    !cleanLine(car.car_row_id) &&
    !cleanLine(car.plate_text) &&
    !cleanLine(car.chassis) &&
    !cleanLine(car.spec_text)
  ) {
    return undefined;
  }
  return car;
}

function sourceCarRowIdForCandidate(candidate: FallbackPreviousMessageCandidate): string {
  const payload = isAnalyzePayload(candidate.analyze_payload) ? candidate.analyze_payload : null;
  return cleanLine(candidate.car_row_id) || cleanLine(payload?.detected_car?.car_row_id);
}

function sourceIdentityForCandidate(candidate: FallbackPreviousMessageCandidate): string {
  const payload = isAnalyzePayload(candidate.analyze_payload) ? candidate.analyze_payload : null;
  const carRowId = sourceCarRowIdForCandidate(candidate);
  if (carRowId) return `car:${carRowId}`;
  const detected = payload?.detected_car;
  const detectedKey = [detected?.plate_text, detected?.chassis, detected?.spec_text].map(cleanLine).filter(Boolean).join("|");
  if (detectedKey) return `detected:${detectedKey}`;
  const candidateKey = (payload?.extractedCarCandidates ?? [])
    .map((candidate) => cleanLine(candidate.text) || cleanLine(candidate.line))
    .filter(Boolean)
    .join("|");
  if (candidateKey) return `candidate:${candidateKey}`;
  return "";
}

function hasStrongParentContext(candidate: FallbackPreviousMessageCandidate): boolean {
  if (cleanLine(candidate.analyze_status) !== "ok") return false;
  if (sourceCarRowIdForCandidate(candidate)) return true;
  const payload = isAnalyzePayload(candidate.analyze_payload) ? candidate.analyze_payload : null;
  if (!payload) return false;
  if (payload.matchStatus === "waiting_for_car_record" || payload.unmatchedReason === "pending_car_record") return true;
  if (detectedCarFromPayload(payload)) return true;
  return (payload.extractedCarCandidates ?? []).length > 0 && hasExplicitCarIdentity(candidate.raw_text);
}

export function resolveFallbackPreviousMessageContextFromRows(input: {
  row: { raw_text?: unknown; received_at?: unknown };
  candidates: FallbackPreviousMessageCandidate[];
  windowMs?: number;
}): LineReplyAnalyzeContext | null {
  if (!isFallbackPreviousMessageStatusLike(input.row.raw_text)) return null;

  const currentTime = Date.parse(cleanLine(input.row.received_at));
  if (!Number.isFinite(currentTime)) return null;
  const windowMs = Math.max(60_000, Math.min(15 * 60_000, Number(input.windowMs ?? LINE_REPLY_FALLBACK_PREVIOUS_WINDOW_MS)));
  const candidates = input.candidates
    .filter(hasStrongParentContext)
    .map((candidate) => {
      const time = Date.parse(cleanLine(candidate.received_at));
      return { candidate, time, delta: currentTime - time };
    })
    .filter((entry) => Number.isFinite(entry.time) && entry.delta >= 0 && entry.delta <= windowMs)
    .sort((a, b) => a.delta - b.delta);

  if (candidates.length === 0) return null;

  const identities = uniqueStrings(candidates.map((entry) => sourceIdentityForCandidate(entry.candidate)).filter(Boolean));
  if (identities.length > 1) {
    return {
      context_source: "fallback_previous_message",
      confidence: "low",
      reason: "ระบบเดาว่าอาจอ้างอิงจากข้อความก่อนหน้า แต่พบรถหลายคันในช่วงเวลาใกล้กัน",
      fallback_window_ms: windowMs,
      ambiguous: true,
    };
  }

  const parent = candidates[0].candidate;
  const parentPayload = isAnalyzePayload(parent.analyze_payload) ? parent.analyze_payload : null;
  const sourceCarRowId = sourceCarRowIdForCandidate(parent);
  return {
    context_source: "fallback_previous_message",
    source_line_message_id: cleanLine(parent.line_message_id),
    source_inbox_message_id: cleanLine(parent.id),
    source_car_row_id: sourceCarRowId || undefined,
    source_raw_text: cleanLine(parent.raw_text),
    source_raw_text_preview: previewReplyContextRawText(parent.raw_text),
    source_detected_car: detectedCarFromPayload(parentPayload),
    confidence: sourceCarRowId ? "high" : "medium",
    reason: sourceCarRowId
      ? "ระบบเดาว่าอาจอ้างอิงจากข้อความก่อนหน้า: ใช้รถจากข้อความก่อนหน้า"
      : "ระบบเดาว่าอาจอ้างอิงจากข้อความก่อนหน้า: ใช้ข้อความก่อนหน้าเป็นบริบทรถ",
    fallback_window_ms: windowMs,
  };
}

export function extractLineQuotedMessageId(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const body = message as { quotedMessageId?: unknown };
  return cleanLine(body.quotedMessageId);
}

export function extractLineQuoteToken(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const body = message as { quoteToken?: unknown };
  return cleanLine(body.quoteToken);
}

export function makeLineReplyCaptureAnalyzePayload(input: {
  quotedMessageId?: string | null;
  quoteToken?: string | null;
}) {
  const quotedMessageId = cleanLine(input.quotedMessageId);
  if (!quotedMessageId) return null;
  const quoteToken = cleanLine(input.quoteToken);
  return {
    line_context: {
      context_source: "reply_context",
      quoted_message_id: quotedMessageId,
      ...(quoteToken ? { quote_token: quoteToken } : {}),
    } satisfies LineReplyCaptureContext,
  };
}

export function getQuotedMessageIdFromAnalyzePayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const body = payload as {
    line_context?: { quoted_message_id?: unknown };
    reply_context?: { quoted_message_id?: unknown };
  };
  return cleanLine(body.reply_context?.quoted_message_id) || cleanLine(body.line_context?.quoted_message_id);
}

export function previewReplyContextRawText(value: unknown): string {
  return cleanLine(value).slice(0, 240);
}

export function withLineReplyAnalyzeContext<T extends LineInboxAnalyzeResponse>(
  payload: T,
  context: LineReplyAnalyzeContext | null
): T {
  if (!context?.context_source) return payload;
  const sourceCarRowId = cleanLine(context.source_car_row_id);
  const contextSource = context.context_source;
  const reason =
    cleanLine(context.reason) ||
    (contextSource === "fallback_previous_message"
      ? "ระบบเดาว่าอาจอ้างอิงจากข้อความก่อนหน้า"
      : sourceCarRowId
        ? "จากข้อความที่ reply: ใช้รถจากข้อความก่อนหน้า"
        : "จากข้อความที่ reply: ใช้ข้อความก่อนหน้าเป็นบริบทรถ");
  const contextRequiresReview = contextSource === "fallback_previous_message";
  return {
    ...payload,
    context_source: contextSource,
    reply_context: {
      context_source: contextSource,
      quoted_message_id: cleanLine(context.quoted_message_id) || undefined,
      source_line_message_id: cleanLine(context.source_line_message_id) || undefined,
      source_inbox_message_id: cleanLine(context.source_inbox_message_id) || undefined,
      source_car_row_id: sourceCarRowId || undefined,
      source_raw_text_preview: cleanLine(context.source_raw_text_preview) || previewReplyContextRawText(context.source_raw_text),
      source_detected_car: context.source_detected_car,
      confidence: context.confidence ?? (sourceCarRowId ? "high" : "medium"),
      reason,
      fallback_window_ms: context.fallback_window_ms,
      ambiguous: context.ambiguous || undefined,
    },
    matchReason: payload.matchReason ? `${reason} · ${payload.matchReason}` : reason,
    needs_human_review: contextRequiresReview ? true : payload.needs_human_review,
  };
}
