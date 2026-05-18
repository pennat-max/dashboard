import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchOrderItemsForTask, fetchOrderTaskIdForCar } from "@/lib/line-inbox/fetch-task-items";
import { resolveCarFromContext } from "@/lib/line-inbox/resolve-car";
import { classifyDuplicateLine, suggestCategoryAndStatus } from "@/lib/line-inbox/heuristic-suggest";
import { splitLineTextToTaskLines } from "@/lib/line-inbox/split-line-text";
import type { LineInboxAnalyzeResponse } from "@/lib/line-inbox/types";

export type RunLineInboxAnalyzeInput = {
  raw_text: string;
  car_row_id?: string | null;
  car_id?: number | null;
  attachmentsCount?: number;
};

/**
 * Shared analyze pipeline (read-only — never writes order_items).
 * Used by POST /api/line-inbox/analyze and LINE webhook processing.
 */
export async function runLineInboxAnalyzeCore(
  supabase: SupabaseClient,
  input: RunLineInboxAnalyzeInput
): Promise<LineInboxAnalyzeResponse & { attachments_meta_count: number }> {
  const raw_text = String(input.raw_text ?? "").trim();
  const car_row_id_in = String(input.car_row_id ?? "").trim();
  const carIdForTask = input.car_id != null && Number.isFinite(Number(input.car_id)) ? Number(input.car_id) : null;
  const attachmentsCount = Math.max(0, Math.floor(input.attachmentsCount ?? 0));

  const detected = await resolveCarFromContext(supabase, {
    car_row_id: car_row_id_in || null,
    car_id: carIdForTask,
    raw_text,
  });

  const carResolved = Boolean(detected.car_row_id);
  let existing: Array<{ id: string; label: string; status: string }> = [];
  if (carResolved) {
    const taskId = await fetchOrderTaskIdForCar(supabase, detected.car_row_id, carIdForTask);
    if (taskId) {
      existing = await fetchOrderItemsForTask(supabase, taskId);
    }
  }

  const lines = splitLineTextToTaskLines(raw_text);
  const items: LineInboxAnalyzeResponse["items"] = [];

  for (const line of lines) {
    const { suggested_category, suggested_status } = suggestCategoryAndStatus(line);
    const dup = classifyDuplicateLine(line, existing, carResolved);
    const carBoost =
      detected.confidence > 0 ? Math.min(1, 0.45 + detected.confidence * 0.55) : 0.35;
    const itemConfidence = Math.min(dup.confidence, carBoost);

    items.push({
      raw_text: line,
      suggested_item_name: line.slice(0, 200),
      suggested_category,
      suggested_status,
      duplicate_status: dup.duplicate_status,
      matched_order_item_id: dup.matched_order_item_id,
      matched_item_name: dup.matched_item_name,
      confidence: Math.round(itemConfidence * 100) / 100,
      reason: dup.reason,
    });
  }

  const needs_human_review =
    detected.confidence < 0.6 ||
    items.some(
      (i) => i.duplicate_status === "possible_duplicate" || i.duplicate_status === "unclear"
    ) ||
    items.length === 0;

  return {
    detected_car: {
      plate_text: detected.plate_text,
      chassis: detected.chassis,
      car_row_id: detected.car_row_id,
      confidence: Math.round(detected.confidence * 100) / 100,
    },
    items,
    needs_human_review,
    attachments_meta_count: attachmentsCount,
  };
}
