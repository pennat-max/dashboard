import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchOrderItemsForTask, fetchOrderTaskIdForCar } from "@/lib/line-inbox/fetch-task-items";
import { resolveCarFromContext } from "@/lib/line-inbox/resolve-car";
import { classifyDuplicateLine, suggestCategoryAndStatus } from "@/lib/line-inbox/heuristic-suggest";
import { runLineInboxAiAnalyze, type LineInboxAiAnalyzeDraft } from "@/lib/line-inbox/ai-analyze";
import { splitLineTextForInbox } from "@/lib/line-inbox/split-line-text";
import type { ExistingOrderItemRow, LineInboxAnalyzeResponse } from "@/lib/line-inbox/types";

export type RunLineInboxAnalyzeInput = {
  raw_text: string;
  car_row_id?: string | null;
  car_id?: number | null;
  attachmentsCount?: number;
  useAi?: boolean;
};

type GuardedLine = { text: string; note?: string; aiConfidence?: number; aiReason?: string };

function addUnique(target: string[], value: string) {
  const clean = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return;
  const key = clean.toLowerCase();
  if (target.some((v) => v.toLowerCase() === key)) return;
  target.push(clean);
}

function lineKey(value: string): string {
  return String(value ?? "").replace(/\s+/g, "").toLowerCase();
}

function comparableLineKey(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/ตาม\s*(?:รูป|ภาพ)/g, "")
    .replace(/\b(?:photo|image|pic|picture)\b/g, "")
    .replace(/[^\p{L}\p{N}%]+/gu, "")
    .trim();
}

function hasReferencePhotoText(value: string): boolean {
  return /ตาม\s*(?:รูป|ภาพ)|\b(?:photo|image|pic|picture)\b/i.test(value);
}

function hasPreservedDetailToken(value: string): boolean {
  return /[\d%]|(?:km|กม\.?|กิโล|เปอร์เซ็น|นิ้ว|cm|mm|inch|วัน|เดือน|ปี)/i.test(value);
}

