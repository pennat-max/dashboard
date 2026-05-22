import { NextResponse } from "next/server";
import { requireMutateRole } from "@/lib/auth/mutation-guard";
import { translateItemNameToEnglish } from "@/lib/orders/item-name-translation";

/**
 * ตรวจว่ามี key สำหรับแปลหรือไม่ และทดสอบแปลสั้น (ไม่บันทึก DB)
 * POST body ไม่บังคับ: { "test": "ข้อความไทยทดสอบ" }
 */
export async function POST(request: Request) {
  const gate = await requireMutateRole();
  if (!gate.ok) return gate.response;

  let body: { test?: string } = {};
  try {
    body = (await request.json()) as { test?: string };
  } catch {
    /* optional body */
  }

  const groq = Boolean(process.env.GROQ_API_KEY?.trim());
  const gemini = Boolean(process.env.GEMINI_API_KEY?.trim());

  const sample = String(body.test ?? "").trim() || "เปลี่ยนยางหน้า";

  const t0 = Date.now();
  let translated: string | null = null;
  let error: string | undefined;
  try {
    translated = await translateItemNameToEnglish(sample);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const ms = Date.now() - t0;

  let hint: string | undefined;
  if (!groq && !gemini) {
    hint =
      "ตั้ง GEMINI_API_KEY หรือ GROQ_API_KEY ใน .env.local (หรือ Environment Variables บน Vercel) แล้วรีสตาร์ท / redeploy";
  } else if (!translated && !error) {
    hint = "มี API key แล้วแต่ได้คำว่าง — เช็คโควตา Groq/Gemini หรือดู log เทอร์มินัลเซิร์ฟเวอร์";
  }

  return NextResponse.json({
    ok: true,
    providers: { groq, gemini },
    sample_thai: sample,
    label_en: translated,
    ms,
    ...(error ? { error } : {}),
    ...(hint ? { hint } : {}),
  });
}
