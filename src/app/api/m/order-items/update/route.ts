import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { itemStatusForOrderItemsRow } from "@/lib/orders/order-item-status";
import { createOrderTaskUpdate } from "@/lib/orders/task-update-log";

const ORDER_TASKS_TABLE = "order_tasks";
const ORDER_ITEMS_TABLE = "order_items";

type Payload = {
  order_item_id?: string | null;
  order_task_id?: string | null;
  car_row_id?: string | null;
  car_id?: number | null;
  item_name?: string;
  item_status?: string;
  assignee_staff?: string | null;
  due_date?: string | null;
  note?: string | null;
  updated_by?: string | null;
};

function compactPatch(base: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/** PostgREST: "does not exist" หรือ "Could not find the 'x' column ... in the schema cache" */
function isMissingDbColumnError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    (m.includes("column") && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes("column") && m.includes("schema cache"))
  );
}

type OrderItemBeforeSnapshot = {
  id?: string;
  order_task_id?: string;
  label?: string;
  status?: string;
  assignee_staff?: string | null;
  due_date?: string | null;
  note?: string | null;
};

async function selectOrderItemSnapshot(
  supabase: ReturnType<typeof createServiceRoleClient>,
  orderItemId: string
): Promise<{ data: OrderItemBeforeSnapshot | null }> {
  const attempts = [
    "id,order_task_id,label,status,assignee_staff,due_date,note",
    "id,order_task_id,label,status,assignee_staff",
    "id,order_task_id,label,status",
  ] as const;
  for (const cols of attempts) {
    const res = await supabase.from(ORDER_ITEMS_TABLE).select(cols).eq("id", orderItemId).maybeSingle();
    if (!res.error) {
      return { data: (res.data ?? null) as OrderItemBeforeSnapshot | null };
    }
    if (!isMissingDbColumnError(res.error.message)) {
      throw new Error(res.error.message);
    }
  }
  return { data: null };
}

function isSameText(a: unknown, b: unknown): boolean {
  return String(a ?? "").trim() === String(b ?? "").trim();
}

function enrichOrderItemsDbError(message: string): string {
  if (message.includes("order_items_status_check")) {
    return `${message} · แก้ใน Supabase: รันไฟล์ supabase/patch-order-items-status-constraint-ฝาก.sql (SQL Editor) เพื่อให้ค่า status รวม 'ฝากสโตร์' และ 'ฝากกับรถ'`;
  }
  return message;
}

