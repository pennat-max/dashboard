import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** อ่าน/เขียน session cookie — ใช้ใน Server Component / Route Handler (ไม่ใช้ใน middleware) */
export async function createServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          /* เรียกจาก Server Component ที่ไม่ set cookie ได้ — session อัปเดตจาก middleware อยู่แล้ว */
        }
      },
    },
  });
}
