import { NextResponse } from "next/server";
import { requireMutateRole } from "@/lib/auth/mutation-guard";
import { coalesceOrderItemNote } from "@/lib/data/orders";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { itemStatusForOrderItemsRow } from "@/lib/orders/order-item-status";
import { orderItemLabelContainsTamRoop } from "@/lib/orders/order-item-tam-roop-token";
import { deleteAllPhotosForOrderItem } from "@/lib/orders/order-item-photos-cleanup";
import type { CreateOrderTaskUpdateInput } from "@/lib/orders/task-update-log";
import { createOrderTaskUpdate, createOrderTaskUpdates } from "@/lib/orders/task-update-log";
import {
  hasThaiScript,
  translateItemNameToEnglish,
  translateOrderItemNoteToEnglish,
} from "@/lib/orders/item-name-translation";

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
  /** false = skip AI translation on this save (เร็วขึ้น — UI ภาษาไทยส่ง false ได้); true/undefined เดิม */
  translate?: boolean | null;
};

function compactPatch(base: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/** ส่งกลับให้ client merge nameEn ทันทีหลังบันทึก (โดยเฉพาะรายการใหม่ที่ยังไม่มี label_en ใน state) */
function jsonLabelEn(translated: string | null): { label_en?: string } {
  const s = translated != null ? String(translated).trim() : "";
  return s ? { label_en: s } : {};
}

/** ช่วย UI แสดงข้อความเมื่อชื่อมีไทยแต่ไม่ได้คำแปล */
function translationMeta(
  translated: string | null,
  itemName: string
): { translation_status?: "no_keys" | "failed" } {
  const en = String(translated ?? "").trim();
  if (en) return {};
  if (!hasThaiScript(String(itemName))) return {};
  const hasGroq = Boolean(String(process.env.GROQ_API_KEY ?? "").trim());
  const hasGemini = Boolean(String(process.env.GEMINI_API_KEY ?? "").trim());
  if (!hasGroq && !hasGemini) return { translation_status: "no_keys" };
  return { translation_status: "failed" };
}

function translationPayload(translated: string | null, itemName: string, opts?: { skipFailureMeta?: boolean }) {
  return {
    ...jsonLabelEn(translated),
    ...(opts?.skipFailureMeta ? {} : translationMeta(translated, itemName)),
  };
}

/** ส่งกลับให้ client merge noteEn — ล้างเมื่อไม่มีหมายเหตุ / ไม่มีไทย / แปลไม่ได้ */
function jsonNoteEnForResponse(translated: string | null, desiredNote: string | null): { note_en?: string | null } {
  if (!desiredNote) return { note_en: null };
  if (!hasThaiScript(desiredNote)) return { note_en: null };
  const s = translated != null ? String(translated).trim() : "";
  if (s) return { note_en: s };
  return {};
}

function noteTranslationMeta(
  translated: string | null,
  note: string | null
): { note_translation_status?: "no_keys" | "failed" } {
  const n = String(note ?? "").trim();
  if (!n || !hasThaiScript(n)) return {};
  const en = String(translated ?? "").trim();
  if (en) return {};
  const hasGroq = Boolean(String(process.env.GROQ_API_KEY ?? "").trim());
  const hasGemini = Boolean(String(process.env.GEMINI_API_KEY ?? "").trim());
  if (!hasGroq && !hasGemini) return { note_translation_status: "no_keys" };
  return { note_translation_status: "failed" };
}

function fullTranslationPayload(
  translatedLabelEn: string | null,
  itemName: string,
  translatedNoteEn: string | null,
  desiredNote: string | null,
  opts?: { labelChanged?: boolean; noteChanged?: boolean }
) {
  const labelChanged = opts?.labelChanged !== false;
  const noteChanged = opts?.noteChanged !== false;
  return {
    ...translationPayload(translatedLabelEn, itemName, { skipFailureMeta: !labelChanged }),
    ...jsonNoteEnForResponse(translatedNoteEn, desiredNote),
    ...(noteChanged ? noteTranslationMeta(translatedNoteEn, desiredNote) : {}),
  };
}

/** อัปเดต note_en — ถ้าแปลไทยไม่สำเร็จไม่ใส่คีย์ (คงค่าเดิมใน DB) */
function noteEnColumnPatch(desiredNote: string | null, translatedNoteEn: string | null): Record<string, unknown> {
  if (!desiredNote) return { note_en: null };
  if (!hasThaiScript(desiredNote)) return { note_en: null };
  const en = translatedNoteEn != null ? String(translatedNoteEn).trim() : "";
  if (en) return { note_en: en };
  return {};
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
  label_en?: string | null;
  status?: string;
  assignee_staff?: string | null;
  due_date?: string | null;
  note?: string | null;
  outside_note?: string | null;
  note_en?: string | null;
};

async function selectOrderItemSnapshot(
  supabase: ReturnType<typeof createServiceRoleClient>,
  orderItemId: string
): Promise<{ data: OrderItemBeforeSnapshot | null }> {
  const attempts = [
    "id,order_task_id,label,label_en,status,assignee_staff,due_date,note,note_en,outside_note",
    "id,order_task_id,label,label_en,status,assignee_staff,due_date,note,note_en",
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

/** ไม่กั้นการส่ง response — ประวัติ order_task_updates รันแยก (ลดความรู้สึก “บันทึกช้า”) */
function schedulePersistChangeLogs(
  persist: (pk: string) => Promise<void>,
  orderItemPk: string
) {
  void persist(orderItemPk).catch((e) =>
    console.warn("[order-items/update] persistChangeLogs:", e instanceof Error ? e.message : String(e))
  );
}

function orderItemsTranslateOnSaveFromEnv(): boolean {
  const v = String(process.env.ORDER_ITEMS_TRANSLATE_ON_SAVE ?? "true").trim().toLowerCase();
  return v !== "false" && v !== "0" && v !== "no";
}

/** รวม label_en (และล้างเมื่อแก้ชื่อไทยแต่ไม่แปล) */
function labelEnDbFragment(
  itemName: string,
  translatedLabelEn: string | null,
  opts: { translateRequested: boolean; labelChanged: boolean; beforeLabelEn?: string | null }
): Record<string, unknown> {
  const trimmed = translatedLabelEn != null ? String(translatedLabelEn).trim() : "";
  if (trimmed) return { label_en: trimmed };
  if (opts.translateRequested) return {};
  if (opts.labelChanged && hasThaiScript(itemName)) return { label_en: null };
  if (!opts.labelChanged && String(opts.beforeLabelEn ?? "").trim()) {
    return { label_en: String(opts.beforeLabelEn).trim() };
  }
  return {};
}

function englishColumnsPatch(
  itemName: string,
  desiredNote: string | null,
  beforeData: OrderItemBeforeSnapshot | null,
  translatedLabelEn: string | null,
  translatedNoteEn: string | null,
  translateRequested: boolean,
  labelChanged: boolean,
  noteChanged: boolean
): Record<string, unknown> {
  const noteBase = noteEnColumnPatch(desiredNote, translatedNoteEn);
  const forceClearNoteEn =
    !translateRequested &&
    Boolean(desiredNote && hasThaiScript(desiredNote) && noteChanged && !String(translatedNoteEn ?? "").trim());

  return {
    ...labelEnDbFragment(itemName, translatedLabelEn, {
      translateRequested,
      labelChanged,
      beforeLabelEn: beforeData?.label_en ?? null,
    }),
    ...noteBase,
    ...(forceClearNoteEn ? { note_en: null as string | null } : {}),
  };
}

/** เรียง log จาก state เก่า/ใหม่ — insert เป็นก้อนเดียว */
function buildOrderItemChangeLogInputs(params: {
  taskId: string;
  orderItemId: string;
  beforeData: OrderItemBeforeSnapshot | null;
  desired: {
    label: string;
    assignee: string | null;
    status: string;
    due: string | null;
    note: string | null;
  };
  updatedBy: string | null;
}) {
  const inputs: CreateOrderTaskUpdateInput[] = [];
  const b = params.beforeData;
  if (!b) return inputs;
  if (!isSameText(b.label, params.desired.label)) {
    inputs.push({
      order_task_id: params.taskId,
      order_item_id: params.orderItemId,
      action_type: "item_name_changed",
      old_value: b.label ?? null,
      new_value: params.desired.label,
      updated_by: params.updatedBy,
    });
  }
  if (!isSameText(b.assignee_staff, params.desired.assignee)) {
    inputs.push({
      order_task_id: params.taskId,
      order_item_id: params.orderItemId,
      action_type: "assignee_changed",
      old_value: b.assignee_staff ?? null,
      new_value: params.desired.assignee,
      updated_by: params.updatedBy,
    });
  }
  if (!isSameText(b.status, params.desired.status)) {
    inputs.push({
      order_task_id: params.taskId,
      order_item_id: params.orderItemId,
      action_type: "status_changed",
      old_value: b.status ?? null,
      new_value: params.desired.status,
      updated_by: params.updatedBy,
    });
  }
  if (!isSameText(b.due_date, params.desired.due)) {
    inputs.push({
      order_task_id: params.taskId,
      order_item_id: params.orderItemId,
      action_type: "due_date_changed",
      old_value: b.due_date ?? null,
      new_value: params.desired.due,
      updated_by: params.updatedBy,
    });
  }
  if (!isSameText(b.note, params.desired.note)) {
    inputs.push({
      order_task_id: params.taskId,
      order_item_id: params.orderItemId,
      action_type: "note_changed",
      old_value: b.note ?? null,
      new_value: params.desired.note,
      updated_by: params.updatedBy,
    });
  }
  return inputs;
}

/** เดิมมี 「ตามรูป」แต่ชื่อใหม่ไม่มี — ลบรูป item ทิ้ง */
async function maybeDeleteItemPhotosAfterTamRoopRemoved(
  supabase: ReturnType<typeof createServiceRoleClient>,
  orderItemId: string,
  beforeLabel: string | null | undefined,
  newLabel: string
): Promise<void> {
  if (!orderItemLabelContainsTamRoop(beforeLabel) || orderItemLabelContainsTamRoop(newLabel)) return;
  try {
    await deleteAllPhotosForOrderItem(supabase, orderItemId);
  } catch (e) {
    console.warn("[order-items/update] delete item photos:", e instanceof Error ? e.message : e);
  }
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
  const gate = await requireMutateRole();
  if (!gate.ok) return gate.response;

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

    let beforeData: OrderItemBeforeSnapshot | null = null;
    let existingIdFromLabel: string | null = null;
    if (orderItemId) {
      const snap = await selectOrderItemSnapshot(supabase, orderItemId);
      beforeData = snap.data;
    } else {
      const existing = await supabase
        .from(ORDER_ITEMS_TABLE)
        .select("id,label")
        .eq("order_task_id", taskId)
        .eq("label", itemName)
        .limit(1)
        .maybeSingle();
      if (existing.error) throw new Error(existing.error.message);
      existingIdFromLabel = String(existing.data?.id ?? "").trim() || null;
      if (existingIdFromLabel) {
        const snap = await selectOrderItemSnapshot(supabase, existingIdFromLabel);
        beforeData = snap.data;
      }
    }

    const labelChanged = !beforeData || !isSameText(beforeData.label, itemName);
    const beforeEffectiveNote = beforeData ? coalesceOrderItemNote(beforeData.note, beforeData.outside_note) : null;
    const noteChanged = !beforeData || !isSameText(beforeEffectiveNote, desiredNote);
    /** ไทยเหมือนเดิมแต่ยังไม่มีคำแปล (backfill / แปลล้มครั้งก่อน / คอลัมน์มาทีหลัง) — ต้องแปลอีกครั้ง */
    const labelNeedsEnglish =
      hasThaiScript(itemName) &&
      (labelChanged || !String(beforeData?.label_en ?? "").trim());
    const noteNeedsEnglish =
      Boolean(desiredNote && hasThaiScript(desiredNote)) &&
      (noteChanged || !String(beforeData?.note_en ?? "").trim());

    const translateRequested = orderItemsTranslateOnSaveFromEnv() && body.translate !== false;

    /** ภาษาไทย (translate=false / env ปิด) = ข้าม AI — ประหยัดเวลา; EN UI หรือ translate=true = เรียก API แปลเมื่อขาดข้อความ EN */
    let translatedLabelEn: string | null;
    let translatedNoteEn: string | null;

    if (translateRequested) {
      const [tl, tn] = await Promise.all([
        labelNeedsEnglish
          ? translateItemNameToEnglish(itemName)
          : Promise.resolve<string | null>(String(beforeData?.label_en ?? "").trim() || null),
        (async (): Promise<string | null> => {
          if (!desiredNote || !hasThaiScript(desiredNote)) return null;
          if (noteNeedsEnglish) return translateOrderItemNoteToEnglish(desiredNote);
          return String(beforeData?.note_en ?? "").trim() || null;
        })(),
      ]);
      translatedLabelEn = tl;
      translatedNoteEn = tn;
    } else {
      translatedLabelEn = labelChanged ? null : String(beforeData?.label_en ?? "").trim() || null;
      if (!desiredNote || !hasThaiScript(desiredNote)) translatedNoteEn = null;
      else if (noteChanged) translatedNoteEn = null;
      else translatedNoteEn = String(beforeData?.note_en ?? "").trim() || null;
    }

    const translationOpts = {
      labelChanged: translateRequested && labelNeedsEnglish,
      noteChanged: translateRequested && noteNeedsEnglish,
    };

    const desiredUpdatedBy = String(body.updated_by ?? "").trim() || null;

    async function persistChangeLogs(orderItemPk: string) {
      const rows = buildOrderItemChangeLogInputs({
        taskId,
        orderItemId: orderItemPk,
        beforeData,
        desired: {
          label: itemName,
          assignee: desiredAssignee,
          status: desiredStatus,
          due: desiredDueDate,
          note: desiredNote,
        },
        updatedBy: desiredUpdatedBy,
      });
      if (!rows.length) return;
      const r = await createOrderTaskUpdates(supabase, rows);
      if (!r.ok && r.error) console.warn("[order-items/update] order_task_updates batch:", r.error);
    }

    const enCols = englishColumnsPatch(
      itemName,
      desiredNote,
      beforeData,
      translatedLabelEn,
      translatedNoteEn,
      translateRequested,
      labelChanged,
      noteChanged
    );
    /** ไม่ใส่ updated_by บน order_items — คอลัมน์นี้มักไม่มีใน schema ทำให้ update ล้มแล้ว fallback ตัด due_date/note ออก */

    if (orderItemId) {
      const statusRel = beforeData ? !isSameText(beforeData.status, desiredStatus) : false;
      const statusChangedAtIso = statusRel ? new Date().toISOString() : null;
      const patch = compactPatch({
        label: itemName,
        ...enCols,
        status: desiredStatus,
        assignee_staff: desiredAssignee,
        due_date: desiredDueDate,
        note: desiredNote,
        outside_eta_date: desiredDueDate,
        outside_note: desiredNote,
        ...(statusChangedAtIso ? { status_changed_at: statusChangedAtIso } : {}),
      });
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
            schedulePersistChangeLogs(persistChangeLogs, orderItemId);
            await maybeDeleteItemPhotosAfterTamRoopRemoved(supabase, orderItemId, beforeData?.label, itemName);
            return NextResponse.json({
              ok: true,
              order_item_id: retryLegacy.data?.id ?? orderItemId,
              order_task_id: taskId,
              mode: "update-legacy-outside",
              ...fullTranslationPayload(translatedLabelEn, itemName, translatedNoteEn, desiredNote, translationOpts),
            });
          }
          const fallbackPatch = compactPatch({ label: patch.label, status: patch.status, assignee_staff: patch.assignee_staff });
          const retry = await supabase.from(ORDER_ITEMS_TABLE).update(fallbackPatch).eq("id", orderItemId).select("id,order_task_id,label").maybeSingle();
          if (retry.error) throw new Error(enrichOrderItemsDbError(retry.error.message));
          schedulePersistChangeLogs(persistChangeLogs, orderItemId);
          await maybeDeleteItemPhotosAfterTamRoopRemoved(supabase, orderItemId, beforeData?.label, itemName);
          return NextResponse.json({
            ok: true,
            order_item_id: retry.data?.id ?? orderItemId,
            order_task_id: taskId,
            mode: "update",
            ...fullTranslationPayload(translatedLabelEn, itemName, translatedNoteEn, desiredNote, translationOpts),
          });
        }
        throw new Error(enrichOrderItemsDbError(direct.error.message));
      }
      schedulePersistChangeLogs(persistChangeLogs, orderItemId);
      await maybeDeleteItemPhotosAfterTamRoopRemoved(supabase, orderItemId, beforeData?.label, itemName);
      return NextResponse.json({
        ok: true,
        order_item_id: direct.data?.id ?? orderItemId,
        order_task_id: taskId,
        mode: "update",
        ...(statusChangedAtIso ? { status_changed_at: statusChangedAtIso } : {}),
        ...fullTranslationPayload(translatedLabelEn, itemName, translatedNoteEn, desiredNote, translationOpts),
      });
    }

    if (existingIdFromLabel) {
      const existingId = existingIdFromLabel;
      const statusRel = beforeData ? !isSameText(beforeData.status, desiredStatus) : false;
      const statusChangedAtIso = statusRel ? new Date().toISOString() : null;
      const patch = compactPatch({
        label: itemName,
        ...enCols,
        status: desiredStatus,
        assignee_staff: desiredAssignee,
        due_date: desiredDueDate,
        note: desiredNote,
        outside_eta_date: desiredDueDate,
        outside_note: desiredNote,
        ...(statusChangedAtIso ? { status_changed_at: statusChangedAtIso } : {}),
      });
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
            schedulePersistChangeLogs(persistChangeLogs, existingId);
            await maybeDeleteItemPhotosAfterTamRoopRemoved(supabase, existingId, beforeData?.label, itemName);
            return NextResponse.json({
              ok: true,
              order_item_id: retryLegacy.data?.id ?? existingId,
              order_task_id: taskId,
              mode: "upsert-update-legacy-outside",
              ...fullTranslationPayload(translatedLabelEn, itemName, translatedNoteEn, desiredNote, translationOpts),
            });
          }
          const fallbackPatch = compactPatch({ label: patch.label, status: patch.status, assignee_staff: patch.assignee_staff });
          const retry = await supabase.from(ORDER_ITEMS_TABLE).update(fallbackPatch).eq("id", existingId).select("id,order_task_id,label").maybeSingle();
          if (retry.error) throw new Error(enrichOrderItemsDbError(retry.error.message));
          schedulePersistChangeLogs(persistChangeLogs, existingId);
          await maybeDeleteItemPhotosAfterTamRoopRemoved(supabase, existingId, beforeData?.label, itemName);
          return NextResponse.json({
            ok: true,
            order_item_id: retry.data?.id ?? existingId,
            order_task_id: taskId,
            mode: "upsert-update",
            ...fullTranslationPayload(translatedLabelEn, itemName, translatedNoteEn, desiredNote, translationOpts),
          });
        }
        throw new Error(enrichOrderItemsDbError(updated.error.message));
      }
      schedulePersistChangeLogs(persistChangeLogs, existingId);
      await maybeDeleteItemPhotosAfterTamRoopRemoved(supabase, existingId, beforeData?.label, itemName);
      return NextResponse.json({
        ok: true,
        order_item_id: updated.data?.id ?? existingId,
        order_task_id: taskId,
        mode: "upsert-update",
        ...(statusChangedAtIso ? { status_changed_at: statusChangedAtIso } : {}),
        ...fullTranslationPayload(translatedLabelEn, itemName, translatedNoteEn, desiredNote, translationOpts),
      });
    }

    const insertStatusChangedAtIso = new Date().toISOString();
    const insertPatch = compactPatch({
      order_task_id: taskId,
      label: itemName,
      ...enCols,
      qty: 1,
      status: desiredStatus,
      assignee_staff: desiredAssignee,
      due_date: desiredDueDate,
      note: desiredNote,
      outside_eta_date: desiredDueDate,
      outside_note: desiredNote,
      status_changed_at: insertStatusChangedAtIso,
    });
    const created = await supabase.from(ORDER_ITEMS_TABLE).insert(insertPatch).select("id,order_task_id,label").single();
    if (created.error) {
      if (isMissingDbColumnError(created.error.message)) {
        const insertLegacy = compactPatch({
          order_task_id: taskId,
          label: itemName,
          qty: 1,
          status: desiredStatus,
          assignee_staff: desiredAssignee,
          outside_eta_date: desiredDueDate,
          outside_note: desiredNote,
        });
        const retryLegacy = await supabase.from(ORDER_ITEMS_TABLE).insert(insertLegacy).select("id,order_task_id,label").single();
        if (!retryLegacy.error) {
          return NextResponse.json({
            ok: true,
            order_item_id: retryLegacy.data?.id ?? null,
            order_task_id: taskId,
            mode: "insert-legacy-outside",
            ...fullTranslationPayload(translatedLabelEn, itemName, translatedNoteEn, desiredNote, translationOpts),
          });
        }
        const fallbackInsert = {
          order_task_id: taskId,
          label: itemName,
          qty: 1,
          status: desiredStatus,
          assignee_staff: desiredAssignee,
        };
        const retry = await supabase.from(ORDER_ITEMS_TABLE).insert(fallbackInsert).select("id,order_task_id,label").single();
        if (retry.error) throw new Error(enrichOrderItemsDbError(retry.error.message));
        return NextResponse.json({
          ok: true,
          order_item_id: retry.data?.id ?? null,
          order_task_id: taskId,
          mode: "insert",
          ...fullTranslationPayload(translatedLabelEn, itemName, translatedNoteEn, desiredNote, translationOpts),
        });
      }
      throw new Error(enrichOrderItemsDbError(created.error.message));
    }
    if (created.data?.id) {
      void createOrderTaskUpdate(supabase, {
        order_task_id: taskId,
        order_item_id: String(created.data.id),
        action_type: "item_created",
        old_value: null,
        new_value: { label: itemName, status: desiredStatus, assignee_staff: desiredAssignee, due_date: desiredDueDate, note: desiredNote },
        updated_by: desiredUpdatedBy,
      })
        .then((r) => {
          if (!r.ok && r.error) console.warn("[order-items/update] item_created log:", r.error);
        })
        .catch((e) => console.warn("[order-items/update] item_created log:", e instanceof Error ? e.message : e));
    }
    return NextResponse.json({
      ok: true,
      order_item_id: created.data?.id ?? null,
      order_task_id: taskId,
      mode: "insert",
      status_changed_at: insertStatusChangedAtIso,
      ...fullTranslationPayload(translatedLabelEn, itemName, translatedNoteEn, desiredNote, translationOpts),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
