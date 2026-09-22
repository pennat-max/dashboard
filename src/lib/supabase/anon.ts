import { createClient } from "@supabase/supabase-js";

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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: fetchNoStore,
    },
  });
}
