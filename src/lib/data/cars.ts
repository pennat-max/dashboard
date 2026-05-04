import { createAnonClient } from "@/lib/supabase/anon";
import {
  carPriceNumber,
  isBookedNotExported,
  isCarExported,
  isReadyForSaleStock,
  isWebsitePending,
  isWebsitePendingBeForward,
} from "@/lib/car-fields";
import type { Car, CarsSortField, SortOrder } from "@/types/car";
const TABLE = process.env.NEXT_PUBLIC_SUPABASE_CARS_TABLE ?? "cars";

/** PostgREST / Supabase จำกัดจำนวนแถวต่อคำขอ (ปกติ 1,000) — ต้องดึงหลายรอบ */
const PAGE_SIZE = 1000;

type PageFetchResult = Promise<{ data: unknown; error: { message: string } | null }>;
const FILTER_OPTIONS_CACHE_MS = 60_000;
let filterOptionsCache:
  | { at: number; cars: Car[] }
  | null = null;

/** ดึงทุกแถวแบบหลาย range พร้อมกัน — เร็วกว่า await ทีละหน้า */
async function fetchAllRowsInParallel(
  totalCount: number,
  fetchPage: (from: number, to: number) => PageFetchResult
): Promise<{ cars: Car[]; error: string | null }> {
  if (totalCount <= 0) return { cars: [], error: null };
  const pages = Math.ceil(totalCount / PAGE_SIZE);
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) => {
      const from = i * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      return fetchPage(from, to);
    })
  );
  const all: Car[] = [];
  for (const { data, error } of results) {
    if (error) return { cars: [], error: error.message };
    all.push(...rowsAsCars(data));
  }
  return { cars: all, error: null };
}

/** ดึงแบบทีละหน้า (fallback เมื่อ count ไม่ได้ / ผิดพลาด) */
async function fetchAllRowsSequential(
  fetchPage: (from: number, to: number) => PageFetchResult
): Promise<{ cars: Car[]; error: string | null }> {
  const all: Car[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) return { cars: [], error: error.message };
    const batch = rowsAsCars(data);
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return { cars: all, error: null };
}

/**
 * ไม่ดึง raw_data (JSON ใหญ่มาก) — ลดขนาดและเลี่ยงขีดจำกัด cache 2MB ของ Next
 */
export const CARS_SELECT_LEAN = [
  "id",
  "row_id",
  "spec",
  "status",
  "picture",
  "advance_date",
  "income_date",
  "plate_number",
  "province",
  "brand",
  "drive_type",
  "engine_size",
  "grade",
  "gear_type",
  "cabin",
  "color",
  "manufacture",
  "registration",
  "engine_number",
  "chassis_number",
  "mileage",
  "agent",
  "inspector",
  "driver_location",
  "initial_document",
  "document_status",
  "doc_fee",
  "repair_cost",
  "repair_details",
  "advance",
  "buy_price",
  "total_cost",
  "part_accessories",
  "web_price_usd",
  "bf_on_web",
  "requested_modifications",
  "free",
  "booked_date",
  "sale_price_usd",
  "buyer",
  "sale_support",
  "remarks",
  "booked_shipping",
  "destination_port",
  "other",
  "shipped",
  "country",
  "month",
  "c_year",
  "model",
  "model_year",
  "updated_at",
].join(",");

/** สำหรับทำตัวเลือก filter เท่านั้น — เบากว่า CARS_SELECT_LEAN มาก */
export const CARS_SELECT_FILTERS = [
  "status",
  "country",
  "destination_port",
  "brand",
  "drive_type",
  "engine_size",
  "grade",
  "gear_type",
  "cabin",
  "color",
  "c_year",
].join(",");

/** Lightweight select for /m/orders mobile tracking */
export const CARS_SELECT_ORDER_TRACKING = [
  "id",
  "row_id",
  "spec",
  "sale_support",
  "buyer",
  "sale_price_usd",
  "total_cost",
  "buy_price",
  "model_year",
  "c_year",
  "repair_cost",
  "repair_details",
  "part_accessories",
  "chassis_number",
  "plate_number",
  "booked_shipping",
  "shipped",
  "picture",
  "status",
  "document_status",
  "initial_document",
  "doc_fee",
].join(",");

function rowsAsCars(data: unknown): Car[] {
  return (data ?? []) as Car[];
}

