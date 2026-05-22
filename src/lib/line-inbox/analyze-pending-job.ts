import {
  LINE_INBOX_MESSAGES_TABLE,
  updateLineInboxMessageAnalyze,
} from "@/lib/line-inbox/line-inbox-messages";
import { runLineInboxAnalyzeCore } from "@/lib/line-inbox/run-analyze-core";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type AnalyzePendingOptions = {
  limit?: unknown;
  line_inbox_message_id?: unknown;
  use_ai?: unknown;
};

type PendingInboxRow = {
  id: string;
  raw_text: string;
  car_row_id?: string | null;
};

type AnalyzePendingItemResult = {
  inbox_message_id: string;
  analyze_status: "ok" | "error";
  item_count?: number;
  needs_human_review?: boolean;
  car_row_id?: string | null;
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

/**
 * Advisory pending analyzer for webhook captures.
 *
 * This updates line_inbox_messages analyze fields only. It must not create
 * order_items, reply to LINE, or approve work without a human.
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
      .select("id,raw_text,car_row_id")
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
        const payload = await runLineInboxAnalyzeCore(supabase, {
          raw_text: rawText,
          car_row_id: existingCarRowId || null,
          attachmentsCount: 0,
          useAi,
        });
        const detectedCarRowId = String(payload.detected_car.car_row_id ?? "").trim();
        const carRowId = detectedCarRowId || existingCarRowId || null;

        await updateLineInboxMessageAnalyze(supabase, inboxId, {
          analyze_status: "ok",
          analyze_error: null,
          analyze_payload: payload,
          needs_human_review: payload.needs_human_review,
          car_row_id: carRowId,
        });

        results.push({
          inbox_message_id: inboxId,
          analyze_status: "ok",
          item_count: payload.items.length,
          needs_human_review: payload.needs_human_review,
          car_row_id: carRowId,
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
