import {
  fetchCarsForOrderTracking,
  fetchOrderTrackingSaleStatusSummary,
  fetchOrderTrackingSummarySnapshot,
} from "@/lib/data/cars";
import { fetchOrderItemsAndUpdatesByCars } from "@/lib/data/orders";
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

export type OrderTrackingSearchParams = { order?: string | string[] };
type LoadOrderTrackingPageOptions = {
  /** โหมดทดลองความเร็ว: โหลดเฉพาะสรุป ไม่โหลดรถ/รายการ */
  summaryOnly?: boolean;
  includeShipped?: boolean;
};

/** Shared server payload for `/m/orders` and `/liff/orders`. */
export async function loadOrderTrackingPageData(
  searchParams: OrderTrackingSearchParams,
  options?: LoadOrderTrackingPageOptions
) {
  const summaryOnly = options?.summaryOnly === true;
  const [
    { summary: saleStatusSummaryAllCars, error: saleSummaryError },
    { snapshot: summarySnapshotAllCars, error: summarySnapshotError },
  ] = await Promise.all([fetchOrderTrackingSaleStatusSummary(), fetchOrderTrackingSummarySnapshot()]);

  let cars: Awaited<ReturnType<typeof fetchCarsForOrderTracking>>["cars"] = [];
  let carsError: string | null = null;
  let orderItemsByCar: Awaited<ReturnType<typeof fetchOrderItemsAndUpdatesByCars>>["orderItemsByCar"] = {};
  let orderUpdatesByCar: Awaited<ReturnType<typeof fetchOrderItemsAndUpdatesByCars>>["orderUpdatesByCar"] = {};
  let itemsError: string | null = null;
  let updatesError: string | null = null;

  if (!summaryOnly) {
    const carsPack = await fetchCarsForOrderTracking({ includeShipped: options?.includeShipped !== false });
    cars = carsPack.cars;
    carsError = carsPack.error;
    const itemsPack = await fetchOrderItemsAndUpdatesByCars(cars);
    orderItemsByCar = itemsPack.orderItemsByCar;
    orderUpdatesByCar = itemsPack.orderUpdatesByCar;
    itemsError = itemsPack.itemsError;
    updatesError = itemsPack.updatesError;
  }

  const dataWarnings = [
    summaryOnly ? "Summary-only mode: ยังไม่โหลดรายการรถ (เน้นเปิดหน้าเร็วสุด)" : null,
    carsError,
    saleSummaryError,
    summarySnapshotError,
    itemsError,
    updatesError,
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
    saleStatusSummaryAllCars,
    summarySnapshotAllCars,
    dataWarnings,
    initialFocusedOrderId,
    shareBaseUrl,
  };
}
