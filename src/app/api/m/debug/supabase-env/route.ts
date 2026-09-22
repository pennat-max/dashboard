import { NextResponse } from "next/server";
import { getServiceRoleEnvDiagnostics } from "@/lib/supabase/service-role";

/**
 * ตรวจว่า env สำหรับ API บันทึกพร้อมหรือไม่ (ไม่ส่งค่า key/url จริง)
 * บน production ก็ใช้ได้ — ส่งแค่ boolean เพื่อยืนยันว่า Vercel มีตัวแปรหรือไม่
 */
export async function GET() {
  const d = getServiceRoleEnvDiagnostics();
  const onVercel = Boolean(process.env.VERCEL);
  const hint = d.ready
    ? "Env looks OK; if save still fails, check key rotation and Supabase RLS."
    : onVercel
      ? "On Vercel, add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Project → Settings → Environment Variables, then redeploy."
      : "Add .env.local at the project root (next to package.json) with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then stop and start `npm run dev` again.";
  return NextResponse.json({
    ...d,
    runtime: onVercel ? "vercel" : "local-or-other",
    hint,
  });
}
