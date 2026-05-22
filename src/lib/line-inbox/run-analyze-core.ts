import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchOrderItemsForTask, fetchOrderTaskIdForCar } from "@/lib/line-inbox/fetch-task-items";
import { resolveCarFromContextForAnalyze } from "@/lib/line-inbox/resolve-car";
import { LINE_INBOX_IMAGE_PLACEHOLDER } from "@/lib/line-inbox/line-image-placeholder";
import { classifyDuplicateLine, suggestCategoryAndStatus } from "@/lib/line-inbox/heuristic-suggest";
import { extractLineInboxTaskLines } from "@/lib/line-inbox/extract-line-inbox-task-lines";
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

  const carAnalyze = await resolveCarFromContextForAnalyze(supabase, {
    car_row_id: car_row_id_in || null,
    car_id: carIdForTask,
    raw_text,
  });
  const detected = carAnalyze.resolved;

  const carResolved = Boolean(detected.car_row_id);
  let existing: Array<{ id: string; label: string; status: string }> = [];
  if (carResolved) {
    const taskId = await fetchOrderTaskIdForCar(supabase, detected.car_row_id, carIdForTask);
    if (taskId) {
      existing = await fetchOrderItemsForTask(supabase, taskId);
    }
  }

  let taskLines: string[];
  let taskLinesSource: "heuristic" | "llm";
  let taskLinesHeuristic: string[];
  let lines_ai_by_model: { groq: string[]; gemini: string[] } | undefined;
  let lines_llm_pick: "groq" | "gemini" | null | undefined;

  if (raw_text === LINE_INBOX_IMAGE_PLACEHOLDER) {
    taskLines = [];
    taskLinesSource = "heuristic";
    taskLinesHeuristic = [];
    lines_ai_by_model = undefined;
    lines_llm_pick = undefined;
  } else {
    const ex = await extractLineInboxTaskLines(raw_text, existing.map((e) => e.label));
    taskLines = ex.lines;
    taskLinesSource = ex.lines_source;
    taskLinesHeuristic = ex.lines_heuristic;
    lines_ai_by_model = ex.lines_ai_by_model;
    lines_llm_pick = ex.lines_llm_pick;
  }

  const lines = taskLines;
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

  if (attachmentsCount > 0 && items.length === 0) {
    const label = "ตามรูป / ตรวจงานจากภาพ";
    const { suggested_category, suggested_status } = suggestCategoryAndStatus(label);
    items.push({
      raw_text: LINE_INBOX_IMAGE_PLACEHOLDER,
      suggested_item_name: label,
      suggested_category,
      suggested_status,
      duplicate_status: "new",
      matched_order_item_id: "",
      matched_item_name: "",
      confidence: 0.45,
      reason: "แนบรูปจาก LINE — สร้างรายการร่างให้ตรวจและดูภาพประกอบ",
    });
  }

  const needs_human_review =
    attachmentsCount > 0 ||
    detected.confidence < 0.6 ||
    taskLinesSource === "llm" ||
    items.some(
      (i) => i.duplicate_status === "possible_duplicate" || i.duplicate_status === "unclear"
    ) ||
    items.length === 0;

  return {
    detected_car: {
      plate_text: detected.plate_text,
      chassis: detected.chassis,
      spec: detected.spec,
      car_row_id: detected.car_row_id,
      confidence: Math.round(detected.confidence * 100) / 100,
      line_spec_snippet: detected.line_spec_snippet,
      db_spec: detected.db_spec,
    },
    ...(carAnalyze.car_ai_by_model ? { detected_car_ai_by_model: carAnalyze.car_ai_by_model } : {}),
    items,
    needs_human_review,
    task_lines_source: taskLinesSource,
    task_lines_heuristic: taskLinesHeuristic,
    ...(lines_ai_by_model ? { task_lines_ai_by_model: lines_ai_by_model } : {}),
    ...(typeof lines_llm_pick !== "undefined"
      ? { task_lines_chosen_llm: lines_llm_pick }
      : {}),
    attachments_meta_count: attachmentsCount,
  };
}
