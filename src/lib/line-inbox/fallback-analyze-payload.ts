import type { SupabaseClient } from "@supabase/supabase-js";
import { buildFallbackAnalyzeItemsFromRawText } from "@/lib/line-inbox/fallback-analyze-items";
import { hasTooManyLineAutoSaveItems } from "@/lib/line-inbox/auto-save-safety";
import { fetchOrderItemsForTask, fetchOrderTaskIdForCar } from "@/lib/line-inbox/fetch-task-items";
import { resolveCarFromContext } from "@/lib/line-inbox/resolve-car";
import type { ExistingOrderItemRow, LineInboxAnalyzeResponse } from "@/lib/line-inbox/types";

export async function buildFallbackAnalyzePayloadFromRawText(
  supabase: SupabaseClient,
  opts: {
    raw_text: unknown;
    car_row_id?: unknown;
    existing_items?: ExistingOrderItemRow[];
  }
): Promise<LineInboxAnalyzeResponse> {
  const rawText = String(opts.raw_text ?? "").trim();
  const explicitCarRowId = String(opts.car_row_id ?? "").trim();
  const resolved = await resolveCarFromContext(supabase, {
    raw_text: rawText,
    car_row_id: explicitCarRowId || null,
  });
  const carRowId = resolved.car_row_id || explicitCarRowId;

  let existingItems = opts.existing_items ?? [];
  if (carRowId && existingItems.length === 0) {
    const taskId = await fetchOrderTaskIdForCar(supabase, carRowId, null);
    existingItems = taskId ? await fetchOrderItemsForTask(supabase, taskId) : [];
  }

  const items = buildFallbackAnalyzeItemsFromRawText(rawText, existingItems, Boolean(carRowId));

  return {
    detected_car: {
      plate_text: resolved.plate_text || "",
      chassis: resolved.chassis || "",
      car_row_id: carRowId,
      confidence: resolved.confidence || 0,
      spec_text: resolved.spec_text || "",
      sale: resolved.sale || "",
    },
    ignored_vehicle_spec_lines: [],
    ignored_mention_lines: [],
    ignored_noise_lines: [],
    line_attachments: [],
    attachments_meta_count: 0,
    extractedCarCandidates: resolved.extractedCarCandidates ?? [],
    aiTargetCarReference: resolved.aiTargetCarReference ?? "",
    aiTargetCarConfidence: resolved.aiTargetCarConfidence ?? "",
    matchReason: resolved.matchReason ?? "",
    existing_items: existingItems,
    items,
    needs_human_review: !carRowId || items.length === 0 || hasTooManyLineAutoSaveItems(items.length),
  };
}
