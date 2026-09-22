/** ดึงเบอร์ WhatsApp สำหรับลิงก์ wa.me — ตั้ง `NEXT_PUBLIC_EXPORT_WHATSAPP_PHONE` เป็นตัวเลขอย่างเดียว เช่น 66812345678 */
export function getExportWhatsAppDigits(): string | null {
  const raw = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_EXPORT_WHATSAPP_PHONE?.trim() ?? "" : "";
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

export function buildWaMeUrl(phoneDigits: string, message: string): string {
  const text = message.trim();
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${phoneDigits.replace(/\D/g, "")}${q}`;
}
