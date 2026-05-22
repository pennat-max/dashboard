import { NextResponse } from "next/server";
import { requireMutateRole } from "@/lib/auth/mutation-guard";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { itemStatusForOrderItemsRow } from "@/lib/orders/order-item-status";
import { createOrderTaskUpdate } from "@/lib/orders/task-update-log";
import { buildItemNameEnglishMap } from "@/lib/orders/item-name-translation";

const ORDER_TASKS_TABLE = "order_tasks";
const ORDER_ITEMS_TABLE = "order_items";

type IncomingItem = { label: string; status?: string; assignee_staff?: string | null };

function isMissingDbColumnError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    (m.includes("column") && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes("column") && m.includes("schema cache"))
  );
}

export async function POST(request: Request) {
  const gate = await requireMutateRole();
  if (!gate.ok) return gate.response;

  let body: {
    car_row_id?: string | null;
    car_id?: number | null;
    full_plate?: string;
    car_label?: string;
    items?: IncomingItem[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const carRowId = String(body.car_row_id ?? "").trim() || null;
  const carId = body.car_id != null && Number.isFinite(Number(body.car_id)) ? Number(body.car_id) : null;
  const items = Array.isArray(body.items) ? body.items : [];

  if (!carRowId && carId == null) {
    return NextResponse.json({ error: "car_row_id or car_id required" }, { status: 400 });
  }
  const trimmed = items
    .map((row) => ({ ...row, label: String(row.label ?? "").trim() }))
    .filter((row) => row.label.length > 0);
  if (trimmed.length === 0) {
    return NextResponse.json({ error: "No items to save" }, { status: 400 });
  }

  try {
    const supabase = createServiceRoleClient();

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

    const fullPlate = String(body.full_plate ?? "").trim() || "-";
    const carLabel = String(body.car_label ?? "").trim() || "";

    if (!taskId) {
      const { data: created, error: createErr } = await supabase
        .from(ORDER_TASKS_TABLE)
        .insert({
          title: `LINE intake ${fullPlate}`,
          description: carLabel ? `Mobile intake · ${fullPlate} · ${carLabel}` : `Mobile intake · ${fullPlate}`,
          status: "requested",
          priority: "normal",
          requested_by_role: "sales",
          assigned_role: "store",
          car_row_id: carRowId,
          car_id: carId,
        })
        .select("id")
        .single();
      if (createErr) throw new Error(createErr.message);
      taskId = String(created?.id ?? "").trim();
    }
    if (!taskId) throw new Error("Could not resolve order_task id");

    const { data: existingRows, error: existingErr } = await supabase
      .from(ORDER_ITEMS_TABLE)
      .select("id,label")
      .eq("order_task_id", taskId);
    if (existingErr) throw new Error(existingErr.message);

    const existingByLabel = new Map<string, string>();
    for (const row of existingRows ?? []) {
      const label = String(row.label ?? "").trim();
      const id = String(row.id ?? "").trim();
      if (label && id) existingByLabel.set(label, id);
    }
    const itemNameEnMap = await buildItemNameEnglishMap(trimmed.map((x) => x.label));

    const savedRows: Array<{ order_item_id: string; label: string; label_en: string | null }> = [];

    for (const item of trimmed) {
      const dbStatus = itemStatusForOrderItemsRow(item.status);
      const assignee = String(item.assignee_staff ?? "").trim() || null;
      const labelEnResolved = String(itemNameEnMap[item.label] ?? "").trim() || null;
      const existingId = existingByLabel.get(item.label);
      if (existingId) {
        const before = await supabase
          .from(ORDER_ITEMS_TABLE)
          .select("label,status,assignee_staff")
          .eq("id", existingId)
          .maybeSingle();
        const prevStatus = String(before.data?.status ?? "").trim();
        const statusRel = prevStatus !== dbStatus;
        const withStatusChangedAt = {
          status: dbStatus,
          assignee_staff: assignee,
          label_en: labelEnResolved ?? undefined,
          ...(statusRel ? { status_changed_at: new Date().toISOString() } : {}),
        };
        let { error } = await supabase
          .from(ORDER_ITEMS_TABLE)
          .update(withStatusChangedAt)
          .eq("id", existingId);
        if (error && isMissingDbColumnError(error.message)) {
          const retry = await supabase
            .from(ORDER_ITEMS_TABLE)
            .update({ status: dbStatus, assignee_staff: assignee })
            .eq("id", existingId);
          error = retry.error;
        }
        if (error) throw new Error(error.message);
        await createOrderTaskUpdate(supabase, {
          order_task_id: taskId,
          order_item_id: existingId,
          action_type: "intake_saved",
          old_value: before.data ?? null,
          new_value: { label: item.label, status: dbStatus, assignee_staff: assignee, mode: "updated_duplicate" },
          note: "LINE intake update existing label",
          updated_by: "line-intake",
          role: "sales",
        });
        savedRows.push({ order_item_id: existingId, label: item.label, label_en: labelEnResolved });
      } else {
        const inserted = await supabase.from(ORDER_ITEMS_TABLE).insert({
          order_task_id: taskId,
          label: item.label,
          label_en: labelEnResolved ?? undefined,
          qty: 1,
          status: dbStatus,
          assignee_staff: assignee,
          status_changed_at: new Date().toISOString(),
        }).select("id").single();
        if (inserted.error) {
          if (!isMissingDbColumnError(inserted.error.message)) throw new Error(inserted.error.message);
          const retry = await supabase.from(ORDER_ITEMS_TABLE).insert({
            order_task_id: taskId,
            label: item.label,
            qty: 1,
            status: dbStatus,
            assignee_staff: assignee,
          }).select("id").single();
          if (retry.error) throw new Error(retry.error.message);
          await createOrderTaskUpdate(supabase, {
            order_task_id: taskId,
            order_item_id: String(retry.data?.id ?? ""),
            action_type: "intake_saved",
            old_value: null,
            new_value: { label: item.label, status: dbStatus, assignee_staff: assignee, mode: "created" },
            note: "LINE intake insert new item",
            updated_by: "line-intake",
            role: "sales",
          });
          savedRows.push({
            order_item_id: String(retry.data?.id ?? ""),
            label: item.label,
            label_en: labelEnResolved,
          });
          continue;
        }
        await createOrderTaskUpdate(supabase, {
          order_task_id: taskId,
          order_item_id: String(inserted.data?.id ?? ""),
          action_type: "intake_saved",
          old_value: null,
          new_value: { label: item.label, status: dbStatus, assignee_staff: assignee, mode: "created" },
          note: "LINE intake insert new item",
          updated_by: "line-intake",
          role: "sales",
        });
        savedRows.push({
          order_item_id: String(inserted.data?.id ?? ""),
          label: item.label,
          label_en: labelEnResolved,
        });
      }
    }

    return NextResponse.json({ ok: true, order_task_id: taskId, saved: savedRows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
