import {
  fetchCarsForOrderTracking,
  fetchOrderTrackingSaleStatusSummary,
  fetchOrderTrackingSummarySnapshot,
} from "@/lib/data/cars";
import { fetchOrderItemsAndUpdatesByCars } from "@/lib/data/orders";
import { getSessionAndRole } from "@/lib/auth/session-role";
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

/** ทำให้ข้อความ error จาก fetch/Supabase อ่านง่ายขึ้นบน UI */
function formatOrderTrackingDataWarning(msg: string): string {
  const t = msg.trim();
  if (/typeerror:\s*fetch failed/i.test(t) || /^fetch failed$/i.test(t)) {
    return [
      "เชื่อมต่อ Supabase ไม่สำเร็จ (fetch failed)",
      "ตรวจอินเทอร์เน็ตหรือ VPN, ค่า NEXT_PUBLIC_SUPABASE_URL และ NEXT_PUBLIC_SUPABASE_ANON_KEY ใน .env.local แล้วรีสตาร์ท dev server",
    ].join(" — ");
  }
  if (/fetch failed/i.test(t)) {
    return `${t} — มักเกิดจากเครือข่ายหรือค่า Supabase ใน .env.local ไม่ถูกต้อง`;
  }
  return msg;
}

export type OrderTrackingSearchParams = { order?: string | string[] };
type LoadOrderTrackingPageOptions = {
  /** โหมดทดลองความเร็ว: โหลดเฉพาะสรุป ไม่โหลดรถ/รายการ */
  summaryOnly?: boolean;
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
    const carsPack = await fetchCarsForOrderTracking();
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
  ]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map(formatOrderTrackingDataWarning);
  const initialFocusedOrderId = parseOrderSearchParam(searchParams?.order);
  const origin = resolveRequestOrigin();
  const shareBaseUrl = origin || null;

  const { user } = await getSessionAndRole();
  /** ยังไม่ล็อกอิน — หน้า Order Tracking แสดงเฉพาะรถสถานะขาย "ว่าง" */
  const guestVacantOnly = !user;

  return {
    carsData: cars,
    orderItemsByCar,
    orderUpdatesByCar,
    saleStatusSummaryAllCars,
    summarySnapshotAllCars,
    dataWarnings,
    initialFocusedOrderId,
    shareBaseUrl,
    guestVacantOnly,
  };
}