function areEquivalentWorkLines(left: string, right: string): boolean {
  const a = comparableLineKey(left);
  const b = comparableLineKey(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 6 && longer.includes(shorter);
}

function workLineScore(line: GuardedLine): number {
  const text = String(line.text ?? "");
  let score = comparableLineKey(text).length;
  if (hasReferencePhotoText(text)) score += 100;
  if (hasPreservedDetailToken(text)) score += 40;
  if (line.note) score += Math.min(30, line.note.length);
  if (typeof line.aiConfidence === "number") score += line.aiConfidence;
  return score;
}

function upsertGuardedLine(target: GuardedLine[], next: GuardedLine) {
  const cleanText = String(next.text ?? "").replace(/\s+/g, " ").trim();
  if (!cleanText) return;
  const candidate: GuardedLine = { ...next, text: cleanText };
  const existingIndex = target.findIndex((line) => areEquivalentWorkLines(line.text, candidate.text));
  if (existingIndex < 0) {
    target.push(candidate);
    return;
  }

  const existing = target[existingIndex];
  const keepCandidate = workLineScore(candidate) > workLineScore(existing);
  const kept: GuardedLine = keepCandidate ? candidate : existing;
  const other: GuardedLine = keepCandidate ? existing : candidate;
  target[existingIndex] = {
    ...kept,
    note: mergeNote(kept.note, other.note),
    aiConfidence: kept.aiConfidence ?? other.aiConfidence,
    aiReason: kept.aiReason ?? other.aiReason,
  };
}

function mergeNote(existing: string | undefined, next: string | undefined): string {
  const parts = String(existing ?? "")
    .split(/\s*\/\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of String(next ?? "")
    .split(/\s*\/\s*/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    if (!parts.some((v) => lineKey(v) === lineKey(part))) parts.push(part);
  }
  return parts.join(" / ");
}

function asAiItemText(item: NonNullable<LineInboxAiAnalyzeDraft["items"]>[number]): {
  text: string;
  note?: string;
  confidence?: number;
  reason?: string;
} {
  if (typeof item === "string") return { text: item.trim() };
  const text = String(item.suggested_item_name ?? item.raw_text ?? "").trim();
  return {
    text,
    note: String(item.suggested_note ?? "").trim() || undefined,
    confidence: typeof item.confidence === "number" ? item.confidence : undefined,
    reason: String(item.reason ?? "").trim() || undefined,
  };
}

function mergeAiWithRuleGuard(
  rawText: string,
  aiDraft: LineInboxAiAnalyzeDraft | null
): {
  lines: GuardedLine[];
  ignored_vehicle_spec_lines: string[];
  ignored_mention_lines: string[];
  ignored_noise_lines: string[];
  aiNeedsHumanReview: boolean;
} {
  const fallback = splitLineTextForInbox(rawText);
  const ignoredVehicle = [...fallback.ignored_vehicle_spec_lines];
  const ignoredMention = [...fallback.ignored_mention_lines];
  const ignoredNoise = [...fallback.ignored_noise_lines];

  for (const line of aiDraft?.ignored_vehicle_spec_lines ?? []) addUnique(ignoredVehicle, line);
  if (aiDraft?.detected_car_text) addUnique(ignoredVehicle, aiDraft.detected_car_text);
  for (const candidate of aiDraft?.candidate_cars ?? []) {
    if (candidate.text) addUnique(ignoredVehicle, candidate.text);
  }
  for (const line of aiDraft?.ignored_mention_lines ?? []) addUnique(ignoredMention, line);
  for (const line of aiDraft?.ignored_noise_lines ?? []) addUnique(ignoredNoise, line);

  const fallbackGrouped = (fallback.grouped_items ?? []).filter((item) => item.text);
  const sourceItems = aiDraft?.items?.length
    ? aiDraft.items
    : fallbackGrouped.length
      ? fallbackGrouped.map((item) => ({
          raw_text: item.text,
          suggested_item_name: item.text,
          suggested_note: item.note,
        }))
      : fallback.items;
  const guardedLines: GuardedLine[] = [];

  for (const source of sourceItems) {
    const candidate = asAiItemText(source);
    if (!candidate.text) continue;

    const guarded = splitLineTextForInbox(candidate.text);
    for (const line of guarded.ignored_vehicle_spec_lines) addUnique(ignoredVehicle, line);
    for (const line of guarded.ignored_mention_lines) addUnique(ignoredMention, line);
    for (const line of guarded.ignored_noise_lines) addUnique(ignoredNoise, line);

    for (const [lineIndex, line] of guarded.items.entries()) {
      const note = lineIndex === 0 ? candidate.note : undefined;
      upsertGuardedLine(guardedLines, {
        text: line,
        note,
        aiConfidence: candidate.confidence,
        aiReason: candidate.reason,
      });
    }
  }

  for (const grouped of fallbackGrouped) {
    upsertGuardedLine(guardedLines, { text: grouped.text, note: grouped.note || undefined });
  }

  if (guardedLines.length === 0 && fallback.items.length > 0) {
    for (const grouped of fallbackGrouped.length ? fallbackGrouped : fallback.items.map((text) => ({ text, note: "" }))) {
      upsertGuardedLine(guardedLines, { text: grouped.text, note: grouped.note || undefined });
    }
  }

  return {
    lines: guardedLines,
    ignored_vehicle_spec_lines: ignoredVehicle.slice(0, 30),
    ignored_mention_lines: ignoredMention.slice(0, 30),
    ignored_noise_lines: ignoredNoise.slice(0, 30),
    aiNeedsHumanReview: Boolean(aiDraft?.needs_human_review || (aiDraft?.candidate_cars?.length ?? 0) > 1),
  };
}

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
  let existing: ExistingOrderItemRow[] = [];
  if (carResolved) {
    const taskId = await fetchOrderTaskIdForCar(supabase, detected.car_row_id, carIdForTask);
    if (taskId) {
      existing = await fetchOrderItemsForTask(supabase, taskId);
    }
  }

  let aiDraft: LineInboxAiAnalyzeDraft | null = null;
  if (input.useAi) {
    try {
      aiDraft = await runLineInboxAiAnalyze(raw_text);
    } catch {
      aiDraft = null;
    }
  }

  const guarded = mergeAiWithRuleGuard(raw_text, aiDraft);
  const items: LineInboxAnalyzeResponse["items"] = [];

  for (const lineInfo of guarded.lines) {
    const line = lineInfo.text;
    const { suggested_category, suggested_status } = suggestCategoryAndStatus(line);
    const dup = classifyDuplicateLine(line, existing, carResolved);
    const carBoost =
      detected.confidence > 0 ? Math.min(1, 0.45 + detected.confidence * 0.55) : 0.35;
    const aiConfidence =
      typeof lineInfo.aiConfidence === "number"
        ? Math.max(0, Math.min(1, lineInfo.aiConfidence))
        : 1;
    const itemConfidence = Math.min(dup.confidence, carBoost, aiConfidence);

    items.push({
      raw_text: line,
      suggested_item_name: line.slice(0, 200),
      suggested_note: String(lineInfo.note ?? "").trim() || undefined,
      suggested_category,
      suggested_status,
      duplicate_status: dup.duplicate_status,
      matched_order_item_id: dup.matched_order_item_id,
      matched_item_name: dup.matched_item_name,
      confidence: Math.round(itemConfidence * 100) / 100,
      reason: lineInfo.aiReason ? `${dup.reason} · AI: ${lineInfo.aiReason}` : dup.reason,
    });
  }

  const needs_human_review =
    guarded.aiNeedsHumanReview ||
    detected.confidence < 0.6 ||
    items.some((i) => i.confidence < 0.55) ||
    items.some(
      (i) => i.duplicate_status === "possible_duplicate" || i.duplicate_status === "unclear"
    ) ||
    items.length === 0;

  return {
    detected_car: {
      plate_text: detected.plate_text || String(aiDraft?.detected_car?.plate_text ?? "").trim(),
      chassis: detected.chassis || String(aiDraft?.detected_car?.chassis ?? "").trim(),
      car_row_id: detected.car_row_id,
      confidence: Math.round(detected.confidence * 100) / 100,
      spec_text: detected.spec_text,
      sale: detected.sale,
    },
    ignored_vehicle_spec_lines: guarded.ignored_vehicle_spec_lines,
    ignored_mention_lines: guarded.ignored_mention_lines,
    ignored_noise_lines: guarded.ignored_noise_lines,
    existing_items: existing,
    items,
    needs_human_review,
    attachments_meta_count: attachmentsCount,
  };
}
