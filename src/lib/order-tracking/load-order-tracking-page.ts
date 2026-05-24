import {
  fetchCarsForOrderTracking,
  fetchOrderTrackingSaleStatusSummary,
  fetchOrderTrackingSummarySnapshot,
} from "@/lib/data/cars";
import { fetchOrderItemFilterIndexByCars, fetchOrderItemsAndUpdatesByCars } from "@/lib/data/orders";
import type { Car } from "@/types/car";
import { headers } from "next/headers";

function resolveRequestOrigin(): string {
  try {
    const h = headers();
    const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() ?? h.get("host")?.trim();
    if (!host) return "";
    const rawProto = h.get("x-forwarded-proto")?.split(",")[0]?.trim()?.toLowerCase() ?? "https";
    const proto = rawProto === "http" || rawProto === "https" ? rawProto : "https";
    return `${proto}://${host}`;
  } catch {
    return "";
  }
}

function parseOrderSearchParam(order: string | string[] | undefined): string | null {
  if (typeof order === "string") return order.trim() || null;
  if (Array.isArray(order)) return String(order[0] ?? "").trim() || null;
  return null;
}

export type OrderTrackingSearchParams = {
  order?: string | string[];
  carRowId?: string | string[];
  focusCar?: string | string[];
  car_row_id?: string | string[];
  search?: string | string[];
  plate?: string | string[];
};
type LoadOrderTrackingPageOptions = {
  /** โหมดทดลองความเร็ว: โหลดเฉพาะสรุป ไม่โหลดรถ/รายการ */
  summaryOnly?: boolean;
  includeShipped?: boolean;
  chipCacheExperiment?: boolean;
  initialDetailLimit?: number;
  initialSaleStatusFilters?: string[];
};

function carSaleStatus(car: Car): string {
  const hasShipped = Boolean(String(car.shipped ?? "").trim());
  const hasBookedShipping = Boolean(String(car.booked_shipping ?? "").trim());
  const hasBuyer = Boolean(String(car.buyer ?? "").trim());
  if (hasShipped) return "ส่งแล้ว";
  if (hasBookedShipping) return "รอส่ง";
  if (hasBuyer) return "จอง";
  return "ว่าง";
}

function carKeys(car: Car): string[] {
  const keys: string[] = [];
  const rowId = String(car.row_id ?? "").trim();
  const id = String(car.id ?? "").trim();
  if (rowId) keys.push(`row:${rowId}`);
  if (id) keys.push(`id:${id}`);
  return keys;
}

function pickInitialDetailCars(cars: Car[], filters: string[] | undefined, limit: number): Car[] {
  const normalizedFilters = new Set((filters ?? []).map((s) => String(s).trim()).filter(Boolean));
  const source =
    normalizedFilters.size > 0 ? cars.filter((car) => normalizedFilters.has(carSaleStatus(car))) : cars;
  return source.slice(0, Math.max(1, limit));
}

/** Shared server payload for `/m/orders` and `/liff/orders`. */
export async function loadOrderTrackingPageData(
  searchParams: OrderTrackingSearchParams,
  options?: LoadOrderTrackingPageOptions
) {
  const summaryOnly = options?.summaryOnly === true;
  const chipCacheExperiment = options?.chipCacheExperiment === true;
  const initialDetailLimit = Math.max(1, Math.min(50, Math.floor(Number(options?.initialDetailLimit ?? 50))));
  const [
    { summary: saleStatusSummaryAllCars, error: saleSummaryError },
    { snapshot: summarySnapshotAllCars, error: summarySnapshotError },
  ] = await Promise.all([fetchOrderTrackingSaleStatusSummary(), fetchOrderTrackingSummarySnapshot()]);

  let cars: Awaited<ReturnType<typeof fetchCarsForOrderTracking>>["cars"] = [];
  let carsError: string | null = null;
  let orderItemsByCar: Awaited<ReturnType<typeof fetchOrderItemsAndUpdatesByCars>>["orderItemsByCar"] = {};
  let orderUpdatesByCar: Awaited<ReturnType<typeof fetchOrderItemsAndUpdatesByCars>>["orderUpdatesByCar"] = {};
  let orderItemFilterIndexByCar: Awaited<ReturnType<typeof fetchOrderItemFilterIndexByCars>>["byCarKey"] = {};
  let experimentInitialHydratedCarKeys: string[] = [];
  let itemsError: string | null = null;
  let updatesError: string | null = null;
  let itemIndexError: string | null = null;

  if (!summaryOnly || chipCacheExperiment) {
    const carsPack = await fetchCarsForOrderTracking({ includeShipped: options?.includeShipped !== false });
    cars = carsPack.cars;
    carsError = carsPack.error;
    if (chipCacheExperiment) {
      const initialCars = pickInitialDetailCars(cars, options?.initialSaleStatusFilters, initialDetailLimit);
      experimentInitialHydratedCarKeys = Array.from(new Set(initialCars.flatMap(carKeys)));
      const [itemsPack, itemIndexPack] = await Promise.all([
        fetchOrderItemsAndUpdatesByCars(initialCars),
        fetchOrderItemFilterIndexByCars(cars),
      ]);
      orderItemsByCar = itemsPack.orderItemsByCar;
      orderUpdatesByCar = itemsPack.orderUpdatesByCar;
      orderItemFilterIndexByCar = itemIndexPack.byCarKey;
      itemsError = itemsPack.itemsError;
      updatesError = itemsPack.updatesError;
      itemIndexError = itemIndexPack.error;
    } else {
      const itemsPack = await fetchOrderItemsAndUpdatesByCars(cars);
      orderItemsByCar = itemsPack.orderItemsByCar;
      orderUpdatesByCar = itemsPack.orderUpdatesByCar;
      itemsError = itemsPack.itemsError;
      updatesError = itemsPack.updatesError;
    }
  }

  const dataWarnings = [
    summaryOnly ? "Summary-only mode: ยังไม่โหลดรายการรถ (เน้นเปิดหน้าเร็วสุด)" : null,
    carsError,
    saleSummaryError,
    summarySnapshotError,
    itemsError,
    updatesError,
    itemIndexError,
  ].filter(
    (v): v is string => typeof v === "string" && v.length > 0
  );
  const initialFocusedOrderId = parseOrderSearchParam(searchParams?.order);
  const origin = resolveRequestOrigin();
  const shareBaseUrl = origin || null;

  return {
    carsData: cars,
    orderItemsByCar,
    orderUpdatesByCar,
    orderItemFilterIndexByCar,
    experimentInitialHydratedCarKeys,
    saleStatusSummaryAllCars,
    summarySnapshotAllCars,
    dataWarnings,
    initialFocusedOrderId,
    shareBaseUrl,
  };
}
