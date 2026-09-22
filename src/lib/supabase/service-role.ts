import { createSiteDataClient } from "@/lib/site/db-client";

function fetchNoStore(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
): ReturnType<typeof fetch> {
  return fetch(input, { ...init, cache: "no-store" });
}

/** ลบ BOM + ตัด quote ที่บางครั้งติดมาจาก copy-paste ใน .env / Vercel */
function normalizeEnvValue(raw: string | undefined): string {
  const s = (raw ?? "").replace(/^\uFEFF/, "").trim();
  if (s.length >= 2) {
    const q = s[0];
    if ((q === '"' || q === "'") && s[s.length - 1] === q) {
      return s.slice(1, -1).trim();
    }
  }
  return s;
}

/**
 * อ่าน URL/คีย์สำหรับ service role — trim ช่องว่างต้น/ท้าย (เวลาวางใน .env บน Windows)
 * รองรับ `SUPABASE_URL` ถ้าไม่ได้ตั้ง `NEXT_PUBLIC_SUPABASE_URL` (บางเทมเพลตวางเฉพาะฝั่งเซิร์ฟเวอร์)
 */
function getServiceRoleEnv(): { url: string; key: string } {
  const url = normalizeEnvValue(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  );
  const key = normalizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return { url, key };
}

/** สำหรับตรวจว่า env พร้อมบันทึกหรือไม่ — ไม่ส่งค่าจริงออกไป */
export function getServiceRoleEnvDiagnostics(): {
  hasPublicUrl: boolean;
  hasSupabaseUrl: boolean;
  hasServiceRoleKey: boolean;
  ready: boolean;
} {
  const hasPublicUrl = Boolean(normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL));
  const hasSupabaseUrl = Boolean(normalizeEnvValue(process.env.SUPABASE_URL));
  const hasServiceRoleKey = Boolean(normalizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY));
  const { url, key } = getServiceRoleEnv();
  return {
    hasPublicUrl,
    hasSupabaseUrl,
    hasServiceRoleKey,
    ready: Boolean(url && key),
  };
}

/**
 * เฉพาะฝั่งเซิร์ฟเวอร์เท่านั้น — ใช้ `SUPABASE_SERVICE_ROLE_KEY`
 * เพื่อดำเนินการที่ RLS ไม่อนุญาตให้ role `anon`
 */
export function createServiceRoleClient() {
  return createSiteDataClient();
}
