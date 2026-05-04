import type { Car } from "@/types/car";
import { excludeCancelledCars } from "@/lib/data/cars";
import {
  carPriceNumber,
  daysSinceBookedDate,
  isCarSoldOrClosedDeal,
  modelYearBucket,
  modelYearFieldLabel,
} from "@/lib/car-fields";
import { format, parseISO, startOfMonth } from "date-fns";

export type StatusCount = {
  status: string;
  count: number;
  /** รวม buy_price (และ price_thb ถ้าไม่มี buy_price) — คันที่ไม่มีราคานับเป็น 0 */
  totalValueThb: number;
};

export function aggregateByStatus(cars: Car[]): StatusCount[] {
  const rows = excludeCancelledCars(cars);
  const countMap = new Map<string, number>();
  const valueMap = new Map<string, number>();
  for (const c of rows) {
    const key = (c.status ?? "").trim() || "unknown";
    countMap.set(key, (countMap.get(key) ?? 0) + 1);
    const p = carPriceNumber(c) ?? 0;
    valueMap.set(key, (valueMap.get(key) ?? 0) + p);
  }
  return Array.from(countMap.entries())
    .map(([status, count]) => ({
      status,
      count,
      totalValueThb: valueMap.get(status) ?? 0,
    }))
    .sort((a, b) => b.count - a.count);
}

export type MonthlyCount = { month: string; label: string; count: number };

function carEventDate(c: Car): string | null {
  return (
    c.updated_at ??
    c.income_date ??
    c.advance_date ??
    c.created_at ??
    null
  );
}

export function aggregateByMonth(cars: Car[], maxMonths = 12): MonthlyCount[] {
  const rows = excludeCancelledCars(cars);
  const map = new Map<string, number>();
  for (const c of rows) {
    const dateStr = carEventDate(c);
    if (!dateStr) continue;
    try {
      const d = parseISO(dateStr);
      const key = format(startOfMonth(d), "yyyy-MM");
      map.set(key, (map.get(key) ?? 0) + 1);
    } catch {
      // skip invalid dates
    }
  }
  const sortedKeys = Array.from(map.keys()).sort();
  const tail = sortedKeys.slice(-maxMonths);
  return tail.map((key) => ({
    month: key,
    label: format(parseISO(`${key}-01`), "MMM yyyy"),
    count: map.get(key) ?? 0,
  }));
}

