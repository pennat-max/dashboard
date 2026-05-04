/**
 * คำนวณ KPI ใหม่จาก DB — logic เดียวกับแอป (computeDashboardKpi / excludeCancelledCars)
 * รัน: npx tsx scripts/recalc-kpi.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal(): void {
  const p = resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) {
    console.error("ไม่พบ .env.local — วางไฟล์ที่ root โปรเจกต์แล้วลองใหม่");
    process.exit(1);
  }
  const raw = readFileSync(p, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

async function main(): Promise<void> {
  const {
    fetchCarsForDashboard,
    computeDashboardKpi,
    excludeCancelledCars,
    isCancelledStatus,
  } = await import("../src/lib/data/cars");
  const { isBookedNotExported } = await import("../src/lib/car-fields");

  console.log("กำลังดึงข้อมูลจาก Supabase…");
  const { cars, error } = await fetchCarsForDashboard();
  if (error) {
    console.error("ดึงข้อมูลไม่สำเร็จ:", error);
    process.exit(1);
  }

  const kpi = computeDashboardKpi(cars);
  const cancelled = cars.filter((c) => isCancelledStatus(c)).length;
  const bookedRaw = cars.filter((c) => isBookedNotExported(c)).length;
  const rows = excludeCancelledCars(cars);

  console.log("");
  console.log("—— สรุป (หลังตัดสถานะ cancel / ยกเลิก — เหมือนแอป) ——");
  console.log("จำนวนแถวทั้งหมด (รวมยกเลิก):", cars.length);
  console.log("แถวที่ถือว่ายกเลิก (ไม่นับใน KPI):", cancelled);
  console.log("แถวที่ใช้คำนวณ KPI:", rows.length);
  console.log("");
  console.log("จอง (ยังไม่ส่งออก) — buyer ไม่ว่าง, shipped ว่าง, booked_shipping ว่าง:", kpi.bookedNotExportedCount);
  console.log("ส่งออกแล้ว:", kpi.exportedCount);
  console.log("พร้อมขาย:", kpi.availableCount);
  console.log("มูลค่ารวม (บาท, จาก buy_price/price_thb):", kpi.totalValueThb);
  console.log("");
  console.log("—— เทียบ ——");
  console.log("จอง (ก่อนตัดยกเลิก) — ถ้านับ buyer+สองช่องว่าง รวมแถวยกเลิก:", bookedRaw);

  const nz = (s: string | null | undefined) => Boolean((s ?? "").trim());
  const countBuyer = cars.filter((c) => nz(c.buyer)).length;
  const countShipped = cars.filter((c) => nz(c.shipped)).length;
  const countBookedShip = cars.filter((c) => nz(c.booked_shipping)).length;
  const arithAll = countBuyer - countShipped - countBookedShip;

  const rowsNoCancel = excludeCancelledCars(cars);
  const countBuyerKpi = rowsNoCancel.filter((c) => nz(c.buyer)).length;
  const countShippedKpi = rowsNoCancel.filter((c) => nz(c.shipped)).length;
  const countBookedShipKpi = rowsNoCancel.filter((c) => nz(c.booked_shipping)).length;
  const arithKpi = countBuyerKpi - countShippedKpi - countBookedShipKpi;

  console.log("");
  console.log("—— นับแยกคอลัมน์ (ไม่ใช่ logic เดียวกับ «จอง» ในแอป) ——");
  console.log("ทุกแถว: มี buyer:", countBuyer, "| มี shipped:", countShipped, "| มี booked_shipping:", countBookedShip);
  console.log("สูตร buyer - shipped - booked_shipping (ตัวเลขลบกัน):", arithAll);
  console.log("");
  console.log("หลังตัดยกเลิก: มี buyer:", countBuyerKpi, "| มี shipped:", countShippedKpi, "| มี booked_shipping:", countBookedShipKpi);
  console.log("สูตร buyer - shipped - booked_shipping:", arithKpi);
  console.log("(แถวเดียวอาจถูกนับหลายครั้งใน shipped/booked_shipping — สูตรนี้ไม่เท่ากับจำนวนแถวที่ «มี buyer แต่สองช่องว่าง»)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
