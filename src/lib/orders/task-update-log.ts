import type { SupabaseClient } from "@supabase/supabase-js";

const ORDER_UPDATES_TABLE = "order_task_updates";

export type OrderTaskActionType =
  | "item_created"
  | "item_deleted"
  | "item_name_changed"
  | "assignee_changed"
  | "status_changed"
  | "due_date_changed"
  | "note_changed"
  | "intake_saved";

type CreateOrderTaskUpdateInput = {
  order_task_id: string;
  order_item_id?: string | null;
  action_type: OrderTaskActionType;
  old_value?: unknown;
  new_value?: unknown;
  note?: string | null;
  updated_by?: string | null;
  role?: "sales" | "store" | "garage";
};

function valueText(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "string") return value || "-";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function makeMessage(input: CreateOrderTaskUpdateInput): string {
  const parts = [
    `[${input.action_type}]`,
    input.order_item_id ? `item=${input.order_item_id}` : "",
    `old=${valueText(input.old_value)}`,
    `new=${valueText(input.new_value)}`,
    input.note ? `note=${input.note}` : "",
    input.updated_by ? `by=${input.updated_by}` : "",
  ].filter(Boolean);
  return parts.join(" | ");
}

export async function createOrderTaskUpdate(
  supabase: SupabaseClient,
  input: CreateOrderTaskUpdateInput
): Promise<{ ok: boolean; error: string | null }> {
  const orderTaskId = String(input.order_task_id ?? "").trim();
  if (!orderTaskId) return { ok: false, error: "order_task_id required for update log" };
  const role = input.role ?? "store";
  const message = makeMessage(input);
  const { error } = await supabase.from(ORDER_UPDATES_TABLE).insert({
    order_task_id: orderTaskId,
    role,
    message,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null };
}