async function resolveTaskId(
  supabase: ReturnType<typeof createServiceRoleClient>,
  body: Payload
): Promise<string> {
  const incomingTaskId = String(body.order_task_id ?? "").trim();
  if (incomingTaskId) return incomingTaskId;
  const carRowId = String(body.car_row_id ?? "").trim() || null;
  const carId = body.car_id != null && Number.isFinite(Number(body.car_id)) ? Number(body.car_id) : null;

  let taskId = "";
  if (carRowId) {
    const { data } = await supabase
      .from(ORDER_TASKS_TABLE)
      .select("id")
      .eq("car_row_id", carRowId)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    taskId = String(data?.id ?? "").trim();
  }
  if (!taskId && carId != null) {
    const { data } = await supabase
      .from(ORDER_TASKS_TABLE)
      .select("id")
      .eq("car_id", carId)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    taskId = String(data?.id ?? "").trim();
  }

  if (!taskId) {
    const { data: created, error } = await supabase
      .from(ORDER_TASKS_TABLE)
      .insert({
        title: `Card update ${carRowId ?? carId ?? "-"}`,
        description: "Updated from /m/orders card",
        status: "requested",
        priority: "normal",
        requested_by_role: "sales",
        assigned_role: "store",
        car_row_id: carRowId,
        car_id: carId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    taskId = String(created?.id ?? "").trim();
  }
  if (!taskId) throw new Error("Could not resolve order_task id");
  return taskId;
}

export async function POST(request: Request) {
  let body: Payload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const itemName = String(body.item_name ?? "").trim();
  if (!itemName) return NextResponse.json({ error: "item_name required" }, { status: 400 });
  if (!String(body.order_task_id ?? "").trim() && !String(body.car_row_id ?? "").trim() && body.car_id == null) {
    return NextResponse.json({ error: "order_task_id or car_row_id or car_id required" }, { status: 400 });
  }

  try {
    const supabase = createServiceRoleClient();
    const taskId = await resolveTaskId(supabase, body);
    const orderItemId = String(body.order_item_id ?? "").trim();
    const desiredStatus = itemStatusForOrderItemsRow(body.item_status);
    const desiredAssignee = String(body.assignee_staff ?? "").trim() || null;
    const desiredDueDate = String(body.due_date ?? "").trim() || null;
    const desiredNote = String(body.note ?? "").trim() || null;
    const desiredUpdatedBy = String(body.updated_by ?? "").trim() || null;
    /** ไม่ใส่ updated_by บน order_items — คอลัมน์นี้มักไม่มีใน schema ทำให้ update ล้มแล้ว fallback ตัด due_date/note ออก */
    const patch = compactPatch({
      label: itemName,
      status: desiredStatus,
      assignee_staff: desiredAssignee,
      due_date: desiredDueDate,
      note: desiredNote,
      /** mirror ไปคอลัมน์เดิมของ phase1 เพื่อให้ refresh อ่านได้แม้ due_date/note ยังไม่มีใน DB */
      outside_eta_date: desiredDueDate,
      outside_note: desiredNote,
    });

    if (orderItemId) {
      const { data: beforeData } = await selectOrderItemSnapshot(supabase, orderItemId);
      const direct = await supabase.from(ORDER_ITEMS_TABLE).update(patch).eq("id", orderItemId).select("id,order_task_id,label").maybeSingle();
      if (direct.error) {
        if (isMissingDbColumnError(direct.error.message)) {
          const legacyOutsidePatch = compactPatch({
            label: patch.label,
            status: patch.status,
            assignee_staff: patch.assignee_staff,
            outside_eta_date: desiredDueDate,
            outside_note: desiredNote,
          });
          const retryLegacy = await supabase
            .from(ORDER_ITEMS_TABLE)
            .update(legacyOutsidePatch)
            .eq("id", orderItemId)
            .select("id,order_task_id,label")
            .maybeSingle();
          if (!retryLegacy.error) {
            return NextResponse.json({ ok: true, order_item_id: retryLegacy.data?.id ?? orderItemId, order_task_id: taskId, mode: "update-legacy-outside" });
          }
          const fallbackPatch = compactPatch({ label: patch.label, status: patch.status, assignee_staff: patch.assignee_staff });
          const retry = await supabase.from(ORDER_ITEMS_TABLE).update(fallbackPatch).eq("id", orderItemId).select("id,order_task_id,label").maybeSingle();
          if (retry.error) throw new Error(enrichOrderItemsDbError(retry.error.message));
          return NextResponse.json({ ok: true, order_item_id: retry.data?.id ?? orderItemId, order_task_id: taskId, mode: "update" });
        }
        throw new Error(enrichOrderItemsDbError(direct.error.message));
      }
      if (beforeData) {
        if (!isSameText(beforeData.label, itemName)) {
          await createOrderTaskUpdate(supabase, {
            order_task_id: taskId,
            order_item_id: orderItemId,
            action_type: "item_name_changed",
            old_value: beforeData.label ?? null,
            new_value: itemName,
            updated_by: desiredUpdatedBy,
          });
        }
        if (!isSameText(beforeData.assignee_staff, desiredAssignee)) {
          await createOrderTaskUpdate(supabase, {
            order_task_id: taskId,
            order_item_id: orderItemId,
            action_type: "assignee_changed",
            old_value: beforeData.assignee_staff ?? null,
            new_value: desiredAssignee,
            updated_by: desiredUpdatedBy,
          });
        }
        if (!isSameText(beforeData.status, desiredStatus)) {
          await createOrderTaskUpdate(supabase, {
            order_task_id: taskId,
            order_item_id: orderItemId,
            action_type: "status_changed",
            old_value: beforeData.status ?? null,
            new_value: desiredStatus,
            updated_by: desiredUpdatedBy,
          });
        }
        if (!isSameText(beforeData.due_date, desiredDueDate)) {
          await createOrderTaskUpdate(supabase, {
            order_task_id: taskId,
            order_item_id: orderItemId,
            action_type: "due_date_changed",
            old_value: beforeData.due_date ?? null,
            new_value: desiredDueDate,
            updated_by: desiredUpdatedBy,
          });
        }
        if (!isSameText(beforeData.note, desiredNote)) {
          await createOrderTaskUpdate(supabase, {
            order_task_id: taskId,
            order_item_id: orderItemId,
            action_type: "note_changed",
            old_value: beforeData.note ?? null,
            new_value: desiredNote,
            updated_by: desiredUpdatedBy,
          });
        }
      }
      return NextResponse.json({ ok: true, order_item_id: direct.data?.id ?? orderItemId, order_task_id: taskId, mode: "update" });
    }

    const existing = await supabase
      .from(ORDER_ITEMS_TABLE)
      .select("id,label")
      .eq("order_task_id", taskId)
      .eq("label", itemName)
      .limit(1)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    const existingId = String(existing.data?.id ?? "").trim();
    if (existingId) {
      const { data: beforeData } = await selectOrderItemSnapshot(supabase, existingId);
      const updated = await supabase.from(ORDER_ITEMS_TABLE).update(patch).eq("id", existingId).select("id,order_task_id,label").maybeSingle();
      if (updated.error) {
        if (isMissingDbColumnError(updated.error.message)) {
          const legacyOutsidePatch = compactPatch({
            label: patch.label,
            status: patch.status,
            assignee_staff: patch.assignee_staff,
            outside_eta_date: desiredDueDate,
            outside_note: desiredNote,
          });
          const retryLegacy = await supabase
            .from(ORDER_ITEMS_TABLE)
            .update(legacyOutsidePatch)
            .eq("id", existingId)
            .select("id,order_task_id,label")
            .maybeSingle();
          if (!retryLegacy.error) {
            return NextResponse.json({ ok: true, order_item_id: retryLegacy.data?.id ?? existingId, order_task_id: taskId, mode: "upsert-update-legacy-outside" });
          }
          const fallbackPatch = compactPatch({ label: patch.label, status: patch.status, assignee_staff: patch.assignee_staff });
          const retry = await supabase.from(ORDER_ITEMS_TABLE).update(fallbackPatch).eq("id", existingId).select("id,order_task_id,label").maybeSingle();
          if (retry.error) throw new Error(enrichOrderItemsDbError(retry.error.message));
          return NextResponse.json({ ok: true, order_item_id: retry.data?.id ?? existingId, order_task_id: taskId, mode: "upsert-update" });
        }
        throw new Error(enrichOrderItemsDbError(updated.error.message));
      }
      if (beforeData) {
        if (!isSameText(beforeData.label, itemName)) {
          await createOrderTaskUpdate(supabase, { order_task_id: taskId, order_item_id: existingId, action_type: "item_name_changed", old_value: beforeData.label ?? null, new_value: itemName, updated_by: desiredUpdatedBy });
        }
        if (!isSameText(beforeData.assignee_staff, desiredAssignee)) {
          await createOrderTaskUpdate(supabase, { order_task_id: taskId, order_item_id: existingId, action_type: "assignee_changed", old_value: beforeData.assignee_staff ?? null, new_value: desiredAssignee, updated_by: desiredUpdatedBy });
        }
        if (!isSameText(beforeData.status, desiredStatus)) {
          await createOrderTaskUpdate(supabase, { order_task_id: taskId, order_item_id: existingId, action_type: "status_changed", old_value: beforeData.status ?? null, new_value: desiredStatus, updated_by: desiredUpdatedBy });
        }
        if (!isSameText(beforeData.due_date, desiredDueDate)) {
          await createOrderTaskUpdate(supabase, { order_task_id: taskId, order_item_id: existingId, action_type: "due_date_changed", old_value: beforeData.due_date ?? null, new_value: desiredDueDate, updated_by: desiredUpdatedBy });
        }
        if (!isSameText(beforeData.note, desiredNote)) {
          await createOrderTaskUpdate(supabase, { order_task_id: taskId, order_item_id: existingId, action_type: "note_changed", old_value: beforeData.note ?? null, new_value: desiredNote, updated_by: desiredUpdatedBy });
        }
      }
      return NextResponse.json({ ok: true, order_item_id: updated.data?.id ?? existingId, order_task_id: taskId, mode: "upsert-update" });
    }

    const insertPatch = compactPatch({
      order_task_id: taskId,
      label: patch.label,
      qty: 1,
      status: patch.status,
      assignee_staff: patch.assignee_staff,
      due_date: desiredDueDate,
      note: desiredNote,
      outside_eta_date: desiredDueDate,
      outside_note: desiredNote,
    });
    const created = await supabase.from(ORDER_ITEMS_TABLE).insert(insertPatch).select("id,order_task_id,label").single();
    if (created.error) {
      if (isMissingDbColumnError(created.error.message)) {
        const insertLegacy = compactPatch({
          order_task_id: taskId,
          label: patch.label,
          qty: 1,
          status: patch.status,
          assignee_staff: patch.assignee_staff,
          outside_eta_date: desiredDueDate,
          outside_note: desiredNote,
        });
        const retryLegacy = await supabase.from(ORDER_ITEMS_TABLE).insert(insertLegacy).select("id,order_task_id,label").single();
        if (!retryLegacy.error) {
          return NextResponse.json({ ok: true, order_item_id: retryLegacy.data?.id ?? null, order_task_id: taskId, mode: "insert-legacy-outside" });
        }
        const fallbackInsert = {
          order_task_id: taskId,
          label: patch.label,
          qty: 1,
          status: patch.status,
          assignee_staff: patch.assignee_staff,
        };
        const retry = await supabase.from(ORDER_ITEMS_TABLE).insert(fallbackInsert).select("id,order_task_id,label").single();
        if (retry.error) throw new Error(enrichOrderItemsDbError(retry.error.message));
        return NextResponse.json({ ok: true, order_item_id: retry.data?.id ?? null, order_task_id: taskId, mode: "insert" });
      }
      throw new Error(enrichOrderItemsDbError(created.error.message));
    }
    if (created.data?.id) {
      await createOrderTaskUpdate(supabase, {
        order_task_id: taskId,
        order_item_id: String(created.data.id),
        action_type: "item_created",
        old_value: null,
        new_value: { label: itemName, status: desiredStatus, assignee_staff: desiredAssignee, due_date: desiredDueDate, note: desiredNote },
        updated_by: desiredUpdatedBy,
      });
    }
    return NextResponse.json({ ok: true, order_item_id: created.data?.id ?? null, order_task_id: taskId, mode: "insert" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
