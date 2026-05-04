"use client";

/**
 * Vigo4u — Order Tracking Mobile (ChatGPT-style mockup reference)
 *
 * ⚠️ REFERENCE ONLY — do not import from app routes or mix with Supabase reads.
 * Real implementation: src/components/orders/mobile-v2/mobile-order-tracking-home.tsx
 *
 * UX checklist this file mirrors:
 * 1. Sticky header + filter clusters (sale / sale-status / storage / staff / item status / search).
 * 2. Card: title line (plate display-only + spec + chassis for context; linking uses row_id in app).
 * 3. COST expand panel (aggregate + repair + document rows).
 * 4. Toolbar: เพิ่มงาน · สรุปจำนวน · แชร์.
 * 5. Item row: name · assignee · date chip for สั่ง/มา · status dropdown (+ หมายเหตุ).
 * 6. Second row: note field when open.
 * 7. ฝาก: Store 1 เดือน | ไปกับรถ (then locked in app).
 * 8. Inline intake block (paste LINE → split/compare → save).
 * 9. “ดูทั้งหมด” for completed rows.
 */

import React, { useState } from "react";

/** FAKE sample — not production data */
const SAMPLE_PLATE_DISPLAY = "71-331"; // plate_number UI only

const SAMPLE_ITEM_STATUSES = [
  "เช็ค",
  "มี",
  "ต้องสั่ง",
  "สั่ง",
  "มา",
  "รถนอก",
  "ช่างนอก",
  "ฝาก",
  "จบ",
] as const;

