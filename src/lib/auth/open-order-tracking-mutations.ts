/**
 * Order Tracking API — โดยค่าเริ่มต้นอนุญาตบันทึกโดยไม่ต้องมี Supabase session (ใช้งานได้ทันที)
 * ปิดการทำงานแบบเปิด — ตั้ง `OPEN_ORDER_TRACKING_MUTATIONS=false` แล้วใช้ login + role ตามปกติ
 */
export function isOpenOrderTrackingMutations(): boolean {
  const v = process.env.OPEN_ORDER_TRACKING_MUTATIONS?.trim();
  if (v === undefined || v === "") return true;
  const lower = v.toLowerCase();
  if (lower === "false" || lower === "0" || lower === "off" || lower === "no") return false;
  return true;
}
