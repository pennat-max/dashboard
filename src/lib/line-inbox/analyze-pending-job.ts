import {
  LINE_INBOX_MESSAGES_TABLE,
  updateLineInboxMessageAnalyze,
} from "@/lib/line-inbox/line-inbox-messages";
import {
  isTruthyEnvFlag,
  maybeAutoSaveAnalyzedLineInbox,
  type LineAutoSaveRunResult,
} from "@/lib/line-inbox/auto-save";
import {
  LINE_REPLY_FALLBACK_PREVIOUS_WINDOW_MS,
  getQuotedMessageIdFromAnalyzePayload,
  previewReplyContextRawText,
  resolveFallbackPreviousMessageContextFromRows,
  withLineReplyAnalyzeContext,
  type LineReplyAnalyzeContext,
} from "@/lib/line-inbox/reply-context";
import { runLineInboxAnalyzeCore } from "@/lib/line-inbox/run-analyze-core";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { LineInboxAnalyzeResponse } from "@/lib/line-inbox/types";

export type AnalyzePendingOptions = {
  limit?: unknown;
  line_inbox_message_id?: unknown;
  use_ai?: unknown;
};

type PendingInboxRow = {
  id: string;
  line_message_id?: string | null;
  raw_text: string;
  car_row_id?: string | null;
  source_type?: string | null;
  group_id?: string | null;
  user_id?: string | null;
  received_at?: string | null;
  workflow_status?: string | null;
  analyze_status?: string | null;
  analyze_payload?: unknown;
};

type AnalyzePendingItemResult = {
  inbox_message_id: string;
  analyze_status: "ok" | "error";
  item_count?: number;
  needs_human_review?: boolean;
  car_row_id?: string | null;
  auto_save?: LineAutoSaveRunResult | { enabled: boolean; attempted: boolean; saved: boolean; error: string };
  error?: string;
};

export type AnalyzePendingRunResult =
  | {
      ok: true;
      requested_limit: number;
      processed_count: number;
      analyzed_count: number;
      error_count: number;
      results: AnalyzePendingItemResult[];
    }
  | {
      ok: false;
      error: string;
      table_missing_hint?: string;
    };

export function clampAnalyzePendingLimit(value: unknown): number {
  const n = Number(value ?? 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(20, Math.floor(n)));
}

export function cleanAnalyzePendingError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s+/g, " ").trim().slice(0, 500) || "Analyze failed";
}

function isMissingTableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    (m.includes("relation") && m.includes("does not exist")) ||
    (m.includes("schema cache") && m.includes("could not find"))
  );
}

function cleanLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isAnalyzePayload(body: unknown): body is LineInboxAnalyzeResponse {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  return Boolean(o.detected_car && typeof o.detected_car === "object" && Array.isArray(o.items));
}

async function resolveLineReplyContext(
  supabase: ReturnType<typeof createServiceRoleClient>,
  row: PendingInboxRow
): Promise<LineReplyAnalyzeContext | null> {
  const quotedMessageId = getQuotedMessageIdFromAnalyzePayload(row.analyze_payload);
  if (!quotedMessageId) return null;

  let query = supabase
    .from(LINE_INBOX_MESSAGES_TABLE)
    .select("id,line_message_id,raw_text,source_type,group_id,user_id,workflow_status,analyze_status,analyze_payload,car_row_id")
    .eq("line_message_id", quotedMessageId)
    .limit(1);

  const sourceType = cleanLine(row.source_type);
  const groupId = cleanLine(row.group_id);
  const userId = cleanLine(row.user_id);
  if (sourceType) query = query.eq("source_type", sourceType);
  if (groupId) query = query.eq("group_id", groupId);
  if (!groupId && userId) query = query.eq("user_id", userId);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    return {
      context_source: "reply_context",
      quoted_message_id: quotedMessageId,
      confidence: "low",
      reason: "จากข้อความที่ reply: ไม่พบข้อความต้นฉบับใน inbox",
    };
  }

  const parent = data as PendingInboxRow;
  const parentPayload = isAnalyzePayload(parent.analyze_payload) ? parent.analyze_payload : null;
  const sourceCarRowId =
    cleanLine(parent.car_row_id) || cleanLine(parentPayload?.detected_car?.car_row_id);
  return {
    context_source: "reply_context",
    quoted_message_id: quotedMessageId,
    source_line_message_id: cleanLine(parent.line_message_id),
    source_inbox_message_id: cleanLine(parent.id),
    source_car_row_id: sourceCarRowId || undefined,
    source_raw_text: cleanLine(parent.raw_text),
    source_raw_text_preview: previewReplyContextRawText(parent.raw_text),
    source_detected_car: parentPayload?.detected_car,
    confidence: sourceCarRowId ? "high" : cleanLine(parent.raw_text) ? "medium" : "low",
    reason: sourceCarRowId
      ? "จากข้อความที่ reply: ใช้รถจากข้อความก่อนหน้า"
      : "จากข้อความที่ reply: ใช้ข้อความก่อนหน้าเป็นบริบทรถ",
  };
}

