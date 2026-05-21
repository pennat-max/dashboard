import { NextResponse } from "next/server";
import { requireMutateRole } from "@/lib/auth/mutation-guard";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { LINE_INBOX_MESSAGES_TABLE } from "@/lib/line-inbox/line-inbox-messages";
import type { DuplicateStatus, LineInboxAnalyzeItem, LineInboxAnalyzeResponse } from "@/lib/line-inbox/types";

export const dynamic = "force-dynamic";

type PendingQueueNewLine = {
  item_index: number;
  raw_text: string;
  suggested_item_name: string;
  suggested_status: string;
  reason: string;
};

type PendingQueueMsg = {
  inbox_id: string;
  received_at: string;
  plate_display: string;
  car_row_id: string;
  raw_text_preview: string;
  new_lines: PendingQueueNewLine[];
  new_line_count: number;
  needs_human_review: boolean;
};

function isAnalyzePayload(body: unknown): body is LineInboxAnalyzeResponse {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  const dc = o.detected_car;
  if (!dc || typeof dc !== "object") return false;
  const items = o.items;
  return Array.isArray(items);
}

function queueItemDisplayName(item: LineInboxAnalyzeItem): string {
  const suggested = String(item.suggested_item_name ?? "").trim();
  const raw = String(item.raw_text ?? "").trim();
  if (!suggested) return raw;
  if (!raw) return suggested;

  const compactSuggested = suggested.replace(/\s+/g, "").toLowerCase();
  const compactRaw = raw.replace(/\s+/g, "").toLowerCase();
  const rawHasDetail =
    /[\d%]|ตาม\s*(?:รูป|ภาพ)|(?:km|กม\.?|กิโล|เปอร์เซ็น|นิ้ว|cm|mm|inch|วัน|เดือน|ปี)/i.test(
      raw
    );
  if (rawHasDetail && compactRaw.startsWith(compactSuggested) && raw.length > suggested.length) {
    return raw;
  }
  return suggested;
}

/**
 * GET /api/line-inbox/pending-queue
 * Rows from webhook: workflow pending + analyze ok → new-only suggestions for toolbar chip.
 */
export async function GET() {
  const gate = await requireMutateRole();
  if (!gate.ok) return gate.response;

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from(LINE_INBOX_MESSAGES_TABLE)
      .select("id,received_at,raw_text,analyze_payload,car_row_id")
      .eq("workflow_status", "pending")
      .eq("analyze_status", "ok")
      .order("received_at", { ascending: false })
      .limit(80);

    if (error) {
      const m = error.message.toLowerCase();
      if (
        (m.includes("relation") && m.includes("does not exist")) ||
        (m.includes("schema cache") && m.includes("could not find"))
      ) {
        return NextResponse.json({
          ok: true,
          total_new_lines: 0,
          messages: [] as Array<{ inbox_id: string; new_lines: unknown[] }>,
          table_missing_hint: LINE_INBOX_MESSAGES_TABLE,
        });
      }
      throw new Error(error.message);
    }

    const messages: PendingQueueMsg[] = [];
    let totalNew = 0;

    for (const row of data ?? []) {
      const id = String((row as { id?: unknown }).id ?? "").trim();
      const payloadRaw = (row as { analyze_payload?: unknown }).analyze_payload;
      if (!id || !isAnalyzePayload(payloadRaw)) continue;

      const payload = payloadRaw;
      const items = payload.items ?? [];
      const newEntries: PendingQueueNewLine[] = [];
      items.forEach((item: LineInboxAnalyzeItem, idx: number) => {
        const st = item.duplicate_status as DuplicateStatus;
        if (st !== "new") return;
        newEntries.push({
          item_index: idx,
          raw_text: item.raw_text ?? "",
          suggested_item_name: queueItemDisplayName(item),
          suggested_status: item.suggested_status ?? "",
          reason: item.reason ?? "",
        });
      });

      const crPayload = String(payload.detected_car?.car_row_id ?? "").trim();
      const crStored = String((row as { car_row_id?: unknown }).car_row_id ?? "").trim();
      const car_row_id = crPayload || crStored;
      const plate_text = String(payload.detected_car?.plate_text ?? "").trim() || "—";

      if (newEntries.length === 0) continue;

      totalNew += newEntries.length;
      messages.push({
        inbox_id: id,
        received_at: String((row as { received_at?: unknown }).received_at ?? ""),
        plate_display: plate_text,
        car_row_id: car_row_id || "",
        raw_text_preview: String((row as { raw_text?: unknown }).raw_text ?? "")
          .trim()
          .slice(0, 120),
        new_lines: newEntries,
        new_line_count: newEntries.length,
        needs_human_review: Boolean(payload.needs_human_review),
      });
    }

    return NextResponse.json({
      ok: true,
      total_new_lines: totalNew,
      messages,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
