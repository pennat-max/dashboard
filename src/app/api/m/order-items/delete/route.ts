import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createOrderTaskUpdate } from "@/lib/orders/task-update-log";

const ORDER_ITEMS_TABLE = "order_items";
const ORDER_TASKS_TABLE = "order_tasks";

type Body = {
  order_item_id?: string | null;
  order_task_id?: string | null;
  car_row_id?: string | null;
  car_id?: number | null;
  updated_by?: string | null;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orderItemId = String(body.order_item_id ?? "").trim();
  if (!orderItemId) return NextResponse.json({ error: "order_item_id required" }, { status: 400 });

  try {
    const supabase = createServiceRoleClient();
    const { data: item, error: itemErr } = await supabase
      .from(ORDER_ITEMS_TABLE)
      .select("id,order_task_id,label")
      .eq("id", orderItemId)
      .maybeSingle();
    if (itemErr) throw new Error(itemErr.message);
    if (!item) return NextResponse.json({ error: "Order item not found" }, { status: 404 });

    const itemTaskId = String(item.order_task_id ?? "").trim();
    if (!itemTaskId) return NextResponse.json({ error: "Invalid order item" }, { status: 400 });

    const { data: task, error: taskErr } = await supabase
      .from(ORDER_TASKS_TABLE)
      .select("id,car_row_id,car_id")
      .eq("id", itemTaskId)
      .maybeSingle();
    if (taskErr) throw new Error(taskErr.message);
    if (!task) return NextResponse.json({ error: "Order task not found" }, { status: 404 });

    const bodyTaskId = String(body.order_task_id ?? "").trim();
    const carRowId = String(body.car_row_id ?? "").trim();
    const carId = body.car_id != null && Number.isFinite(Number(body.car_id)) ? Number(body.car_id) : null;
    const taskCarRow = String(task.car_row_id ?? "").trim();
    const taskCarId = task.car_id != null && Number.isFinite(Number(task.car_id)) ? Number(task.car_id) : null;

    const verified =
      (bodyTaskId && bodyTaskId === itemTaskId) ||
      (Boolean(carRowId) && Boolean(taskCarRow) && carRowId === taskCarRow) ||
      (carId != null && taskCarId != null && carId === taskCarId);

    if (!verified) {
      return NextResponse.json({ error: "car_row_id / car_id / order_task_id must match this item" }, { status: 403 });
    }

    const { error: delErr } = await supabase.from(ORDER_ITEMS_TABLE).delete().eq("id", orderItemId);
    if (delErr) throw new Error(delErr.message);

    const log = await createOrderTaskUpdate(supabase, {
      order_task_id: itemTaskId,
      order_item_id: orderItemId,
      action_type: "item_deleted",
      old_value: { label: item.label },
      new_value: null,
      updated_by: String(body.updated_by ?? "").trim() || null,
    });
    if (!log.ok && log.error) {
      console.warn("[order-items/delete] task log:", log.error);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
