import type { SupabaseClient } from "@supabase/supabase-js";
import { LINE_INBOX_MESSAGES_TABLE } from "@/lib/line-inbox/line-inbox-messages";
import { LINE_INBOX_IMAGE_PLACEHOLDER } from "@/lib/line-inbox/line-image-placeholder";

/** ลูกค้ามักพิมพ์ว่าดูงานจากภาพที่จะส่งแยกข้อความถัดไป */
export function textSuggestsFollowupImage(rawText: string): boolean {
  const s = rawText.trim();
  if (!s) return false;
  if (s === LINE_INBOX_IMAGE_PLACEHOLDER) return false;
  return (
    /ตาม\s*รูป|ตาม\s*ภาพ|ตามรูป|ตามภาพ/.test(s) ||
    /ref\s*pic|see\s*photo|as\s+ph(?:oto)?/i.test(s) ||
    /ดูรูป|ดูภาพ|แนบรูป|ช่างดูรูป/i.test(s)
  );
}

const DEFAULT_FOLLOWUP_MS = 600_000; // 10 นาที

function followupWindowMs(): number {
  const raw = process.env.LINE_IMAGE_FOLLOWUP_WINDOW_MS?.trim();
  if (!raw) return DEFAULT_FOLLOWUP_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 30_000 && n <= 3_600_000 ? n : DEFAULT_FOLLOWUP_MS;
}

/**
 * หาแถวข้อความข้อความที่ยังไม่มีรูป แต่เนื้อหาบอกว่าจะส่งภาพตาม — บริบทเดียวกับรูปที่เพิ่งมาถึง
 */
export async function findInboxRowToAttachForwardImage(
  supabase: SupabaseClient,
  opts: {
    sourceType: "group" | "user" | "room";
    groupId: string | null;
    userId: string | null;
  }
): Promise<string | null> {
  const userId = String(opts.userId ?? "").trim();
  if (!userId) return null;

  const since = new Date(Date.now() - followupWindowMs()).toISOString();

  let q = supabase
    .from(LINE_INBOX_MESSAGES_TABLE)
    .select("id,raw_text,image_storage_path")
    .eq("workflow_status", "pending")
    .eq("analyze_status", "ok")
    .gte("received_at", since)
    .is("image_storage_path", null)
    .order("received_at", { ascending: false })
    .limit(12);

  if (opts.sourceType === "group") {
    const gid = String(opts.groupId ?? "").trim();
    if (!gid) return null;
    q = q.eq("source_type", "group").eq("group_id", gid).eq("user_id", userId);
  } else {
    q = q.eq("source_type", opts.sourceType).eq("user_id", userId);
  }

  const { data, error } = await q;
  if (error) {
    console.warn("[line-inbox] find merge target:", error.message);
    return null;
  }
  for (const row of data ?? []) {
    const raw = String((row as { raw_text?: unknown }).raw_text ?? "");
    if (textSuggestsFollowupImage(raw)) {
      return String((row as { id?: unknown }).id ?? "").trim() || null;
    }
  }
  return null;
}
