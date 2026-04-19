/**
 * ลิงก์เว็บที่ผู้ใช้เปิดจริง
 * 1) NEXT_PUBLIC_APP_URL ใน .env / Vercel (ใส่โดเมนหรือ URL เต็ม — แก้ที่เดียวได้)
 * 2) บน Vercel ถ้าไม่ใส่ จะใช้ VERCEL_URL อัตโนมัติ
 */
export function getPublicSiteUrl(): string | null {
  const manual = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (manual) {
    const u = manual.replace(/\/$/, "");
    if (u.startsWith("http://") || u.startsWith("https://")) return u;
    return `https://${u}`;
  }
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${host}`;
  }
  return null;
}
