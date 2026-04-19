import type { Car } from "@/types/car";

/** หัวข้อหลักสำหรับรายการ / หน้า detail */
export function carTitleLine(car: Car): string {
  const a = (car.brand ?? car.make ?? "").trim();
  const b = (car.model ?? "").trim();
  const joined = [a, b].filter(Boolean).join(" ");
  if (joined) return joined;
  return (car.spec ?? "").trim() || "รายละเอียดรถ";
}

export function carStockLabel(car: Car): string | null {
  return (car.plate_number ?? car.stock_code ?? "").trim() || null;
}

export function carPriceNumber(car: Car): number | null {
  const v = car.buy_price ?? car.price_thb;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function carDestinationLabel(car: Car): string | null {
  const c = (car.country ?? "").trim();
  const p = (car.destination_port ?? "").trim();
  if (c && p) return `${c} — ${p}`;
  return c || p || (car.destination_country ?? "").trim() || null;
}

/** แสดงในตาราง — ไม่มีข้อมูลเป็น "—" */
export function modelYearDisplay(car: Car): string {
  const y = car.c_year ?? car.year;
  if (y != null && y !== "") return String(y);
  const my = car.model_year?.trim();
  if (my) {
    const m = my.match(/\b(19|20)\d{2}\b/);
    if (m) return m[0];
  }
  return "—";
}

/**
 * จัดกลุ่มสถิติ — ไม่มีปีชัดเจนเป็น "ไม่ระบุปี"
 * (ใช้ c_year / model_year เหมือน modelYearDisplay)
 */
export function modelYearBucket(car: Car): string {
  const y = car.c_year ?? car.year;
  if (y != null && y !== "") return String(y).trim();
  const my = car.model_year?.trim();
  if (my) {
    const m = my.match(/\b(19|20)\d{2}\b/);
    if (m) return m[0];
  }
  return "ไม่ระบุปี";
}

/** ส่งออกแล้ว — ใช้คอลัมน์ shipped เป็นหลัก */
export function isCarExported(car: Car): boolean {
  return Boolean((car.shipped ?? "").trim());
}

/**
 * ถือว่า "ขาย/ดีลปิด" สำหรับสถิติ — ใช้จัดอันดับปีที่ขายดี / ผู้ซื้อ
 * (ถ้าต้องการนิยามอื่น แจ้งได้เพื่อปรับเงื่อนไข)
 */
export function isCarSoldOrClosedDeal(car: Car): boolean {
  if ((car.buyer ?? "").trim()) return true;
  if ((car.shipped ?? "").trim()) return true;
  const s = (car.status ?? "").toLowerCase();
  return /sold|ขาย|shipped|export|ส่งออก|delivered|complete/.test(s);
}
