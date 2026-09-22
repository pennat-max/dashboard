import Link from "next/link";

const SAMPLE_CARD_URL = "https://liff.line.me/2009973514-VUSvnNgg?order=OT-demo";

const SAMPLE_SHARE_TEXT = `🚗 กย-312 ROCCO 4WD 2.8 Hight AT Double_Cab BRONZE Oct20
🔖 เลขถัง · MR0BA3CD600124961
📌 Sale · YING · จอง
👤 ลูกค้า · ZAIDI
🚢 รอบเรือ · รอบ 5/2026
💵 ราคาขาย · $28,500
────────
📋 รายการงาน (4)
▫️ กรอไมล์ 44000 km · เช็ค
▫️ เก็บงานให้เรียบร้อย · เช็ค
▫️ เปลี่ยนแม็ก · เช็ค
▫️ เปลี่ยนยาง · เช็ค
────────
🔗 เปิดการ์ดในแอป
${SAMPLE_CARD_URL}`;

export default function LineSharePreviewPage() {
  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <div>
        <p className="text-muted-foreground text-sm">ตัวอย่างการออกแบบ — แชร์ LINE ใช้ข้อความธรรมดา (ไม่ใช่ Flex Message)</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">การ์ดงาน + ข้อความที่ส่งเข้า LINE</h1>
      </div>

      <div className="rounded-2xl border border-emerald-200/80 bg-[#e6f4ea] p-4 shadow-sm">
        <p className="text-[13px] leading-relaxed text-emerald-950">
          <span className="font-medium">งาน กย-312</span>
          <br />
          ROCCO 4WD 2.8 Hight AT Double_Cab BRONZE Oct20
          <br />
          MR0BA3CD600124961
        </p>
        <div className="mt-3 space-y-1 text-[13px] text-emerald-950">
          <p>
            <span className="text-emerald-800/80">Sale:</span> YING
          </p>
          <p>
            <span className="text-emerald-800/80">ลูกค้า:</span> ZAIDI
          </p>
          <p>
            <span className="text-emerald-800/80">รอบเรือ:</span> รอบ 5/2026
          </p>
          <p>
            <span className="text-emerald-800/80">ราคาขาย:</span> $28,500
          </p>
        </div>
        <p className="mt-3 text-[12px] font-medium text-emerald-900">รายการงาน (4)</p>
        <ul className="mt-1 space-y-1 text-[13px] text-emerald-950">
          <li>▫️ กรอไมล์ 44000 km · เช็ค</li>
          <li>▫️ เก็บงานให้เรียบร้อย · เช็ค</li>
          <li>▫️ เปลี่ยนแม็ก · เช็ค</li>
          <li>▫️ เปลี่ยนยาง · เช็ค</li>
        </ul>
        <div className="mt-4 space-y-2 border-t border-emerald-300/50 pt-3 text-[12px]">
          <p className="text-emerald-800/90">ลิงก์เปิดการ์ดในแอป (แตะแล้วเปิดเบราว์เซอร์)</p>
          <a
            href={SAMPLE_CARD_URL}
            className="block break-all text-blue-700 underline underline-offset-2"
          >
            {SAMPLE_CARD_URL}
          </a>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-foreground">ข้อความดิบที่ส่งผ่าน LINE (ตัวอย่าง)</h2>
        <pre className="mt-2 max-h-[320px] overflow-auto rounded-lg border bg-muted/40 p-3 text-[11px] leading-snug">
          {SAMPLE_SHARE_TEXT}
        </pre>
      </div>

      <p className="text-muted-foreground text-xs">
        ในแอปจริง ถ้ามี <code className="rounded bg-muted px-1 py-0.5">NEXT_PUBLIC_LINE_LIFF_ID</code> ปุ่มแชร์จะใช้{" "}
        <code className="rounded bg-muted px-1 py-0.5">https://liff.line.me/…?order=…</code> (เปิดใน LINE) มิฉะนั้นใช้ลิงก์สั้น{" "}
        <code className="rounded bg-muted px-1 py-0.5">/m/o?o=…</code> บนโดเมนแอป — ไม่แนบลิงก์รูปรถในข้อความ
      </p>

      <Link href="/m/orders" className="text-primary inline-block text-sm font-medium underline-offset-4 hover:underline">
        ← กลับหน้ารายการงาน
      </Link>
    </div>
  );
}
