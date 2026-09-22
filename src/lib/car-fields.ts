import { differenceInCalendarDays, parseISO } from "date-fns";
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
 * (ใช้ c_year / model_year)
 */
/** ป้ายปีแบบรวมฟิลด์ — c_year / year ก่อน แล้วดึง 19xx–20xx จาก model_year */
export function modelYearBucket(car: Car, unknownLabel = "ไม่ระบุปี"): string {
  const y = car.c_year ?? car.year;
  if (y != null && y !== "") return String(y).trim();
  const my = car.model_year?.trim();
  if (my) {
    const m = my.match(/\b(19|20)\d{2}\b/);
    if (m) return m[0];
  }
  return unknownLabel;
}

/** ค่าจากคอลัมน์ model_year เท่านั้น (trim) — ว่างใช้ unknownLabel (กราฟ Exported) */
export function modelYearFieldLabel(car: Car, unknownLabel: string): string {
  const my = (car.model_year ?? "").trim();
  return my || unknownLabel;
}

/** ส่งออกแล้ว — shipped หรือ booked_shipping มีค่า (อย่างใดอย่างหนึ่ง) */
export function isCarExported(car: Car): boolean {
  return (
    Boolean((car.shipped ?? "").trim()) ||
    Boolean((car.booked_shipping ?? "").trim())
  );
}

/** พร้อมขายในสต็อก — buyer, shipped, booked_shipping ว่างทั้งสาม (หลัง trim) */
export function isReadyForSaleStock(car: Car): boolean {
  return (
    !(car.buyer ?? "").trim() &&
    !(car.shipped ?? "").trim() &&
    !(car.booked_shipping ?? "").trim()
  );
}

/**
 * ยังไม่ลงเว็บ: พร้อมขาย + สถานะ P.Office + picture ว่าง
 */
export function isWebsitePending(car: Car): boolean {
  if (!isReadyForSaleStock(car)) return false;
  const status = (car.status ?? "").trim().toLowerCase();
  const isPOffice = /^p\.?\s*office$/i.test(status);
  if (!isPOffice) return false;
  return !(car.picture ?? "").trim();
}

/**
 * ยังไม่ลงเว็บ beforward: หลักเดียวกับ vigoasia แต่ดูจากคอลัมน์ BF on web มีคำว่า "Not"
 */
export function isWebsitePendingBeForward(car: Car): boolean {
  if (!isReadyForSaleStock(car)) return false;
  const status = (car.status ?? "").trim().toLowerCase();
  const isPOffice = /^p\.?\s*office$/i.test(status);
  if (!isPOffice) return false;
  const bfOnWeb = (car.bf_on_web ?? "").trim().toLowerCase();
  return bfOnWeb.includes("not");
}

/**
 * จองแล้วแต่ยังไม่ส่งออก — มี buyer และ shipped / booked_shipping ต้องว่างทั้งคู่ (หลัง trim)
 */
export function isBookedNotExported(car: Car): boolean {
  if (!(car.buyer ?? "").trim()) return false;
  if ((car.shipped ?? "").trim()) return false;
  if ((car.booked_shipping ?? "").trim()) return false;
  return true;
}

/**
 * จำนวนวันตั้งแต่ booked_date ถึงวันนี้ (ปฏิทิน) — ไม่มีวันที่หรือ parse ไม่ได้คืน null
 */
export function daysSinceBookedDate(car: Car): number | null {
  const raw = (car.booked_date ?? "").trim();
  if (!raw) return null;
  try {
    const d = raw.includes("T") ? parseISO(raw) : parseISO(`${raw.slice(0, 10)}T12:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return differenceInCalendarDays(new Date(), d);
  } catch {
    return null;
  }
}

/**
 * จำนวนวันตั้งแต่ income_date ถึงวันนี้ (ปฏิทิน) — ไม่มีวันที่หรือ parse ไม่ได้คืน null
 */
export function daysSinceIncomeDate(car: Car): number | null {
  const raw = (car.income_date ?? "").trim();
  if (!raw) return null;
  try {
    const d = raw.includes("T") ? parseISO(raw) : parseISO(`${raw.slice(0, 10)}T12:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return differenceInCalendarDays(new Date(), d);
  } catch {
    return null;
  }
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
