import Link from "next/link";
import { LineInboxQueueExampleMock } from "@/components/orders/mobile-v2/line-inbox-queue-example";

export const dynamic = "force-dynamic";

export default function LineAiExamplePage() {
  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6">
      <div className="mx-auto max-w-lg">
        <p className="mb-4">
          <Link href="/m/orders" className="text-sm font-medium text-violet-700 underline underline-offset-2">
            ← กลับ Order Tracking
          </Link>
        </p>
        <h1 className="mb-2 text-lg font-bold text-slate-900">ตัวอย่างชิป AI · LINE (10 คัน)</h1>
        <p className="mb-6 text-sm text-slate-600">
          หน้านี้แสดงเฉพาะหน้าตาแบบจำลอง — ไม่เชื่อมฐานข้อมูล / ไม่เชื่อม LINE
        </p>
        <LineInboxQueueExampleMock />
      </div>
    </div>
  );
}
