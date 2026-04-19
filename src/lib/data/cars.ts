import { createAnonClient } from "@/lib/supabase/anon";
import { carPriceNumber } from "@/lib/car-fields";
import type { Car, CarsSortField, SortOrder } from "@/types/car";

const TABLE = process.env.NEXT_PUBLIC_SUPABASE_CARS_TABLE ?? "cars";

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
    const { data, error } = await supabase
      .from(TABLE)
      .select(CARS_SELECT_LEAN)
      .order("updated_at", { ascending: false });

    if (error) return { cars: [], error: error.message };
    return { cars: rowsAsCars(data), error: null };
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
  status?: string;
  destination?: string;
  sort?: string;
  order?: string;
};

export async function fetchCarsList(
  params: CarsListParams
): Promise<CarsQueryResult> {
  try {
    const supabase = createAnonClient();
    const { field, order } = parseSort(params.sort, params.order);

    let query = supabase.from(TABLE).select(CARS_SELECT_LEAN);

    const q = params.q?.trim();
    if (q) {
      const pattern = `%${q}%`;
      query = query.or(
        `brand.ilike.${pattern},model.ilike.${pattern},chassis_number.ilike.${pattern},plate_number.ilike.${pattern},spec.ilike.${pattern}`
      );
    }

    if (params.status && params.status !== "all") {
      query = query.eq("status", params.status);
    }

    if (params.destination && params.destination !== "all") {
      const d = params.destination;
      query = query.or(`country.eq.${d},destination_port.eq.${d}`);
    }

    query = query.order(field, {
      ascending: order === "asc",
      nullsFirst: false,
    });

    const { data, error } = await query;

    if (error) return { cars: [], error: error.message };
    return { cars: rowsAsCars(data), error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { cars: [], error: msg };
  }
}

export type DashboardKpi = {
  totalCars: number;
  totalValueThb: number;
  availableCount: number;
  /** ส่งออกแล้ว — คอลัมน์ shipped ไม่ว่าง */
  exportedCount: number;
  /** มีชื่อผู้ซื้อในคอลัมน์ buyer */
  withBuyerCount: number;
};

export function computeDashboardKpi(cars: Car[]): DashboardKpi {
  const totalCars = cars.length;
  const totalValueThb = cars.reduce(
    (sum, c) => sum + (carPriceNumber(c) || 0),
    0
  );
  const availableCount = cars.filter((c) => {
    const s = (c.status ?? "").toLowerCase();
    return (
      s.includes("office") ||
      s.includes("available") ||
      s.includes("stock") ||
      s.includes("พร้อม")
    );
  }).length;
  const exportedCount = cars.filter((c) => Boolean((c.shipped ?? "").trim())).length;
  const withBuyerCount = cars.filter((c) => Boolean((c.buyer ?? "").trim())).length;

  return {
    totalCars,
    totalValueThb,
    availableCount,
    exportedCount,
    withBuyerCount,
  };
}
