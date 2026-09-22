import { getLineLiffId } from "@/lib/line/liff-config";

/**
 * ลิงก์เปิดการ์ดจากข้อความแชร์ LINE
 * — ถ้ามี `NEXT_PUBLIC_LINE_LIFF_ID` ใช้ `https://liff.line.me/…?order=` (เปิดใน LINE)
 * — ไม่มี → ลิงก์สั้นบนโดเมนแอป `/m/o?o=` (รีไดเร็กไป `/m/orders?order=`)
 */
export function buildOrderTrackingShareOpenUrl(orderId: string, webAppBase: string): string {
  const liffId = getLineLiffId();
  if (liffId) {
    return `https://liff.line.me/${liffId}?order=${encodeURIComponent(orderId)}`;
  }
  const base = String(webAppBase ?? "").trim().replace(/\/$/, "");
  if (!base) return "";
  return `${base}/m/o?o=${encodeURIComponent(orderId)}`;
}
