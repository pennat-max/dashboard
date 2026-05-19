import {
  fetchCarsForOrderTrackingDetailsByKeys,
  fetchCarsIndexForOrderTracking,
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

export const ORDER_TRACKING_DETAIL_BATCH_SIZE = 50;

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
  let initialDetailCars: Awaited<ReturnType<typeof fetchCarsForOrderTracking>>["cars"] = [];
  let carsError: string | null = null;
  let detailCarsError: string | null = null;
  let limitedByMaxCars = false;
  let maxCars: number | null = null;
  let totalCount: number | null = null;
  let orderItemsByCar: Awaited<ReturnType<typeof fetchOrderItemsAndUpdatesByCars>>["orderItemsByCar"] = {};
  let orderUpdatesByCar: Awaited<ReturnType<typeof fetchOrderItemsAndUpdatesByCars>>["orderUpdatesByCar"] = {};
  let itemsError: string | null = null;
  let updatesError: string | null = null;

  if (!summaryOnly) {
    const carsPack = await fetchCarsIndexForOrderTracking({ includeShipped: options?.includeShipped !== false });
    cars = carsPack.cars;
    carsError = carsPack.error;
    limitedByMaxCars = carsPack.limitedByMaxCars === true;
    maxCars = carsPack.maxCars ?? null;
    totalCount = carsPack.totalCount ?? null;

    const initialKeys = cars.slice(0, ORDER_TRACKING_DETAIL_BATCH_SIZE).map((car) => ({
      rowId: String(car.row_id ?? "").trim() || null,
      id: car.id ?? null,
    }));
    const detailPack = await fetchCarsForOrderTrackingDetailsByKeys(initialKeys);
    initialDetailCars = detailPack.cars.length > 0 ? detailPack.cars : cars.slice(0, ORDER_TRACKING_DETAIL_BATCH_SIZE);
    detailCarsError = detailPack.error;

    const itemsPack = await fetchOrderItemsAndUpdatesByCars(initialDetailCars);
    orderItemsByCar = itemsPack.orderItemsByCar;
    orderUpdatesByCar = itemsPack.orderUpdatesByCar;
    itemsError = itemsPack.itemsError;
    updatesError = itemsPack.updatesError;
  }

  const dataWarnings = [
    summaryOnly ? "Summary-only mode: ยังไม่โหลดรายการรถ (เน้นเปิดหน้าเร็วสุด)" : null,
    limitedByMaxCars
      ? `ตัวเลขสัมพันธ์จากรายการที่โหลดอยู่ (ORDER_TRACKING_MAX_CARS=${maxCars ?? "?"}${totalCount ? ` จากทั้งหมด ${totalCount}` : ""})`
      : null,
    carsError,
    detailCarsError,
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
    initialDetailCarsData: initialDetailCars,
    orderItemsByCar,
    orderUpdatesByCar,
    progressiveDetailsEnabled: !summaryOnly,
    progressiveDetailBatchSize: ORDER_TRACKING_DETAIL_BATCH_SIZE,
    saleStatusSummaryAllCars,
    summarySnapshotAllCars,
    dataWarnings,
    initialFocusedOrderId,
    shareBaseUrl,
  };
}
