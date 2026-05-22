import { cn } from "@/lib/utils";

/** 4 คันแรก 3 บรรทัด · 6 คันหลัง 2 บรรทัด = 24 บรรทัด */
const LINES_PER_CARD = [3, 3, 3, 3, 2, 2, 2, 2, 2, 2] as const;
const PLATES = [
  "กข-1234 กทม.",
  "ขค-2345 ชลบุรี",
  "คง-3456 กทม.",
  "งจ-4567 นครปฐม",
  "จฉ-5678 ภูเก็ต",
  "ฉช-6789 เชียงใหม่",
  "ชซ-7890 ขอนแก่น",
  "ซฌ-8901 โคราช",
  "ฌญ-9012 อุบล",
  "ญฎ-0123 หาดใหญ่",
] as const;

const LINE_LABELS = ["ตัดโอน", "เช็คภาษี", "สั่งของ"];

/**
 * ตัวอย่าง UI ชิป AI · LINE + คิว เมื่อมี 10 คัน (ข้อมูลจำลอง ไม่เรียก API)
 */
export function LineInboxQueueExampleMock() {
  const distinctCars = PLATES.length;
  const totalLines = LINES_PER_CARD.reduce((a, b) => a + b, 0);
  const cardCount = PLATES.length;
  const badgeTotal = totalLines;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
        <span className="font-semibold">โหมดตัวอย่าง:</span> สมมติมีข้อความในกลุ่ม LINE{" "}
        <strong>{cardCount}</strong> ก้อน (คนละคัน) · รวม{" "}
        <strong>{totalLines}</strong> บรรทัดที่ระบบถือว่าเป็นงานใหม่ (ไม่ซ้ำ)
      </p>

      <p className="text-xs text-slate-600">
        บนชิป: ตัวเลขวงแดง = งานใหม่ทั้งหมด (รวมบรรทัด) — บรรทัดย่อย = คันที่แยกได้ · จำนวนงาน
      </p>

      <div className="flex flex-wrap items-start gap-2">
        <button
          type="button"
          className={cn(
            "relative flex min-h-[52px] min-w-[5.25rem] max-w-[9rem] shrink-0 cursor-default flex-col items-center justify-center gap-0.5 rounded-xl bg-violet-700 px-2 py-2 text-center text-white shadow-sm ring-1 ring-violet-500/40"
          )}
          aria-hidden
        >
          <span className="line-clamp-2 max-w-full text-[11px] font-semibold leading-snug">AI · LINE</span>
          <span className="text-[10px] font-medium leading-tight opacity-90">งานใหม่</span>
          <span className="line-clamp-2 max-w-[5.5rem] text-[9px] font-semibold leading-tight text-white/90">
            {distinctCars} คัน · {totalLines} งาน
          </span>
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-bold text-white ring-2 ring-white">
            {badgeTotal > 99 ? "99+" : badgeTotal}
          </span>
        </button>
        <span className="self-center text-[11px] text-slate-500">
          ← แบบเดียวกับชิปบน Order Tracking หลังเปิดแผง AI · LINE
        </span>
      </div>

      <div className="rounded-2xl border border-violet-200 bg-white p-3 shadow-sm ring-1 ring-violet-100">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-violet-800">
          จากกลุ่ม LINE (คิว) — ตัวอย่าง
        </p>
        <p className="mb-1 text-[10px] leading-snug text-slate-600">
          เฉพาะงานใหม่ (ไม่ซ้ำ) · คันไม่ซ้ำ {distinctCars} · รวม {totalLines} งาน · การ์ดในคิว {cardCount}{" "}
          ใบ
        </p>
        <p className="mb-3 text-[9px] leading-snug text-slate-500">
          หลายคัน: เลื่อนดูการ์ดด้านล่าง (ข้อความเดียวกับแอปจริง)
        </p>
        <ul className="max-h-[min(55vh,360px)] space-y-3 overflow-y-auto overscroll-contain pr-1">
          {PLATES.map((plate, i) => {
            const n = LINES_PER_CARD[i];
            return (
              <li
                key={plate}
                className="rounded-xl border border-slate-200 bg-slate-50/90 p-2.5 ring-1 ring-slate-100"
              >
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
                  <span className="text-sm font-bold tabular-nums text-violet-950">
                    <span className="mr-1.5 text-[10px] font-semibold tabular-nums text-slate-500">
                      ({i + 1}/{cardCount})
                    </span>
                    ทะเบียน: {plate}
                  </span>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">
                    งานใหม่ {n} บรรทัด
                  </span>
                </div>
                <p className="mb-2 line-clamp-2 text-[10px] text-slate-500">
                  ข้อความต้นฉบับใน LINE … (ดูเต็มในแอป)
                </p>
                <ul className="space-y-2">
                  {Array.from({ length: n }, (_, j) => (
                    <li key={j}>
                      <div className="flex gap-2 rounded-lg bg-white/80 px-2 py-1.5 ring-1 ring-slate-200/80">
                        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-400 bg-white" />
                        <span className="min-w-0 flex-1 text-[12px] font-medium leading-snug text-slate-900">
                          {LINE_LABELS[j % LINE_LABELS.length]}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 rounded-lg bg-slate-900 py-2 text-center text-[11px] font-medium text-white opacity-40">
                  บันทึก ({n}) — ปุ่มจริงอยู่ใน Order Tracking
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