function cn(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function OrderTrackingMobileMockupReference() {
  const [costOpen, setCostOpen] = useState(false);
  const [noteHint, setNoteHint] = useState(true);

  return (
    <div className="mx-auto max-w-md space-y-2 bg-slate-100 p-2 text-slate-900">
      <p className="rounded-xl bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-900 ring-1 ring-amber-200">
        MOCKUP REFERENCE · ข้อมูลในหน้านี้เป็น fake — production ใช้ Supabase เท่านั้น
      </p>

      <header className="rounded-3xl bg-white/90 p-2 shadow-sm ring-1 ring-slate-100">
        <div className="mb-2 text-center text-[10px] font-black text-slate-400">ฟิลเตอร์ด้านบน (ตัวอย่าง)</div>
        <div className="grid grid-cols-4 gap-1">
          {SAMPLE_ITEM_STATUSES.slice(0, 8).map((s, i) => (
            <div key={s} className="rounded-xl bg-slate-50 py-2 text-center text-[10px] font-black ring-1 ring-slate-100">
              {s}
              <div className="text-sm">{i + 1}</div>
            </div>
          ))}
        </div>
      </header>

      <article className="rounded-[28px] border border-slate-200 bg-white p-3 shadow-sm ring-1 ring-white/70">
        <div className="mb-2 flex justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[15px] font-black leading-tight">
              {SAMPLE_PLATE_DISPLAY}{" "}
              <span className="font-black">SPEC …</span> <span className="text-[11px] font-semibold text-slate-400">CHASSIS…</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1 text-[11px] font-bold text-slate-600">
              <span className="rounded-full bg-slate-100 px-2 py-0.5">SALE</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5">buyer · $…</span>
              <button
                type="button"
                className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black ring-1 ring-slate-300"
                onClick={() => setCostOpen((o) => !o)}
              >
                COST {costOpen ? "⌃" : "⌄"}
              </button>
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-sky-50 px-2 py-1 text-[10px] font-black text-sky-700">4-8.5</span>
        </div>

        {costOpen ? (
          <div className="mb-2 rounded-3xl bg-slate-50 p-3 text-[11px] font-bold ring-1 ring-slate-100">
            <div className="mb-1 text-[10px] font-black text-slate-400">ต้นทุนรวม (cars.total_cost / buy_price)</div>
            <p className="leading-relaxed">…</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] font-black text-slate-400">ซ่อม</div>
                <p>repair_details</p>
              </div>
              <div>
                <div className="text-[10px] font-black text-slate-400">เอกสาร</div>
                <p>document_status · doc_fee …</p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mb-2 flex flex-nowrap gap-1.5 overflow-x-auto rounded-full bg-white py-1.5 shadow-sm ring-1 ring-slate-200/80">
          <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">เพิ่มงาน</span>
          <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold text-amber-800">รอ 2/5</span>
          <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">แชร์</span>
        </div>

        <div className="space-y-1">
          <div className="rounded-2xl bg-amber-50 px-3 py-2 ring-1 ring-amber-100">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
              <input readOnly placeholder="ชื่องาน" className="min-w-0 flex-1 bg-transparent font-black outline-none" value="ฟิล์มคู่หน้า" />
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <select className="rounded-full px-2 py-1 text-[10px] font-black ring-1 ring-slate-200" disabled>
                  <option>—</option>
                </select>
                <button type="button" className="rounded-full bg-sky-50 px-2 py-1 text-[10px] font-black text-sky-700 ring-1 ring-sky-100">
                  เลือกวันที่
                </button>
                <button type="button" className="rounded-full bg-sky-50 px-2 py-1 text-[10px] font-black text-sky-700 ring-1 ring-sky-100">
                  มา 2 พ.ค.
                </button>
                <select className="rounded-full px-2 py-1 text-[10px] font-black text-amber-700 ring-1 ring-amber-100" disabled>
                  <option>สั่ง</option>
                </select>
              </div>
            </div>
            {noteHint ? (
              <div className="mt-1 flex items-center gap-1 rounded-xl bg-white/70 px-2 py-1 ring-1 ring-slate-100">
                <span className="text-[10px] font-black text-sky-700">หมายเหตุ</span>
                <input readOnly placeholder="พิมพ์…" className="min-w-0 flex-1 bg-transparent text-[11px] font-bold outline-none" />
                <button type="button" className="text-[10px] font-black text-slate-500" onClick={() => setNoteHint(false)}>
                  เสร็จ
                </button>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl bg-amber-50 px-3 py-2 ring-1 ring-amber-100">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className="flex-1 font-black">เกจวัด</span>
              <div className="flex gap-1">
                <span className="rounded-full bg-amber-800/10 px-2 py-1 text-[10px] font-black text-amber-900">ฝาก</span>
                <button type="button" className="rounded-full bg-white px-2 py-1 text-[10px] font-black ring-1 ring-amber-100">
                  Store 1 เดือน
                </button>
                <button type="button" className="rounded-full bg-white px-2 py-1 text-[10px] font-black ring-1 ring-amber-100">
                  ไปกับรถ
                </button>
              </div>
            </div>
          </div>
        </div>

        <button type="button" className="mt-2 h-9 w-full rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-xs font-black text-slate-600">
          ดูทั้งหมด +จบแล้ว
        </button>

        <div className="mt-3 rounded-2xl bg-slate-50 p-2 ring-1 ring-slate-100">
          <div className="mb-1 text-[11px] font-black text-slate-500">Inline intake · คันนี้</div>
          <textarea readOnly placeholder="วางข้อความจาก LINE …" className="min-h-24 w-full rounded-2xl border border-white bg-white p-2 text-sm" />
          <button type="button" className="mt-2 h-10 w-full rounded-2xl bg-slate-950 text-sm font-black text-white">
            แยก + เทียบรายการเดิม
          </button>
          <button type="button" className="mt-2 h-9 w-full rounded-2xl bg-emerald-600 text-xs font-black text-white">
            เพิ่มรายการเข้ารถคันนี้
          </button>
        </div>
      </article>

      <p className="px-1 text-[10px] leading-relaxed text-slate-500">
        การเชื่อมข้อมูลจริง: identity = <code className="rounded bg-white px-0.5">cars.row_id</code> หลัก · fallback{" "}
        <code className="rounded bg-white px-0.5">chassis_number</code> เท่านั้นสำหรับความเข้ากันได้ — ห้ามใช้ plate เป็น key
      </p>
    </div>
  );
}

export default OrderTrackingMobileMockupReference;
