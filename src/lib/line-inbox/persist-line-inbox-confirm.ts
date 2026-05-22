import type { SupabaseClient } from "@supabase/supabase-js";
import { buildItemNameEnglishMap } from "@/lib/orders/item-name-translation";
import { itemStatusForOrderItemsRow } from "@/lib/orders/order-item-status";
import { createOrderTaskUpdate } from "@/lib/orders/task-update-log";
import { fetchOrderTaskIdForCar } from "@/lib/line-inbox/fetch-task-items";

const ORDER_TASKS_TABLE = "order_tasks";
const ORDER_ITEMS_TABLE = "order_items";

export type PersistConfirmRow = {
  action: "skip" | "create" | "merge";
  order_item_id?: string | null;
  item_name: string;
  item_status?: string | null;
  note?: string | null;
};

function isMissingDbColumnError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    (m.includes("column") && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes("column") && m.includes("schema cache"))
  );
}

/**
 * Persist create/merge confirmations to order_tasks / order_items + audit (shared by REST confirm + queue save).
 */
export async function persistLineInboxConfirmations(
  supabase: SupabaseClient,
  input: {
    car_row_id: string;
    car_id: number | null;
    actionable: PersistConfirmRow[];
    line_inbox_msg_ref_for_audit?: string;
  }
): Promise<{
  order_task_id: string;
  saved: Array<{ order_item_id: string; label: string; action: string }>;
}> {
  const car_row_id = String(input.car_row_id ?? "").trim();
  const car_id = input.car_id;
  const lineInboxMsgRef = input.line_inbox_msg_ref_for_audit?.trim() ?? "";
  const actionable = input.actionable.filter((c) => c.action !== "skip");

  if (actionable.length === 0) {
    return { order_task_id: "", saved: [] };
  }

  if (!car_row_id && car_id == null) {
    throw new Error("car_row_id or car_id required");
  }

  let taskId = await fetchOrderTaskIdForCar(supabase, car_row_id || null, car_id);
  const fullPlate = "-";
  const carLabel = "";

  if (!taskId) {
    const { data: created, error: createErr } = await supabase
      .from(ORDER_TASKS_TABLE)
      .insert({
        title: `LINE inbox confirm ${fullPlate}`,
        description: carLabel ? `LINE inbox · ${fullPlate} · ${carLabel}` : `LINE inbox · ${fullPlate}`,
        status: "requested",
        priority: "normal",
        requested_by_role: "sales",
        assigned_role: "store",
        car_row_id: car_row_id || null,
        car_id: car_id,
      })
      .select("id")
      .single();
    if (createErr) throw new Error(createErr.message);
    taskId = String(created?.id ?? "").trim();
  }
  if (!taskId) throw new Error("Could not resolve order_task id");

  const labelsForEn = actionable.filter((c) => c.action === "create").map((c) => c.item_name);
  const itemNameEnMap =
    labelsForEn.length > 0 ? await buildItemNameEnglishMap(labelsForEn) : {};

  const saved: Array<{ order_item_id: string; label: string; action: string }> = [];

  for (const c of actionable) {
    if (c.action === "create") {
      const dbStatus = itemStatusForOrderItemsRow(c.item_status || undefined);
      const labelEnResolved = String(itemNameEnMap[c.item_name] ?? "").trim() || null;
      const inserted = await supabase
        .from(ORDER_ITEMS_TABLE)
        .insert({
          order_task_id: taskId,
          label: c.item_name,
          label_en: labelEnResolved ?? undefined,
          qty: 1,
          status: dbStatus,
          status_changed_at: new Date().toISOString(),
          note: c.note || null,
        })
        .select("id")
        .single();
      if (inserted.error) {
        if (!isMissingDbColumnError(inserted.error.message)) throw new Error(inserted.error.message);
        const retry = await supabase
          .from(ORDER_ITEMS_TABLE)
          .insert({
            order_task_id: taskId,
            label: c.item_name,
            qty: 1,
            status: dbStatus,
          })
          .select("id")
          .single();
        if (retry.error) throw new Error(retry.error.message);
        const rid = String(retry.data?.id ?? "");
        await createOrderTaskUpdate(supabase, {
          order_task_id: taskId,
          order_item_id: rid,
          action_type: "intake_saved",
          old_value: null,
          new_value: {
            label: c.item_name,
            status: dbStatus,
            source: "line_inbox_confirm",
            line_inbox_message_id: lineInboxMsgRef || null,
          },
          note: "LINE inbox confirm · create",
          updated_by: "line-inbox",
          role: "sales",
        });
        saved.push({ order_item_id: rid, label: c.item_name, action: "create" });
        continue;
      }
      const id = String(inserted.data?.id ?? "");
      await createOrderTaskUpdate(supabase, {
        order_task_id: taskId,
        order_item_id: id,
        action_type: "intake_saved",
        old_value: null,
        new_value: {
          label: c.item_name,
          status: dbStatus,
          source: "line_inbox_confirm",
          line_inbox_message_id: lineInboxMsgRef || null,
        },
        note: "LINE inbox confirm · create",
        updated_by: "line-inbox",
        role: "sales",
      });
      saved.push({ order_item_id: id, label: c.item_name, action: "create" });
    } else if (c.action === "merge") {
      const oid = String(c.order_item_id ?? "").trim();
      const { data: before } = await supabase
        .from(ORDER_ITEMS_TABLE)
        .select("id,order_task_id,label,status")
        .eq("id", oid)
        .maybeSingle();
      if (!before || String(before.order_task_id ?? "").trim() !== taskId) {
        throw new Error(`order_item ${oid} not part of this car task`);
      }
      const dbStatus = itemStatusForOrderItemsRow(c.item_status || String(before.status ?? ""));
      const labelNext = c.item_name || String(before.label ?? "");
      const labelEnResolved =
        String((await buildItemNameEnglishMap([labelNext]))[labelNext] ?? "").trim() || null;

      const patch: Record<string, unknown> = {
        label: labelNext,
        status: dbStatus,
        status_changed_at: new Date().toISOString(),
      };
      if (c.note) patch.note = c.note;
      if (labelEnResolved) patch.label_en = labelEnResolved;

      let { error } = await supabase.from(ORDER_ITEMS_TABLE).update(patch).eq("id", oid);
      if (error && isMissingDbColumnError(error.message)) {
        const retry = await supabase
          .from(ORDER_ITEMS_TABLE)
          .update({ label: labelNext, status: dbStatus })
          .eq("id", oid);
        error = retry.error;
      }
      if (error) throw new Error(error.message);

      await createOrderTaskUpdate(supabase, {
        order_task_id: taskId,
        order_item_id: oid,
        action_type: "intake_saved",
        old_value: before,
        new_value: {
          label: labelNext,
          status: dbStatus,
          source: "line_inbox_confirm_merge",
          line_inbox_message_id: lineInboxMsgRef || null,
        },
        note: "LINE inbox confirm · merge",
        updated_by: "line-inbox",
        role: "sales",
      });
      saved.push({ order_item_id: oid, label: labelNext, action: "merge" });
    }
  }

  if (lineInboxMsgRef && saved.length > 0) {
    await createOrderTaskUpdate(supabase, {
      order_task_id: taskId,
      action_type: "intake_saved",
      old_value: null,
      new_value: {
        line_inbox_message_id: lineInboxMsgRef,
        status: "saved",
        saved_count: saved.length,
      },
      note: "LINE inbox message marked saved (logical)",
      updated_by: "line-inbox",
      role: "sales",
    });
  }

  return { order_task_id: taskId, saved };
}
