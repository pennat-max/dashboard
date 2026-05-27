import type { LineInboxAnalyzeResponse } from "@/lib/line-inbox/types";

export type LineReplyCaptureContext = {
  quoted_message_id: string;
  quote_token?: string;
  context_source: "reply_context";
};

export type LineReplyAnalyzeContext = {
  context_source: "reply_context";
  quoted_message_id: string;
  source_line_message_id?: string;
  source_inbox_message_id?: string;
  source_car_row_id?: string;
  source_raw_text?: string;
  source_raw_text_preview?: string;
  source_detected_car?: Partial<LineInboxAnalyzeResponse["detected_car"]>;
  confidence?: "high" | "medium" | "low";
  reason?: string;
};

function cleanLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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
  if (!context?.quoted_message_id) return payload;
  const sourceCarRowId = cleanLine(context.source_car_row_id);
  const reason =
    cleanLine(context.reason) ||
    (sourceCarRowId
      ? "จากข้อความที่ reply: ใช้รถจากข้อความก่อนหน้า"
      : "จากข้อความที่ reply: ใช้ข้อความก่อนหน้าเป็นบริบทรถ");
  return {
    ...payload,
    context_source: "reply_context",
    reply_context: {
      context_source: "reply_context",
      quoted_message_id: context.quoted_message_id,
      source_line_message_id: cleanLine(context.source_line_message_id) || undefined,
      source_inbox_message_id: cleanLine(context.source_inbox_message_id) || undefined,
      source_car_row_id: sourceCarRowId || undefined,
      source_raw_text_preview: cleanLine(context.source_raw_text_preview) || previewReplyContextRawText(context.source_raw_text),
      source_detected_car: context.source_detected_car,
      confidence: context.confidence ?? (sourceCarRowId ? "high" : "medium"),
      reason,
    },
    matchReason: payload.matchReason ? `${reason} · ${payload.matchReason}` : reason,
  };
}
