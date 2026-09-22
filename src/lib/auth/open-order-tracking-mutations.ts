/**
 * Order Tracking API — ปิดการเขียนแบบไม่ล็อกอินเป็นค่าเริ่มต้น
 * เปิดเฉพาะกรณีที่ตั้ง `OPEN_ORDER_TRACKING_MUTATIONS=true` โดยเจตนาเท่านั้น
 */
export function isOpenOrderTrackingMutations(): boolean {
  const v = process.env.OPEN_ORDER_TRACKING_MUTATIONS?.trim();
  if (v === undefined || v === "") return false;
  const lower = v.toLowerCase();
  return lower === "true" || lower === "1" || lower === "on" || lower === "yes";
}
