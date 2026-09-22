import { createSiteDataClient } from "@/lib/site/db-client";

/**
 * Next.js จะ cache ผล fetch เริ่มต้น — response จาก Supabase ใหญ่ (เช่น มี raw_data) เกิน 2MB จะ error
 * "Failed to set Next.js data cache"
 */
function fetchNoStore(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
): ReturnType<typeof fetch> {
  return fetch(input, {
    ...init,
    cache: "no-store",
  });
}

/**
 * Client สำหรับอ่านข้อมูลแบบไม่ล็อกอิน — ไม่ใช้ cookie/session
 */
export function createAnonClient() {
  return createSiteDataClient();
}
