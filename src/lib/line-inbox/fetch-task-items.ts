import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExistingOrderItemRow } from "./types";

const ORDER_TASKS_TABLE = "order_tasks";
const ORDER_ITEMS_TABLE = "order_items";

const ORDER_ITEMS_SELECT =
  "id,order_task_id,label,status";

export async function fetchOrderTaskIdForCar(
  supabase: SupabaseClient,
  car_row_id: string | null,
  car_id: number | null
): Promise<string | null> {
  let taskId = "";
  if (car_row_id) {
    const { data } = await supabase
      .from(ORDER_TASKS_TABLE)
      .select("id")
      .eq("car_row_id", car_row_id)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    taskId = String(data?.id ?? "").trim();
  }
  if (!taskId && car_id != null) {
    const { data } = await supabase
      .from(ORDER_TASKS_TABLE)
      .select("id")
      .eq("car_id", car_id)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    taskId = String(data?.id ?? "").trim();
  }
  return taskId || null;
}

export async function fetchOrderItemsForTask(
  supabase: SupabaseClient,
  taskId: string
): Promise<ExistingOrderItemRow[]> {
  const { data, error } = await supabase
    .from(ORDER_ITEMS_TABLE)
    .select(ORDER_ITEMS_SELECT)
    .eq("order_task_id", taskId);

  if (error) {
    throw new Error(error.message);
  }

  const out: ExistingOrderItemRow[] = [];
  for (const row of data ?? []) {
    const r = row as { id?: unknown; label?: unknown; status?: unknown };
    const id = String(r.id ?? "").trim();
    if (!id) continue;
    out.push({
      id,
      label: String(r.label ?? "").trim(),
      status: String(r.status ?? "").trim(),
    });
  }
  return out;
}