function rowAsCar(data: unknown): Car | null {
  return data as Car | null;
}

/** คอลัมน์ที่มีในตารางจริง (สคีมา sheet) — ห้ามส่งชื่ออื่นไปที่ .order() */
const ORDERABLE_COLUMNS = new Set<string>([
  "updated_at",
  "income_date",
  "id",
  "brand",
  "model",
  "buy_price",
  "mileage",
]);

/** พารามิเตอร์เก่า / สคีมาเดิมใน repo → คอลัมน์ที่มีจริง */
const SORT_LEGACY: Record<string, CarsSortField> = {
  created_at: "updated_at",
  make: "brand",
  price_thb: "buy_price",
  mileage_km: "mileage",
  year: "id",
  destination_country: "updated_at",
};

function coerceSortField(sort: string | undefined): CarsSortField {
  const raw = (sort ?? "").trim();
  if (raw && SORT_LEGACY[raw]) return SORT_LEGACY[raw];
  if (raw && ORDERABLE_COLUMNS.has(raw)) return raw as CarsSortField;
  return "updated_at";
}

export function parseSort(
  sort: string | undefined,
  order: string | undefined
): { field: CarsSortField; order: SortOrder } {
  const field = coerceSortField(sort);
  const ord: SortOrder = order === "asc" ? "asc" : "desc";
  return { field, order: ord };
}

export type CarsQueryResult = { cars: Car[]; error: string | null };

