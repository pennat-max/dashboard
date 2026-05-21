import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExistingOrderItemRow } from "./types";

const ORDER_TASKS_TABLE = "order_tasks";
const ORDER_ITEMS_TABLE = "order_items";

const ORDER_ITEMS_SELECT_FULL =
  "id,order_task_id,label,status,assignee_staff,note,due_date,updated_at";
const ORDER_ITEMS_SELECT_MINIMAL = "id,order_task_id,label,status";

function isMissingDbColumnError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    (m.includes("column") && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes("column") && m.includes("schema cache"))
  );
}

function normalizeExistingOrderItem(row: unknown): ExistingOrderItemRow | null {
  const r = row as {
    id?: unknown;
    order_task_id?: unknown;
    label?: unknown;
    status?: unknown;
    assignee_staff?: unknown;
    note?: unknown;
    due_date?: unknown;
    updated_at?: unknown;
  };
  const id = String(r.id ?? "").trim();
  if (!id) return null;
  return {
    id,
    order_task_id: String(r.order_task_id ?? "").trim() || undefined,
    label: String(r.label ?? "").trim(),
    status: String(r.status ?? "").trim(),
    assignee_staff: String(r.assignee_staff ?? "").trim() || undefined,
    note: String(r.note ?? "").trim() || undefined,
    due_date: String(r.due_date ?? "").trim() || undefined,
    updated_at: String(r.updated_at ?? "").trim() || undefined,
  };
}

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
  let rows: unknown[] = [];
  const full = await supabase
    .from(ORDER_ITEMS_TABLE)
    .select(ORDER_ITEMS_SELECT_FULL)
    .eq("order_task_id", taskId);

  if (full.error) {
    if (!isMissingDbColumnError(full.error.message)) throw new Error(full.error.message);
    const retry = await supabase
      .from(ORDER_ITEMS_TABLE)
      .select(ORDER_ITEMS_SELECT_MINIMAL)
      .eq("order_task_id", taskId);
    if (retry.error) throw new Error(retry.error.message);
    rows = retry.data ?? [];
  } else {
    rows = full.data ?? [];
  }

  const out: ExistingOrderItemRow[] = [];
  for (const row of rows) {
    const item = normalizeExistingOrderItem(row);
    if (item) out.push(item);
  }
  return out;
}