export function uniqueDestinations(cars: Car[]): string[] {
  const rows = excludeCancelledCars(cars);
  const set = new Set<string>();
  for (const c of rows) {
    const co = c.country?.trim();
    const port = c.destination_port?.trim();
    const legacy = c.destination_country?.trim();
    if (co) set.add(co);
    if (port) set.add(port);
    if (legacy) set.add(legacy);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function uniqueStatuses(cars: Car[]): string[] {
  const rows = excludeCancelledCars(cars);
  const set = new Set<string>();
  for (const c of rows) {
    if (c.status?.trim()) {
      set.add(c.status.trim());
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** รวมราคา = ผลรวม buy_price (หรือ price_thb) ของแถวนั้น — ไม่มีราคานับเป็น 0 */
export type BuyerCount = {
  buyer: string;
  count: number;
  totalValueThb: number;
  /** จำนวนคันที่ days booked > 7 (ใส่เมื่อ aggregate รองรับ เช่น sale support) */
  countBookedOver7Days?: number;
};

/**
 * แยกตามผู้ซื้อ — ใช้กับแถวที่ส่งออกแล้ว (shipped หรือ booked_shipping ไม่ว่าง) เท่านั้น
 * แถวไม่มี buyer จะรวมเป็น "(ไม่ระบุผู้ซื้อ)"
 */
/** ค่าในแผนที่ aggregate — แสดงภาษาใน UI ผ่าน i18n */
export const BUYER_UNKNOWN_LABEL = "(ไม่ระบุผู้ซื้อ)";

/**
 * นับรถตามค่า model_year เท่านั้น — ชื่อกลุ่มอยู่ฟิลด์ `buyer` เพื่อใช้กับ EntityCountBarChart
 */
export function aggregateByModelYearBucket(cars: Car[], unknownLabel: string, limit = 48): BuyerCount[] {
  const map = new Map<string, { count: number; totalValueThb: number }>();
  for (const c of cars) {
    const label = modelYearFieldLabel(c, unknownLabel);
    const prev = map.get(label) ?? { count: 0, totalValueThb: 0 };
    const p = carPriceNumber(c) ?? 0;
    map.set(label, { count: prev.count + 1, totalValueThb: prev.totalValueThb + p });
  }
  const yearRank = (label: string): number => {
    if (label === unknownLabel) return Number.NEGATIVE_INFINITY;
    const m = label.match(/\b(19|20)\d{2}\b/);
    return m ? Number(m[0]) : Number.NEGATIVE_INFINITY + 1;
  };
  return Array.from(map.entries())
    .map(([buyer, v]) => ({ buyer, count: v.count, totalValueThb: v.totalValueThb }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return yearRank(b.buyer) - yearRank(a.buyer);
    })
    .slice(0, limit);
}

export function aggregateByBuyerAmongShipped(shippedCars: Car[]): BuyerCount[] {
  const rows = excludeCancelledCars(shippedCars);
  const map = new Map<string, { count: number; totalValueThb: number }>();
  for (const c of rows) {
    const b = (c.buyer ?? "").trim() || BUYER_UNKNOWN_LABEL;
    const prev = map.get(b) ?? { count: 0, totalValueThb: 0 };
    const p = carPriceNumber(c) ?? 0;
    map.set(b, { count: prev.count + 1, totalValueThb: prev.totalValueThb + p });
  }
  return Array.from(map.entries())
    .map(([buyer, v]) => ({ buyer, count: v.count, totalValueThb: v.totalValueThb }))
    .sort((a, b) => b.count - a.count || a.buyer.localeCompare(b.buyer, "th"));
}

/** นับเฉพาะแถวที่มี buyer ไม่ว่าง — เรียงจำนวนมากสุดก่อน */
export function aggregateByBuyer(cars: Car[], limit = 25): BuyerCount[] {
  const rows = excludeCancelledCars(cars);
  const map = new Map<string, { count: number; totalValueThb: number }>();
  for (const c of rows) {
    const b = (c.buyer ?? "").trim();
    if (!b) continue;
    const prev = map.get(b) ?? { count: 0, totalValueThb: 0 };
    const p = carPriceNumber(c) ?? 0;
    map.set(b, { count: prev.count + 1, totalValueThb: prev.totalValueThb + p });
  }
  return Array.from(map.entries())
    .map(([buyer, v]) => ({ buyer, count: v.count, totalValueThb: v.totalValueThb }))
    .sort((a, b) => b.count - a.count || a.buyer.localeCompare(b.buyer, "th"))
    .slice(0, limit);
}

export type AgentRange = "currentMonth" | "last3Months" | "twoMonthsAgo" | "all";
export type AgentBuyerScope = "all" | "beForward" | "stock";

function isInRangeByIncomeDate(
  incomeDate: Date,
  now: Date,
  range: AgentRange
): boolean {
  if (range === "all") return true;
  const nowMonthIndex = now.getFullYear() * 12 + now.getMonth();
  const incomeMonthIndex = incomeDate.getFullYear() * 12 + incomeDate.getMonth();
  const diff = nowMonthIndex - incomeMonthIndex;
  if (range === "currentMonth") return diff === 0;
  if (range === "twoMonthsAgo") return diff === 2;
  return diff === 1;
}

/** นับเฉพาะแถวที่มี agent ไม่ว่าง (buyer = BE FORWARD) — เรียงจำนวนมากสุดก่อน */
export function aggregateByAgent(
  cars: Car[],
  range: AgentRange = "currentMonth",
  buyerScope: AgentBuyerScope = "beForward",
  limit?: number
): BuyerCount[] {
  const rows = excludeCancelledCars(cars);
  const now = new Date();
  const map = new Map<string, { count: number; totalValueThb: number }>();
  for (const c of rows) {
    if (buyerScope === "beForward") {
      const buyer = (c.buyer ?? "").trim().toLowerCase();
      if (buyer !== "be forward") continue;
    } else if (buyerScope === "stock") {
      const buyer = (c.buyer ?? "").trim().toLowerCase();
      if (buyer === "be forward") continue;
    }

    const incomeRaw = (c.income_date ?? "").trim();
    if (!incomeRaw) continue;
    try {
      const income = parseISO(incomeRaw);
      if (!isInRangeByIncomeDate(income, now, range)) continue;
    } catch {
      continue;
    }

    const a = (c.agent ?? "").trim();
    if (!a) continue;
    const prev = map.get(a) ?? { count: 0, totalValueThb: 0 };
    const p = carPriceNumber(c) ?? 0;
    map.set(a, { count: prev.count + 1, totalValueThb: prev.totalValueThb + p });
  }
  const groupedRows = Array.from(map.entries())
    .map(([buyer, v]) => ({ buyer, count: v.count, totalValueThb: v.totalValueThb }))
    .sort((x, y) => y.count - x.count || x.buyer.localeCompare(y.buyer, "th"));
  if (typeof limit === "number" && limit > 0) {
    return groupedRows.slice(0, limit);
  }
  return groupedRows;
}

/** ค่าในแผนที่ aggregate — แสดงภาษาใน UI ผ่าน i18n */
export const SALE_SUPPORT_UNKNOWN_LABEL = "(ไม่ระบุ sale support)";

/**
 * แยกตาม sale_support — ใช้ฟิลด์ buyer ใน BuyerCount เป็นชื่อกลุ่ม (เข้ากับ BuyerBarChart)
 * แถวว่างรวมเป็น SALE_SUPPORT_UNKNOWN_LABEL
 */
export function aggregateBySaleSupport(cars: Car[], limit = 80): BuyerCount[] {
  const map = new Map<
    string,
    { count: number; totalValueThb: number; countBookedOver7Days: number }
  >();
  for (const c of cars) {
    const s = (c.sale_support ?? "").trim() || SALE_SUPPORT_UNKNOWN_LABEL;
    const prev = map.get(s) ?? { count: 0, totalValueThb: 0, countBookedOver7Days: 0 };
    const p = carPriceNumber(c) ?? 0;
    const days = daysSinceBookedDate(c);
    const over7 = days != null && days > 7 ? 1 : 0;
    map.set(s, {
      count: prev.count + 1,
      totalValueThb: prev.totalValueThb + p,
      countBookedOver7Days: prev.countBookedOver7Days + over7,
    });
  }
  return Array.from(map.entries())
    .map(([buyer, v]) => ({
      buyer,
      count: v.count,
      totalValueThb: v.totalValueThb,
      countBookedOver7Days: v.countBookedOver7Days,
    }))
    .sort((a, b) => b.count - a.count || a.buyer.localeCompare(b.buyer, "th"))
    .slice(0, limit);
}

export type ModelYearInsight = {
  topYear: string;
  soldCount: number;
  remainingInStock: number;
};

/**
 * ปี (model year bucket) ที่ขายดี = จำนวนคันที่ถือว่า "ขาย/ดีลปิด" มากสุด
 * "เหลือ" = คันที่ยังไม่ปิดดีล ในปีเดียวกัน (ยังอยู่ในสต็อก/คงค้าง)
 */
export function computeModelYearInsight(cars: Car[]): ModelYearInsight | null {
  const rows = excludeCancelledCars(cars);
  const sold = rows.filter(isCarSoldOrClosedDeal);
  if (sold.length === 0) return null;

  const map = new Map<string, number>();
  for (const c of sold) {
    const y = modelYearBucket(c);
    map.set(y, (map.get(y) ?? 0) + 1);
  }

  const sorted = Array.from(map.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0], "th");
  });
  const first = sorted[0];
  if (!first) return null;
  const [topYear, topCount] = first;

  const remainingInStock = rows.filter(
    (c) => modelYearBucket(c) === topYear && !isCarSoldOrClosedDeal(c)
  ).length;

  return { topYear, soldCount: topCount, remainingInStock };
}