export async function fetchCarsForDashboard(): Promise<CarsQueryResult> {
  try {
    const supabase = createAnonClient();
    const { count, error: countError } = await supabase
      .from(TABLE)
      .select("*", { count: "planned", head: true });

    if (countError) {
      return fetchAllRowsSequential(async (from, to) =>
        supabase
          .from(TABLE)
          .select(CARS_SELECT_LEAN)
          .order("updated_at", { ascending: false })
          .range(from, to)
      );
    }

    const total = count ?? 0;
    return fetchAllRowsInParallel(total, async (from, to) =>
      supabase
        .from(TABLE)
        .select(CARS_SELECT_LEAN)
        .order("updated_at", { ascending: false })
        .range(from, to)
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { cars: [], error: msg };
  }
}

export async function fetchCarsForOrderTracking(): Promise<CarsQueryResult> {
  try {
    const supabase = createAnonClient();
    const { count, error: countError } = await supabase
      .from(TABLE)
      .select("*", { count: "planned", head: true });

    if (countError) {
      return fetchAllRowsSequential(async (from, to) =>
        supabase
          .from(TABLE)
          .select(CARS_SELECT_ORDER_TRACKING)
          .order("updated_at", { ascending: false })
          .range(from, to)
      );
    }

    const total = count ?? 0;
    return fetchAllRowsInParallel(total, async (from, to) =>
      supabase
        .from(TABLE)
        .select(CARS_SELECT_ORDER_TRACKING)
        .order("updated_at", { ascending: false })
        .range(from, to)
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { cars: [], error: msg };
  }
}

/** ดึงข้อมูลเฉพาะคอลัมน์ที่ใช้สร้างตัวเลือก filter */
export async function fetchCarsForFilterOptions(): Promise<CarsQueryResult> {
  try {
    if (filterOptionsCache && Date.now() - filterOptionsCache.at < FILTER_OPTIONS_CACHE_MS) {
      return { cars: filterOptionsCache.cars, error: null };
    }

    const supabase = createAnonClient();
    const { count, error: countError } = await supabase
      .from(TABLE)
      .select("*", { count: "planned", head: true });

    if (countError) {
      const r = await fetchAllRowsSequential(async (from, to) =>
        supabase
          .from(TABLE)
          .select(CARS_SELECT_FILTERS)
          .range(from, to)
      );
      if (!r.error) filterOptionsCache = { at: Date.now(), cars: r.cars };
      return r;
    }

    const total = count ?? 0;
    const r = await fetchAllRowsInParallel(total, async (from, to) =>
      supabase
        .from(TABLE)
        .select(CARS_SELECT_FILTERS)
        .range(from, to)
    );
    if (!r.error) filterOptionsCache = { at: Date.now(), cars: r.cars };
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { cars: [], error: msg };
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CarByIdResult = { car: Car | null; error: string | null };

export async function fetchCarById(id: string): Promise<CarByIdResult> {
  try {
    const supabase = createAnonClient();
    const trimmed = id.trim();
    const byUuid = UUID_RE.test(trimmed);
    if (byUuid) {
      const { data, error } = await supabase
        .from(TABLE)
        .select(CARS_SELECT_LEAN)
        .eq("row_id", trimmed)
        .maybeSingle();
      if (error) return { car: null, error: error.message };
      return { car: rowAsCar(data), error: null };
    }
    const idNum = Number(trimmed);
    const { data, error } = await supabase
      .from(TABLE)
      .select(CARS_SELECT_LEAN)
      .eq("id", Number.isFinite(idNum) ? idNum : trimmed)
      .maybeSingle();
    if (error) return { car: null, error: error.message };
    return { car: rowAsCar(data), error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { car: null, error: msg };
  }
}

export type CarsListParams = {
  q?: string;
  brand?: string;
  status?: string;
  destination?: string;
  driveType?: string;
  engineSize?: string;
  grade?: string;
  gearType?: string;
  cabin?: string;
  color?: string;
  cYear?: string;
  sort?: string;
  order?: string;
};

/** ตัวกรองเริ่มต้น — ใช้ชุดข้อมูลเดียวกับ `fetchCarsForDashboard` ได้ */
export function isCarsListDefaultParams(params: CarsListParams): boolean {
  return (
    !params.q?.trim() &&
    (!params.brand || params.brand === "all") &&
    (!params.status || params.status === "all") &&
    (!params.destination || params.destination === "all") &&
    (!params.driveType || params.driveType === "all") &&
    (!params.engineSize || params.engineSize === "all") &&
    (!params.grade || params.grade === "all") &&
    (!params.gearType || params.gearType === "all") &&
    (!params.cabin || params.cabin === "all") &&
    (!params.color || params.color === "all") &&
    (!params.cYear || params.cYear === "all") &&
    (!params.sort || params.sort === "updated_at") &&
    (!params.order || params.order === "desc")
  );
}

function applyCarsListFilters<T extends { or: (s: string) => T; eq: (c: string, v: string) => T }>(
  q: T,
  params: CarsListParams
): T {
  const parseMulti = (raw?: string): string[] => {
    if (!raw) return [];
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "all");
  };

  const applyEqOrIn = (
    queryObj: T & { in: (column: string, values: string[]) => T },
    column: string,
    raw?: string
  ): T => {
    const values = parseMulti(raw);
    if (values.length === 0) return queryObj;
    if (values.length === 1) return queryObj.eq(column, values[0]);
    return queryObj.in(column, values);
  };

  let query = q;
  const search = params.q?.trim();
  if (search) {
    const pattern = `%${search}%`;
    query = query.or(
      `brand.ilike.${pattern},model.ilike.${pattern},chassis_number.ilike.${pattern},plate_number.ilike.${pattern},spec.ilike.${pattern}`
    );
  }
  query = applyEqOrIn(query as T & { in: (column: string, values: string[]) => T }, "status", params.status);
  query = applyEqOrIn(query as T & { in: (column: string, values: string[]) => T }, "brand", params.brand);
  const destinations = parseMulti(params.destination);
  if (destinations.length > 0) {
    const terms = destinations.flatMap((d) => [`country.eq.${d}`, `destination_port.eq.${d}`]);
    query = query.or(terms.join(","));
  }
  query = applyEqOrIn(
    query as T & { in: (column: string, values: string[]) => T },
    "drive_type",
    params.driveType
  );
  query = applyEqOrIn(
    query as T & { in: (column: string, values: string[]) => T },
    "engine_size",
    params.engineSize
  );
  query = applyEqOrIn(query as T & { in: (column: string, values: string[]) => T }, "grade", params.grade);
  query = applyEqOrIn(
    query as T & { in: (column: string, values: string[]) => T },
    "gear_type",
    params.gearType
  );
  query = applyEqOrIn(query as T & { in: (column: string, values: string[]) => T }, "cabin", params.cabin);
  query = applyEqOrIn(query as T & { in: (column: string, values: string[]) => T }, "color", params.color);
  query = applyEqOrIn(query as T & { in: (column: string, values: string[]) => T }, "c_year", params.cYear);
  return query;
}

export async function fetchCarsList(
  params: CarsListParams
): Promise<CarsQueryResult> {
  try {
    const supabase = createAnonClient();
    const { field, order } = parseSort(params.sort, params.order);

    const buildOrderedDataQuery = () => {
      let q = supabase.from(TABLE).select(CARS_SELECT_LEAN);
      q = applyCarsListFilters(q, params);
      return q.order(field, {
        ascending: order === "asc",
        nullsFirst: false,
      });
    };

    let countQuery = supabase.from(TABLE).select("*", { count: "planned", head: true });
    countQuery = applyCarsListFilters(countQuery, params);
    const { count, error: countError } = await countQuery;

    if (countError) {
      return fetchAllRowsSequential(async (from, to) => buildOrderedDataQuery().range(from, to));
    }

    const total = count ?? 0;
    return fetchAllRowsInParallel(total, async (from, to) => buildOrderedDataQuery().range(from, to));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { cars: [], error: msg };
  }
}

export type DashboardKpi = {
  totalCars: number;
  totalValueThb: number;
  /** มี buyer แต่ยังไม่ส่งออก — จองแล้ว ค้างส่ง */
  bookedNotExportedCount: number;
  /** ส่งออกแล้ว — shipped หรือ booked_shipping ไม่ว่าง */
  exportedCount: number;
  /** พร้อมขาย — buyer / shipped / booked_shipping ว่างทั้งหมด */
  availableCount: number;
  /** พร้อมขาย + สถานะ P.Office + picture ว่าง = ยังไม่ลงเว็บ vigoasia */
  websitePendingCount: number;
  /** พร้อมขาย + สถานะ P.Office + BF on web มีคำว่า Not = ยังไม่ลงเว็บ beforward */
  websitePendingBeForwardCount: number;
  /** รับรถพรุ่งนี้ (income_date) */
  incomeTomorrowCount: number;
  /** เงินที่ต้องจ่ายพรุ่งนี้ (รวม buy_price / price_thb) */
  incomeTomorrowValueThb: number;
};

/** ไม่นับรวมใน KPI ภาพรวม (เช่น รถทั้งหมด) */
export function isCancelledStatus(car: Car): boolean {
  const s = (car.status ?? "").trim().toLowerCase();
  return s.includes("cancel") || s.includes("ยกเลิก");
}

/** ใช้กับสถิติทั้งหมด — ไม่รวมแถวที่สถานะเป็น cancel / ยกเลิก */
export function excludeCancelledCars(cars: Car[]): Car[] {
  return cars.filter((c) => !isCancelledStatus(c));
}

export function computeDashboardKpi(cars: Car[]): DashboardKpi {
  const rows = excludeCancelledCars(cars);
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const tomorrowLocal = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(
    tomorrow.getDate()
  ).padStart(2, "0")}`;
  const skipStatuses = new Set(["comming", "coming"]);
  const totalCars = rows.length;
  const totalValueThb = rows.reduce(
    (sum, c) => sum + (carPriceNumber(c) || 0),
    0
  );
  const exportedCount = rows.filter((c) => isCarExported(c)).length;
  const bookedNotExportedCount = rows.filter((c) => isBookedNotExported(c)).length;
  const availableCount = rows.filter((c) => isReadyForSaleStock(c)).length;
  const websitePendingCount = rows.filter(isWebsitePending).length;
  const websitePendingBeForwardCount = rows.filter(isWebsitePendingBeForward).length;
  const incomeTomorrowRows = rows.filter((c) => {
    const incomeDate = (c.income_date ?? "").trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(incomeDate)) return false;
    if (incomeDate <= todayLocal) return false;
    if (incomeDate !== tomorrowLocal) return false;
    const normalizedStatus = (c.status ?? "").trim().toLowerCase();
    return !skipStatuses.has(normalizedStatus);
  });
  const incomeTomorrowCount = incomeTomorrowRows.length;
  const incomeTomorrowValueThb = incomeTomorrowRows.reduce((sum, c) => sum + (carPriceNumber(c) || 0), 0);

  return {
    totalCars,
    totalValueThb,
    bookedNotExportedCount,
    exportedCount,
    availableCount,
    websitePendingCount,
    websitePendingBeForwardCount,
    incomeTomorrowCount,
    incomeTomorrowValueThb,
  };
}
