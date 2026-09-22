import { classifyDuplicateLine, suggestCategoryAndStatus } from "@/lib/line-inbox/heuristic-suggest";
import { splitLineTextForInbox } from "@/lib/line-inbox/split-line-text";
import type { ExistingOrderItemRow, LineInboxAnalyzeItem } from "@/lib/line-inbox/types";

function cleanLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function buildFallbackAnalyzeItemsFromRawText(
  rawText: unknown,
  existingItems: ExistingOrderItemRow[] = [],
  carResolved = false
): LineInboxAnalyzeItem[] {
  const split = splitLineTextForInbox(String(rawText ?? "").trim());
  const grouped = split.grouped_items.length
    ? split.grouped_items
    : split.items.map((text) => ({ text, note: "" }));

  return grouped
    .map((item, index): LineInboxAnalyzeItem | null => {
      const text = cleanLine(item.text);
      if (!text) return null;
      const { suggested_category, suggested_status } = suggestCategoryAndStatus(text);
      const duplicate = classifyDuplicateLine(text, existingItems, carResolved);
      return {
        raw_text: text,
        suggested_item_name: text.slice(0, 200),
        suggested_note: cleanLine(item.note) || undefined,
        suggested_category,
        suggested_status,
        duplicate_status: duplicate.duplicate_status,
        matched_order_item_id: duplicate.matched_order_item_id,
        matched_item_name: duplicate.matched_item_name,
        confidence: Math.round(Math.min(duplicate.confidence, carResolved ? 0.72 : 0.35) * 100) / 100,
        reason: `${duplicate.reason} · heuristic fallback from raw_text #${index + 1}`,
      };
    })
    .filter((item): item is LineInboxAnalyzeItem => Boolean(item));
}
