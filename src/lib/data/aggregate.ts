import type { Car } from "@/types/car";
import { isCarSoldOrClosedDeal, modelYearBucket } from "@/lib/car-fields";
import { format, parseISO, startOfMonth } from "date-fns";

export type StatusCount = { status: string; count: number };

export function aggregateByStatus(cars: Car[]): StatusCount[] {
  const map = new Map<string, number>();
  for (const c of cars) {
    const key = (c.status ?? "").trim() || "unknown";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([status, count]) => ({ status, count }))
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
  const map = new Map<string, number>();
  for (const c of cars) {
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
  const set = new Set<string>();
  for (const c of cars) {
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
  const set = new Set<string>();
  for (const c of cars) {
    if (c.status?.trim()) {
      set.add(c.status.trim());
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export type BuyerCount = { buyer: string; count: number };

/** นับเฉพาะแถวที่มี buyer ไม่ว่าง — เรียงจำนวนมากสุดก่อน */
export function aggregateByBuyer(cars: Car[], limit = 25): BuyerCount[] {
  const map = new Map<string, number>();
  for (const c of cars) {
    const b = (c.buyer ?? "").trim();
    if (!b) continue;
    map.set(b, (map.get(b) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([buyer, count]) => ({ buyer, count }))
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
  const sold = cars.filter(isCarSoldOrClosedDeal);
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

  const remainingInStock = cars.filter(
    (c) => modelYearBucket(c) === topYear && !isCarSoldOrClosedDeal(c)
  ).length;

  return { topYear, soldCount: topCount, remainingInStock };
}
