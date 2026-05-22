import type { SupabaseClient } from "@supabase/supabase-js";

/** Override via env if table name differs */
export const LINE_INBOX_MESSAGES_TABLE =
  process.env.LINE_INBOX_MESSAGES_TABLE?.trim() || "line_inbox_messages";

const ORDER_TRACKING_PHOTOS_BUCKET = "order-tracking-photos";

export type LineInboxMessageRow = {
  id: string;
  line_message_id: string;
  workflow_status: string;
  analyze_status: string;
  raw_text: string;
};

export async function insertLineInboxMessage(
  supabase: SupabaseClient,
  row: {
    line_message_id: string;
    destination?: string | null;
    source_type: "group" | "user" | "room";
    group_id?: string | null;
    user_id?: string | null;
    raw_text: string;
    reply_token?: string | null;
    received_at?: string;
  }
): Promise<{ id: string | null; duplicate: boolean }> {
  const { data, error } = await supabase
    .from(LINE_INBOX_MESSAGES_TABLE)
    .insert({
      line_message_id: row.line_message_id,
      destination: row.destination ?? null,
      source_type: row.source_type,
      group_id: row.group_id ?? null,
      user_id: row.user_id ?? null,
      raw_text: row.raw_text,
      reply_token: row.reply_token ?? null,
      received_at: row.received_at ?? new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error) {
    const code = (error as { code?: string }).code;
    const msg = error.message.toLowerCase();
    if (code === "23505" || msg.includes("duplicate") || msg.includes("unique")) {
      return { id: null, duplicate: true };
    }
    throw new Error(error.message);
  }

  const id = data?.id != null ? String(data.id).trim() : null;
  return { id, duplicate: false };
}

export async function updateLineInboxMessageAnalyze(
  supabase: SupabaseClient,
  id: string,
  patch: {
    analyze_status: "ok" | "error";
    analyze_error?: string | null;
    analyze_payload?: unknown;
    needs_human_review?: boolean | null;
    car_row_id?: string | null;
  }
): Promise<void> {
  const { error } = await supabase
    .from(LINE_INBOX_MESSAGES_TABLE)
    .update({
      analyze_status: patch.analyze_status,
      analyze_error: patch.analyze_error ?? null,
      analyze_payload: patch.analyze_payload ?? null,
      needs_human_review: patch.needs_human_review ?? null,
      car_row_id: patch.car_row_id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function updateLineInboxMessageImage(
  supabase: SupabaseClient,
  id: string,
  patch: { image_storage_path: string; image_mime_type: string | null }
): Promise<void> {
  const { error } = await supabase
    .from(LINE_INBOX_MESSAGES_TABLE)
    .update({
      image_storage_path: patch.image_storage_path,
      image_mime_type: patch.image_mime_type ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

/** ลบแถวคิวหลังบันทึกงานสำเร็จ — ลบไฟล์รูปใน Storage ด้วย (ถ้ามี) */
export async function deleteLineInboxMessageById(supabase: SupabaseClient, id: string): Promise<void> {
  const { data: row, error: selErr } = await supabase
    .from(LINE_INBOX_MESSAGES_TABLE)
    .select("image_storage_path")
    .eq("id", id)
    .maybeSingle();

  if (selErr) throw new Error(selErr.message);

  const path = String((row as { image_storage_path?: unknown })?.image_storage_path ?? "").trim();
  if (path) {
    const rm = await supabase.storage.from(ORDER_TRACKING_PHOTOS_BUCKET).remove([path]);
    if (rm.error) {
      console.warn("[line-inbox] storage remove:", rm.error.message, path);
    }
  }

  const { error } = await supabase.from(LINE_INBOX_MESSAGES_TABLE).delete().eq("id", id);

  if (error) throw new Error(error.message);
}
