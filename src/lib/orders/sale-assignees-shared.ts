import { STAFF_ROSTER_MAX_NAME_LEN } from "@/lib/orders/staff-roster-shared";

/** รหัสเซลล์ (ตรงกับชิปกรอง — ยกเว้น ALL) */
export const ORDER_TRACKING_SALE_CODES = [
  "AOR",
  "BAM",
  "FAH",
  "FAIRY",
  "GOOD",
  "GWANG",
  "KOI",
  "MAI",
  "NAT",
  "NOEY",
  "PANG",
  "PLOO",
  "SINE",
  "TARN",
  "WAN",
  "YING",
] as const;

export type OrderTrackingSaleCode = (typeof ORDER_TRACKING_SALE_CODES)[number];

const SALE_CODE_UPPER = new Map<string, OrderTrackingSaleCode>(
  ORDER_TRACKING_SALE_CODES.map((c) => [c.toUpperCase(), c])
);

/** จำกัด key เป็นชุดรหัสเซลล์ที่รู้จัก + trim ชื่อพนักงาน */
export function normalizeSaleAssigneesMap(input: unknown): Partial<Record<OrderTrackingSaleCode, string>> {
  const out: Partial<Record<OrderTrackingSaleCode, string>> = {};
  if (!input || typeof input !== "object") return out;
  const raw = input as Record<string, unknown>;
  for (const [k, v] of Object.entries(raw)) {
    const code = SALE_CODE_UPPER.get(String(k).trim().toUpperCase());
    if (!code) continue;
    const name = typeof v === "string" ? v.trim().slice(0, STAFF_ROSTER_MAX_NAME_LEN) : "";
    if (name) out[code] = name;
  }
  return out;
}

/** คืนชื่อพนักงานที่ผูกกับเซลล์ของรถ (ตาม order.sale / sale_support) */
export function resolveSaleStaffForOrder(orderSale: string, assignees: Record<string, string>): string {
  const m = assignees as Record<string, string>;
  const raw = String(orderSale ?? "").trim();
  if (!raw) return "";
  if (m[raw]) return String(m[raw]).trim();
  const canon = SALE_CODE_UPPER.get(raw.toUpperCase());
  if (canon && m[canon]) return String(m[canon]).trim();
  return "";
}
