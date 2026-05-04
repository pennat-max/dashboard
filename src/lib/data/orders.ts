import type { SupabaseClient } from "@supabase/supabase-js";
import { createAnonClient } from "@/lib/supabase/anon";
import { carTitleLine } from "@/lib/car-fields";
import { matchesRole, normalizeOrderPriority, normalizeOrderRole, normalizeOrderStatus } from "@/lib/order-fields";
import type { Car } from "@/types/car";
import type { MobileOrderFilter, OrderItem, OrdersReadResult, OrderTask, OrderTaskUpdate, OrderTaskWithCar } from "@/types/order";

const ORDER_TASKS_TABLE = "order_tasks";
const ORDER_ITEMS_TABLE = "order_items";
const ORDER_UPDATES_TABLE = "order_task_updates";

/** ชื่อตาราง public สำหรับ Supabase Realtime บน client */
export const ORDER_ITEMS_TABLE_NAME = ORDER_ITEMS_TABLE;
export const ORDER_TASK_UPDATES_TABLE_NAME = ORDER_UPDATES_TABLE;
const ORDER_STORAGE_TABLE = "order_storage_items";
const CARS_TABLE = process.env.NEXT_PUBLIC_SUPABASE_CARS_TABLE ?? "cars";

export type OrderItemLite = {
  id?: string | null;
  order_task_id?: string | null;
  label: string;
  status: string;
  assignee_staff: string | null;
  /** วันที่ครบของรายการ (รวมจาก due_date หรือ outside_eta_date ตอนดึง) */
  due_date?: string | null;
  /** หมายเหตุรายการ (รวมจาก note หรือ outside_note ตอนดึง) */
  note?: string | null;
  outside_supplier: string | null;
  outside_eta_date: string | null;
  outside_price: number | null;
  /** วันเริ่มนับ 30 วัน (ฝากสโตร์): วันที่อัปเดตล่าสุดในระบบ ก่อน แล้วจึงวันที่สร้างแถว */
  clock_start_ymd?: string | null;
};

function trimStr(v: unknown): string {
  return String(v ?? "").trim();
}

