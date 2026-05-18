import type { createServiceRoleClient } from "@/lib/supabase/service-role";

const TABLE = "order_tracking_photos";
const BUCKET = "order-tracking-photos";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

function isMissingTableError(message: string): boolean {
  return (
    (message.includes("order_tracking_photos") && message.includes("schema cache")) ||
    message.includes("does not exist") ||
    message.includes("42P01")
  );
}

/** ลบรูปทั้งหมดที่ผูกกับ order_item (target_type = item) — ลบทั้ง storage และแถว */
export async function deleteAllPhotosForOrderItem(supabase: ServiceClient, orderItemId: string): Promise<void> {
  const id = String(orderItemId ?? "").trim();
  if (!id) return;
  const { data: rows, error } = await supabase
    .from(TABLE)
    .select("id,storage_path")
    .eq("target_type", "item")
    .eq("order_item_id", id);
  if (error) {
    if (isMissingTableError(error.message)) return;
    throw new Error(error.message);
  }
  if (!rows?.length) return;
  const paths = rows.map((r) => String((r as { storage_path?: string }).storage_path ?? "")).filter(Boolean);
  if (paths.length) {
    const rm = await supabase.storage.from(BUCKET).remove(paths);
    if (rm.error) throw new Error(rm.error.message);
  }
  const del = await supabase.from(TABLE).delete().eq("target_type", "item").eq("order_item_id", id);
  if (del.error) {
    if (isMissingTableError(del.error.message)) return;
    throw new Error(del.error.message);
  }
}