async function resolveFallbackPreviousMessageContext(
  supabase: ReturnType<typeof createServiceRoleClient>,
  row: PendingInboxRow
): Promise<LineReplyAnalyzeContext | null> {
  const rowTime = Date.parse(cleanLine(row.received_at));
  if (!Number.isFinite(rowTime)) return null;

  const sourceType = cleanLine(row.source_type);
  const groupId = cleanLine(row.group_id);
  const userId = cleanLine(row.user_id);
  if (!sourceType || (!groupId && !userId)) return null;

  let query = supabase
    .from(LINE_INBOX_MESSAGES_TABLE)
    .select("id,line_message_id,raw_text,received_at,analyze_status,analyze_payload,car_row_id")
    .eq("source_type", sourceType)
    .eq("analyze_status", "ok")
    .lt("received_at", new Date(rowTime).toISOString())
    .gte("received_at", new Date(rowTime - LINE_REPLY_FALLBACK_PREVIOUS_WINDOW_MS).toISOString())
    .order("received_at", { ascending: false })
    .limit(10);

  if (groupId) query = query.eq("group_id", groupId);
  if (!groupId && userId) query = query.eq("user_id", userId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return resolveFallbackPreviousMessageContextFromRows({
    row,
    candidates: (data ?? []) as Array<PendingInboxRow & { received_at?: string | null }>,
    windowMs: LINE_REPLY_FALLBACK_PREVIOUS_WINDOW_MS,
  });
}

/**
 * Pending analyzer for webhook captures.
 *
 * By default this only updates line_inbox_messages analyze fields. If explicit
 * LINE_AUTO_SAVE_* flags allow it, a high-confidence group message can be
 * persisted automatically after analyze; otherwise it remains in manual review.
 */
export async function runAnalyzePendingJob(
  options: AnalyzePendingOptions = {}
): Promise<AnalyzePendingRunResult> {
  const limit = clampAnalyzePendingLimit(options.limit);
  const targetId = String(options.line_inbox_message_id ?? "").trim();
  const useAi = options.use_ai !== false;
  const supabase = createServiceRoleClient();

  try {
    let query = supabase
      .from(LINE_INBOX_MESSAGES_TABLE)
      .select(
        "id,line_message_id,raw_text,source_type,group_id,user_id,received_at,workflow_status,analyze_status,analyze_payload,car_row_id"
      )
      .eq("workflow_status", "pending")
      .eq("analyze_status", "pending")
      .order("received_at", { ascending: true })
      .limit(limit);

    if (targetId) {
      query = query.eq("id", targetId).limit(1);
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingTableError(error.message)) {
        return {
          ok: false,
          error: "line_inbox_messages table is not available",
          table_missing_hint: LINE_INBOX_MESSAGES_TABLE,
        };
      }
      throw new Error(error.message);
    }

    const rows = ((data ?? []) as PendingInboxRow[]).filter((row) => row.id && row.raw_text);
    const results: AnalyzePendingItemResult[] = [];

    for (const row of rows) {
      const inboxId = String(row.id).trim();
      const rawText = String(row.raw_text ?? "").trim();
      const existingCarRowId = String(row.car_row_id ?? "").trim();

      try {
        const replyContext =
          (await resolveLineReplyContext(supabase, row)) ||
          (await resolveFallbackPreviousMessageContext(supabase, row));
        const replyCarRowId = cleanLine(replyContext?.source_car_row_id);
        const payload = await runLineInboxAnalyzeCore(supabase, {
          raw_text: rawText,
          car_row_id: existingCarRowId || replyCarRowId || null,
          car_context_text: replyContext?.source_raw_text ?? null,
          attachmentsCount: 0,
          useAi,
        });
        const payloadWithReplyContext = withLineReplyAnalyzeContext(payload, replyContext);
        const detectedCarRowId = String(payloadWithReplyContext.detected_car.car_row_id ?? "").trim();
        const carRowId = detectedCarRowId || existingCarRowId || null;

        await updateLineInboxMessageAnalyze(supabase, inboxId, {
          analyze_status: "ok",
          analyze_error: null,
          analyze_payload: payloadWithReplyContext,
          needs_human_review: payloadWithReplyContext.needs_human_review,
          car_row_id: carRowId,
        });
        let autoSave: AnalyzePendingItemResult["auto_save"];
        try {
          autoSave = await maybeAutoSaveAnalyzedLineInbox(supabase, {
            row: {
              id: inboxId,
              line_message_id: row.line_message_id,
              raw_text: rawText,
              source_type: row.source_type,
              group_id: row.group_id,
              user_id: row.user_id,
              received_at: row.received_at,
              workflow_status: row.workflow_status,
              analyze_status: "ok",
              car_row_id: carRowId,
            },
            payload: payloadWithReplyContext,
          });
        } catch (error) {
          autoSave = {
            enabled: isTruthyEnvFlag(process.env.LINE_AUTO_SAVE_ENABLED),
            attempted: true,
            saved: false,
            error: cleanAnalyzePendingError(error),
          };
          console.warn("[line-auto-save] skipped after analyze", {
            inbox_message_id: inboxId,
            error: autoSave.error,
          });
        }

        results.push({
          inbox_message_id: inboxId,
          analyze_status: "ok",
          item_count: payloadWithReplyContext.items.length,
          needs_human_review: payloadWithReplyContext.needs_human_review,
          car_row_id: carRowId,
          auto_save: autoSave,
        });
      } catch (error) {
        const msg = cleanAnalyzePendingError(error);
        await updateLineInboxMessageAnalyze(supabase, inboxId, {
          analyze_status: "error",
          analyze_error: msg,
          analyze_payload: null,
          needs_human_review: true,
          car_row_id: existingCarRowId || null,
        });
        results.push({
          inbox_message_id: inboxId,
          analyze_status: "error",
          error: msg,
          car_row_id: existingCarRowId || null,
        });
      }
    }

    const analyzedCount = results.filter((result) => result.analyze_status === "ok").length;
    const errorCount = results.filter((result) => result.analyze_status === "error").length;

    return {
      ok: true,
      requested_limit: limit,
      processed_count: results.length,
      analyzed_count: analyzedCount,
      error_count: errorCount,
      results,
    };
  } catch (error) {
    return { ok: false, error: cleanAnalyzePendingError(error) };
  }
}