/** แปลงค่าวันที่จาก DB (date / timestamptz string) เป็น yyyy-mm-dd */
function dateYmdOrNull(v: unknown): string | null {
  const s = trimStr(v);
  if (!s) return null;
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function coalesceDateYmd(primary: unknown, fallback: unknown): string | null {
  return dateYmdOrNull(primary) ?? dateYmdOrNull(fallback);
}

function coalesceText(primary: unknown, fallback: unknown): string | null {
  const a = trimStr(primary);
  if (a) return a;
  const b = trimStr(fallback);
  return b || null;
}

/** แปลง timestamptz / date จาก DB → yyyy-mm-dd ตามปฏิทินไทย (ใช้นับ 30 วัน ฝากสโตร์) */
function dateYmdBangkokFromDbTimestamp(v: unknown): string | null {
  const s = trimStr(v);
  if (!s) return null;
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00+07:00` : s);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

export type OrderStorageLite = {
  id: string | null;
  order_task_id: string | null;
  order_item_id: string | null;
  car_row_id: string | null;
  car_id: number | null;
  storage_name: string | null;
  item_name: string | null;
  storage_type: string | null;
  expire_date: string | null;
  status: string | null;
  note: string | null;
  updated_at: string | null;
};

export type OrderUpdateLite = {
  id: string | null;
  order_task_id: string | null;
  role: string | null;
  message: string | null;
  created_at: string | null;
};

function isMissingTableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("could not find the table") ||
    m.includes("relation") ||
    m.includes("not found in the schema cache")
  );
}

function collectCarRowIds(cars: Car[]): string[] {
  return Array.from(new Set(cars.map((c) => String(c.row_id ?? "").trim()).filter(Boolean)));
}

/**
 * ค่า id จาก cars สำหรับ .in("car_id", …) บน order_tasks / storage
 * เดิมกรองเฉพาะเลขล้วน — ถ้า id เป็นรูปแบบอื่นจะหา task ไม่เจอ รายการจะไม่ขึ้นการ์ด
 */
function collectCarIdsForInFilter(cars: Car[]): (string | number)[] {
  const out: (string | number)[] = [];
  for (const c of cars) {
    const id = c.id;
    if (id == null || id === "") continue;
    if (typeof id === "number" && Number.isFinite(id)) {
      out.push(id);
      continue;
    }
    const s = String(id).trim();
    if (!s) continue;
    if (/^\d+$/.test(s)) out.push(Number(s));
    else out.push(s);
  }
  return Array.from(new Set(out));
}

function mergeTaskCarKeys(map: Map<string, string[]>, taskId: string, keys: string[]) {
  const prev = map.get(taskId) ?? [];
  map.set(taskId, Array.from(new Set([...prev, ...keys])));
}

/**
 * คีย์ byCarKey ที่ใช้ใน toOrderFromCar ต้องตรงกับ `row:${car.row_id}` และ `id:${car.id}` ของรถคันนั้น
 * เปรียบเทียบ task กับรถในลิสต์แบบยืดหยุ่น (string / number) เพื่อไม่พลาดเมื่อ .in() บน DB ไม่ตรงชนิด
 */
function orderTaskKeysForCars(
  cars: Car[],
  t: { car_id?: unknown; car_row_id?: unknown }
): string[] {
  const keys: string[] = [];
  const tr = String(t.car_row_id ?? "").trim();
  const tc = t.car_id;
  for (const c of cars) {
    const cr = String(c.row_id ?? "").trim();
    let match = false;
    if (tr && cr && tr === cr) match = true;
    if (!match && tc != null && tc !== "" && c.id != null && c.id !== "") {
      if (String(c.id) === String(tc)) match = true;
      else {
        const na = Number(c.id);
        const nt = Number(tc);
        if (Number.isFinite(na) && Number.isFinite(nt) && na === nt) match = true;
      }
    }
    if (match) {
      if (cr) keys.push(`row:${cr}`);
      const idStr = String(c.id ?? "").trim();
      if (idStr) keys.push(`id:${idStr}`);
    }
  }
  return Array.from(new Set(keys));
}

const ORDER_TASK_SCAN_LIMIT = 25_000;

/**
 * โหลด order_tasks ล่าสุด แล้วกรองให้ตรงกับรถใน `cars` (ไม่พึ่ง .in กับ car_row_id/car_id อย่างเดียว)
 */
async function fetchMatchingOrderTasks(
  supabase: SupabaseClient,
  cars: Car[]
): Promise<{
  tasks: Array<{ id: string; car_id?: number | null; car_row_id?: string | null }>;
  error: string | null;
  tableReady: boolean;
}> {
  if (cars.length === 0) return { tasks: [], error: null, tableReady: true };

  let allTasksRaw: Array<{ id: string; car_id?: number | null; car_row_id?: string | null }> = [];
  const ordered = await supabase
    .from(ORDER_TASKS_TABLE)
    .select("id,car_id,car_row_id,updated_at")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(ORDER_TASK_SCAN_LIMIT);
  if (ordered.error && /updated_at/.test(ordered.error.message)) {
    const plain = await supabase.from(ORDER_TASKS_TABLE).select("id,car_id,car_row_id").limit(ORDER_TASK_SCAN_LIMIT);
    if (plain.error) {
      if (isMissingTableError(plain.error.message)) return { tasks: [], error: null, tableReady: false };
      return { tasks: [], error: plain.error.message, tableReady: true };
    }
    allTasksRaw = (plain.data ?? []) as Array<{ id: string; car_id?: number | null; car_row_id?: string | null }>;
  } else if (ordered.error) {
    if (isMissingTableError(ordered.error.message)) return { tasks: [], error: null, tableReady: false };
    return { tasks: [], error: ordered.error.message, tableReady: true };
  } else {
    allTasksRaw = (ordered.data ?? []) as Array<{ id: string; car_id?: number | null; car_row_id?: string | null }>;
  }

  const tasks = allTasksRaw.filter((t) => orderTaskKeysForCars(cars, t).length > 0);
  return { tasks, error: null, tableReady: true };
}

function asOrderTask(row: Record<string, unknown>): OrderTask {
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? row.request_title ?? "Untitled request"),
    description: String(row.description ?? row.request_note ?? ""),
    status: normalizeOrderStatus(row.status),
    priority: normalizeOrderPriority(row.priority),
    requested_by_role: normalizeOrderRole(row.requested_by_role ?? row.requester_role),
    assigned_role: normalizeOrderRole(row.assigned_role ?? row.owner_role),
    car_id: (row.car_id as number | string | null | undefined) ?? null,
    car_row_id: String(row.car_row_id ?? row.car_ref ?? "").trim() || null,
    due_date: String(row.due_date ?? "").trim() || null,
    created_at: String(row.created_at ?? "").trim() || null,
    updated_at: String(row.updated_at ?? "").trim() || null,
    line_thread_ref: String(row.line_thread_ref ?? "").trim() || null,
  };
}

function asOrderItem(row: Record<string, unknown>): OrderItem {
  const qtyNum = Number(row.qty ?? row.quantity ?? 1);
  return {
    id: String(row.id ?? ""),
    order_task_id: String(row.order_task_id ?? row.task_id ?? ""),
    label: String(row.label ?? row.item_name ?? "Item"),
    qty: Number.isFinite(qtyNum) ? qtyNum : 1,
    unit: String(row.unit ?? "").trim() || null,
    status: String(row.status ?? "requested"),
    created_at: String(row.created_at ?? "").trim() || null,
    updated_at: String(row.updated_at ?? "").trim() || null,
  };
}

function asOrderUpdate(row: Record<string, unknown>): OrderTaskUpdate {
  return {
    id: String(row.id ?? ""),
    order_task_id: String(row.order_task_id ?? row.task_id ?? ""),
    role: normalizeOrderRole(row.role),
    message: String(row.message ?? row.note ?? ""),
    created_at: String(row.created_at ?? "").trim() || null,
  };
}

function buildCarLabel(car: Car): string {
  return (car.spec ?? "").trim() || carTitleLine(car);
}

async function fetchCarsForTasks(tasks: OrderTask[]): Promise<Map<string, Car>> {
  const supabase = createAnonClient();
  const byKey = new Map<string, Car>();
  const rowIds = Array.from(new Set(tasks.map((t) => (t.car_row_id ?? "").trim()).filter(Boolean)));
  const carIds = Array.from(
    new Set(tasks.map((t) => String(t.car_id ?? "").trim()).filter((v) => /^\d+$/.test(v)).map((v) => Number(v)))
  );
  const selectCars = "id,row_id,spec,brand,model,model_year,color";

  if (rowIds.length > 0) {
    const { data } = await supabase.from(CARS_TABLE).select(selectCars).in("row_id", rowIds);
    for (const row of ((data ?? []) as Car[])) {
      const key = String(row.row_id ?? "").trim();
      if (key) byKey.set(`row:${key}`, row);
    }
  }
  if (carIds.length > 0) {
    const { data } = await supabase.from(CARS_TABLE).select(selectCars).in("id", carIds);
    for (const row of ((data ?? []) as Car[])) {
      const key = String(row.id ?? "").trim();
      if (key) byKey.set(`id:${key}`, row);
    }
  }

  return byKey;
}

function withCarInfo(tasks: OrderTask[], carsByKey: Map<string, Car>): OrderTaskWithCar[] {
  return tasks.map((task) => {
    const keyByRow = (task.car_row_id ?? "").trim();
    const keyById = String(task.car_id ?? "").trim();
    const car = (keyByRow ? carsByKey.get(`row:${keyByRow}`) : undefined) ?? (keyById ? carsByKey.get(`id:${keyById}`) : undefined);
    return {
      ...task,
      carLabel: car ? buildCarLabel(car) : "Unknown car",
      carDisplayId: keyByRow || keyById || "-",
    };
  });
}

export async function fetchMobileOrders(filter: MobileOrderFilter): Promise<OrdersReadResult<OrderTaskWithCar[]>> {
  try {
    const supabase = createAnonClient();
    const { data, error } = await supabase
      .from(ORDER_TASKS_TABLE)
      .select("*")
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(200);

    if (error) {
      if (isMissingTableError(error.message)) return { data: [], error: null, tableReady: false };
      return { data: [], error: error.message, tableReady: false };
    }

    const tasks = ((data ?? []) as Record<string, unknown>[]).map(asOrderTask);
    const filtered = tasks.filter((task) => matchesRole(task, filter.role)).filter((task) => filter.status === "all" || task.status === filter.status);
    const carsByKey = await fetchCarsForTasks(filtered);
    return { data: withCarInfo(filtered, carsByKey), error: null, tableReady: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isMissingTableError(msg)) return { data: [], error: null, tableReady: false };
    return { data: [], error: msg, tableReady: false };
  }
}

export async function fetchMobileOrderDetail(
  id: string
): Promise<OrdersReadResult<{ task: OrderTaskWithCar | null; items: OrderItem[]; updates: OrderTaskUpdate[] }>> {
  try {
    const supabase = createAnonClient();
    const { data, error } = await supabase.from(ORDER_TASKS_TABLE).select("*").eq("id", id).maybeSingle();

    if (error) {
      if (isMissingTableError(error.message)) return { data: { task: null, items: [], updates: [] }, error: null, tableReady: false };
      return { data: { task: null, items: [], updates: [] }, error: error.message, tableReady: false };
    }
    if (!data) return { data: { task: null, items: [], updates: [] }, error: null, tableReady: true };

    const task = asOrderTask(data as Record<string, unknown>);
    const carsByKey = await fetchCarsForTasks([task]);
    const withCar = withCarInfo([task], carsByKey)[0] ?? null;

    const { data: itemsData, error: itemsError } = await supabase
      .from(ORDER_ITEMS_TABLE)
      .select("*")
      .eq("order_task_id", id)
      .order("created_at", { ascending: true, nullsFirst: true });
    if (itemsError && !isMissingTableError(itemsError.message)) {
      return { data: { task: withCar, items: [], updates: [] }, error: itemsError.message, tableReady: true };
    }

    const { data: updatesData, error: updatesError } = await supabase
      .from(ORDER_UPDATES_TABLE)
      .select("*")
      .eq("order_task_id", id)
      .order("created_at", { ascending: true, nullsFirst: true });
    if (updatesError && !isMissingTableError(updatesError.message)) {
      return { data: { task: withCar, items: [], updates: [] }, error: updatesError.message, tableReady: true };
    }

    return {
      data: {
        task: withCar,
        items: ((itemsData ?? []) as Record<string, unknown>[]).map(asOrderItem),
        updates: ((updatesData ?? []) as Record<string, unknown>[]).map(asOrderUpdate),
      },
      error: null,
      tableReady: true,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isMissingTableError(msg)) return { data: { task: null, items: [], updates: [] }, error: null, tableReady: false };
    return { data: { task: null, items: [], updates: [] }, error: msg, tableReady: false };
  }
}

export async function fetchOrderItemsByCars(
  cars: Car[]
): Promise<{ byCarKey: Record<string, OrderItemLite[]>; error: string | null; tableReady: boolean }> {
  try {
    const supabase = createAnonClient();
    const { tasks, error: taskFetchError, tableReady: taskTableReady } = await fetchMatchingOrderTasks(supabase, cars);
    if (taskFetchError) return { byCarKey: {}, error: taskFetchError, tableReady: taskTableReady };
    if (!taskTableReady) return { byCarKey: {}, error: null, tableReady: false };
    const taskIds = Array.from(new Set(tasks.map((t) => String(t.id ?? "").trim()).filter(Boolean)));
    if (taskIds.length === 0) return { byCarKey: {}, error: null, tableReady: true };

    let itemsData: Array<Record<string, unknown>> = [];
    {
      const primary = await supabase
        .from(ORDER_ITEMS_TABLE)
        .select(
          "id,order_task_id,label,status,assignee_staff,due_date,note,outside_supplier,outside_eta_date,outside_price,outside_note,created_at,updated_at"
        )
        .in("order_task_id", taskIds)
        .limit(10000);
      if (primary.error) {
        const fallback = await supabase
          .from(ORDER_ITEMS_TABLE)
          .select(
            "id,order_task_id,label,status,assignee_staff,outside_supplier,outside_eta_date,outside_price,outside_note,created_at,updated_at"
          )
          .in("order_task_id", taskIds)
          .limit(10000);
        if (fallback.error) {
          if (isMissingTableError(fallback.error.message)) return { byCarKey: {}, error: null, tableReady: false };
          return { byCarKey: {}, error: fallback.error.message, tableReady: false };
        }
        itemsData = (fallback.data ?? []) as Array<Record<string, unknown>>;
      } else {
        itemsData = (primary.data ?? []) as Array<Record<string, unknown>>;
      }
    }

    const taskKeyByTaskId = new Map<string, string[]>();
    for (const t of tasks) {
      const taskId = String(t.id ?? "").trim();
      if (!taskId) continue;
      const keys = orderTaskKeysForCars(cars, t);
      mergeTaskCarKeys(taskKeyByTaskId, taskId, keys);
    }

    const byCarKey: Record<string, OrderItemLite[]> = {};
    for (const row of itemsData) {
      const taskId = String(row.order_task_id ?? "").trim();
      const keys = taskKeyByTaskId.get(taskId) ?? [];
      const item: OrderItemLite = {
        id: String(row.id ?? "").trim() || null,
        order_task_id: String(row.order_task_id ?? "").trim() || null,
        label: String(row.label ?? "Item"),
        status: String(row.status ?? "requested"),
        assignee_staff: String(row.assignee_staff ?? "").trim() || null,
        due_date: coalesceDateYmd(row.due_date, row.outside_eta_date),
        note: coalesceText(row.note, row.outside_note),
        outside_supplier: String(row.outside_supplier ?? "").trim() || null,
        outside_eta_date: (dateYmdOrNull(row.outside_eta_date) ?? trimStr(row.outside_eta_date)) || null,
        outside_price: Number.isFinite(Number(row.outside_price)) ? Number(row.outside_price) : null,
        clock_start_ymd: dateYmdBangkokFromDbTimestamp(row.updated_at) ?? dateYmdBangkokFromDbTimestamp(row.created_at) ?? null,
      };
      for (const key of keys) {
        if (!byCarKey[key]) byCarKey[key] = [];
        byCarKey[key].push(item);
      }
    }
    return { byCarKey, error: null, tableReady: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isMissingTableError(msg)) return { byCarKey: {}, error: null, tableReady: false };
    return { byCarKey: {}, error: msg, tableReady: false };
  }
}

export async function fetchOrderStorageByCars(
  cars: Car[]
): Promise<{ byCarKey: Record<string, OrderStorageLite[]>; error: string | null; tableReady: boolean }> {
  try {
    const supabase = createAnonClient();
    const rowIds = collectCarRowIds(cars);
    const carIds = collectCarIdsForInFilter(cars);
    if (rowIds.length === 0 && carIds.length === 0) return { byCarKey: {}, error: null, tableReady: true };

    let rows: Array<Record<string, unknown>> = [];
    if (rowIds.length > 0) {
      const byRow = await supabase
        .from(ORDER_STORAGE_TABLE)
        .select("id,order_task_id,order_item_id,car_row_id,car_id,storage_name,item_name,storage_type,expire_date,status,note,updated_at")
        .in("car_row_id", rowIds)
        .limit(10000);
      if (byRow.error) {
        if (isMissingTableError(byRow.error.message)) return { byCarKey: {}, error: null, tableReady: false };
        return { byCarKey: {}, error: byRow.error.message, tableReady: false };
      }
      rows = rows.concat((byRow.data ?? []) as Array<Record<string, unknown>>);
    }
    if (carIds.length > 0) {
      const byId = await supabase
        .from(ORDER_STORAGE_TABLE)
        .select("id,order_task_id,order_item_id,car_row_id,car_id,storage_name,item_name,storage_type,expire_date,status,note,updated_at")
        .in("car_id", carIds)
        .limit(10000);
      if (byId.error) {
        if (isMissingTableError(byId.error.message)) return { byCarKey: {}, error: null, tableReady: false };
        return { byCarKey: {}, error: byId.error.message, tableReady: false };
      }
      rows = rows.concat((byId.data ?? []) as Array<Record<string, unknown>>);
    }

    const dedup = new Map<string, OrderStorageLite>();
    for (const row of rows) {
      const item: OrderStorageLite = {
        id: String(row.id ?? "").trim() || null,
        order_task_id: String(row.order_task_id ?? "").trim() || null,
        order_item_id: String(row.order_item_id ?? "").trim() || null,
        car_row_id: String(row.car_row_id ?? "").trim() || null,
        car_id: Number.isFinite(Number(row.car_id)) ? Number(row.car_id) : null,
        storage_name: String(row.storage_name ?? "").trim() || null,
        item_name: String(row.item_name ?? "").trim() || null,
        storage_type: String(row.storage_type ?? "").trim() || null,
        expire_date: String(row.expire_date ?? "").trim() || null,
        status: String(row.status ?? "").trim() || null,
        note: String(row.note ?? "").trim() || null,
        updated_at: String(row.updated_at ?? "").trim() || null,
      };
      dedup.set(item.id ?? `${item.car_row_id}:${item.car_id}:${item.item_name}:${item.storage_type}:${item.expire_date}`, item);
    }

    const byCarKey: Record<string, OrderStorageLite[]> = {};
    for (const item of Array.from(dedup.values())) {
      const keys: string[] = [];
      if (item.car_row_id) keys.push(`row:${item.car_row_id}`);
      if (item.car_id != null) keys.push(`id:${item.car_id}`);
      for (const key of keys) {
        if (!byCarKey[key]) byCarKey[key] = [];
        byCarKey[key].push(item);
      }
    }
    return { byCarKey, error: null, tableReady: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isMissingTableError(msg)) return { byCarKey: {}, error: null, tableReady: false };
    return { byCarKey: {}, error: msg, tableReady: false };
  }
}

export async function fetchOrderUpdatesByCars(
  cars: Car[]
): Promise<{ byCarKey: Record<string, OrderUpdateLite[]>; error: string | null; tableReady: boolean }> {
  try {
    const supabase = createAnonClient();
    const { tasks, error: taskFetchError, tableReady: taskTableReady } = await fetchMatchingOrderTasks(supabase, cars);
    if (taskFetchError) return { byCarKey: {}, error: taskFetchError, tableReady: taskTableReady };
    if (!taskTableReady) return { byCarKey: {}, error: null, tableReady: false };

    const taskIds = Array.from(new Set(tasks.map((t) => String(t.id ?? "").trim()).filter(Boolean)));
    if (taskIds.length === 0) return { byCarKey: {}, error: null, tableReady: true };
    const updates = await supabase
      .from(ORDER_UPDATES_TABLE)
      .select("id,order_task_id,role,message,created_at")
      .in("order_task_id", taskIds)
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(10000);
    if (updates.error) {
      if (isMissingTableError(updates.error.message)) return { byCarKey: {}, error: null, tableReady: false };
      return { byCarKey: {}, error: updates.error.message, tableReady: false };
    }

    const keysByTaskId = new Map<string, string[]>();
    for (const t of tasks) {
      const taskId = String(t.id ?? "").trim();
      if (!taskId) continue;
      mergeTaskCarKeys(keysByTaskId, taskId, orderTaskKeysForCars(cars, t));
    }

    const byCarKey: Record<string, OrderUpdateLite[]> = {};
    for (const row of (updates.data ?? []) as Array<Record<string, unknown>>) {
      const taskId = String(row.order_task_id ?? "").trim();
      const keys = keysByTaskId.get(taskId) ?? [];
      const item: OrderUpdateLite = {
        id: String(row.id ?? "").trim() || null,
        order_task_id: String(row.order_task_id ?? "").trim() || null,
        role: String(row.role ?? "").trim() || null,
        message: String(row.message ?? "").trim() || null,
        created_at: String(row.created_at ?? "").trim() || null,
      };
      for (const key of keys) {
        if (!byCarKey[key]) byCarKey[key] = [];
        byCarKey[key].push(item);
      }
    }
    return { byCarKey, error: null, tableReady: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isMissingTableError(msg)) return { byCarKey: {}, error: null, tableReady: false };
    return { byCarKey: {}, error: msg, tableReady: false };
  }
}
