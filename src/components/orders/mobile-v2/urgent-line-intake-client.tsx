"use client";

import { useRouter } from "next/navigation";
import React, { useMemo, useState } from "react";
import type { Car } from "@/types/car";
import {
  carLabelForIntake,
  carsMatchingQuery,
  parseUrgentLinePaste,
  suggestSearchQueryFromVehicleLine,
} from "@/lib/orders/urgent-line-intake";

const cn = (...v: Array<string | false | null | undefined>) => v.filter(Boolean).join(" ");

type AiItemKind = "work" | "parts";

type AiItemRow = {
  label: string;
  kind: AiItemKind;
  existing_match: string;
  matched_existing_label: string | null;
};

export type UrgentLineIntakePanelProps = {
  cars: Car[];
  carsError: string | null;
  /** หลังบันทึกหรือกดเพิ่มรายการ — เลื่อนไปการ์ดรถในรายการหลัก */
  onScrollToOrderByCar?: (ctx: { car_row_id: string | null; car_id: number | null }) => void;
};

function findCarByIds(cars: Car[], rowId: string | null, carId: number | null): Car | null {
  if (rowId) {
    const c = cars.find((x) => String(x.row_id ?? "").trim() === rowId);
    if (c) return c;
  }
  if (carId != null) {
    return cars.find((x) => Number(x.id) === carId || String(x.id) === String(carId)) ?? null;
  }
  return null;
}

function normalizeAiItemsFromPayload(items: unknown): AiItemRow[] {
  if (!Array.isArray(items)) return [];
  const out: AiItemRow[] = [];
  for (const x of items) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const label = String(r.label ?? "").trim();
    if (!label) continue;
    const em = String(r.existing_match ?? "new").toLowerCase();
    const existing_match = em === "duplicate" || em === "similar" ? em : "new";
    const matched = r.matched_existing_label != null ? String(r.matched_existing_label).trim() || null : null;
    const k = String(r.kind ?? "").toLowerCase();
    const kind: AiItemKind = k === "parts" || k === "part" || k === "accessory" ? "parts" : "work";
    out.push({ label, kind, existing_match, matched_existing_label: matched });
  }
  return out;
}

/** งานด่วน LINE — ฝังใต้ช่องค้นหาทะเบียนในหน้า /m/orders */
export function UrgentLineIntakePanel({ cars, carsError, onScrollToOrderByCar }: UrgentLineIntakePanelProps) {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [carQuery, setCarQuery] = useState("");
  const [selected, setSelected] = useState<Car | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [aiLoading, setAiLoading] = useState(false);
  const [aiPreview, setAiPreview] = useState<{
    items: AiItemRow[];
    plate_summary_th: string;
    plate_search_query: string;
    confidence_note_th: string;
  } | null>(null);
  /** ถ้าไม่ null ใช้รายการนี้แทน heuristic ตอนบันทึก (ไม่รวม manual เสริม) */
  const [commitLabels, setCommitLabels] = useState<string[] | null>(null);
  const [manualExtraLines, setManualExtraLines] = useState<string[]>([]);
  const [manualAddDraft, setManualAddDraft] = useState("");

  const parsed = useMemo(() => parseUrgentLinePaste(raw), [raw]);

  const filteredCars = useMemo(() => carsMatchingQuery(cars, carQuery), [cars, carQuery]);

  const effectiveItems = useMemo(() => {
    const base = commitLabels ?? parsed.items.map((s) => s.trim()).filter(Boolean);
    const extra = manualExtraLines.map((s) => s.trim()).filter(Boolean);
    return [...base, ...extra];
  }, [commitLabels, parsed.items, manualExtraLines]);

  const scrollIfSelected = () => {
    if (!selected || !onScrollToOrderByCar) return;
    const rowId = String(selected.row_id ?? "").trim() || null;
    const carId = selected.id != null && Number.isFinite(Number(selected.id)) ? Number(selected.id) : null;
    onScrollToOrderByCar({ car_row_id: rowId, car_id: carId });
  };

  const runAi = async () => {
    if (!raw.trim()) {
      setMessage("วางข้อความก่อน");
      return;
    }
    setAiLoading(true);
    setMessage("");
    setAiPreview(null);
    setCommitLabels(null);
    setManualExtraLines([]);
    setManualAddDraft("");
    try {
      const rowId = selected ? String(selected.row_id ?? "").trim() || null : null;
      const carId = selected?.id != null && Number.isFinite(Number(selected.id)) ? Number(selected.id) : null;
      const res = await fetch("/api/m/urgent-line/ai-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw,
          ...(rowId ? { car_row_id: rowId } : {}),
          ...(carId != null ? { car_id: carId } : {}),
        }),
      });
      const payload = (await res.json()) as {
        ok?: boolean;
        code?: string;
        message?: string;
        error?: string;
        ai?: {
          plate_summary_th: string;
          plate_search_query?: string;
          confidence_note_th: string;
          items: unknown;
          chosen_car_row_id: string | null;
          chosen_car_id: number | null;
        };
      };

      if (res.status === 503 && (payload.code === "no_gemini" || payload.code === "no_openai")) {
        setMessage(payload.message ?? "ยังไม่ได้ตั้ง GEMINI_API_KEY");
        return;
      }
      if (!res.ok) throw new Error(payload.error ?? payload.message ?? res.statusText);
      if (!payload.ok || !payload.ai) throw new Error("ตอบจาก AI ไม่สมบูรณ์");

      const { ai } = payload;
      const rows = normalizeAiItemsFromPayload(ai.items);
      const plateQ = String(ai.plate_search_query ?? "").trim();
      setAiPreview({
        items: rows,
        plate_summary_th: ai.plate_summary_th,
        plate_search_query: plateQ,
        confidence_note_th: ai.confidence_note_th,
      });
      const toSave = rows
        .filter((x) => String(x.existing_match ?? "").toLowerCase() !== "duplicate")
        .map((x) => x.label.trim())
        .filter(Boolean);
      setCommitLabels(toSave);
      if (toSave.length === 0 && rows.length > 0) {
        setMessage("AI ระบุว่ารายการจากข้อความซ้ำกับในระบบทั้งหมด — ไม่มีรายการใหม่จะบันทึก (แก้ข้อความหรือเลือกรถใหม่)");
      }

      const chosen = findCarByIds(cars, ai.chosen_car_row_id, ai.chosen_car_id);
      if (chosen) {
        setSelected(chosen);
        setCarQuery(
          suggestSearchQueryFromVehicleLine(
            String(chosen.plate_number ?? (plateQ || ai.plate_summary_th || ""))
          )
        );
      } else if (plateQ) {
        setCarQuery(plateQ);
      } else if (parsed.vehicleLine) {
        setCarQuery(suggestSearchQueryFromVehicleLine(parsed.vehicleLine));
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setAiLoading(false);
    }
  };

  const addManualLine = () => {
    const line = manualAddDraft.trim();
    if (!line) return;
    if (!selected) {
      setMessage("เลือกรถจากรายการก่อน แล้วค่อยเพิ่มรายการ");
      return;
    }
    setManualExtraLines((prev) => [...prev, line]);
    setManualAddDraft("");
    setMessage("");
    scrollIfSelected();
  };

  const save = async () => {
    if (!selected) {
      setMessage("เลือกรถจากรายการก่อน");
      return;
    }
    const items = effectiveItems;
    if (items.length === 0) {
      setMessage("ยังไม่มีรายการงาน — กดให้ AI ช่วย หรือเพิ่มรายการเอง");
      return;
    }
    const rowId = String(selected.row_id ?? "").trim() || null;
    const carId = selected.id != null && Number.isFinite(Number(selected.id)) ? Number(selected.id) : null;
    if (!rowId && carId == null) {
      setMessage("รถที่เลือกไม่มี row_id / id สำหรับบันทึก");
      return;
    }
    const scrollCtx = { car_row_id: rowId, car_id: carId };
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/m/order-intake/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          car_row_id: rowId,
          car_id: carId,
          full_plate: String(selected.plate_number ?? "").trim() || "-",
          car_label: carLabelForIntake(selected),
          items: items.map((label) => ({ label, status: "เช็ค", assignee_staff: null })),
        }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? res.statusText);
      setRaw("");
      setSelected(null);
      setAiPreview(null);
      setCommitLabels(null);
      setManualExtraLines([]);
      setManualAddDraft("");
      setMessage("บันทึกแล้ว");
      router.refresh();
      if (onScrollToOrderByCar) {
        window.setTimeout(() => onScrollToOrderByCar(scrollCtx), 200);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const badgeClass = (m: string) => {
    const x = m.toLowerCase();
    if (x === "duplicate") return "bg-amber-100 text-amber-900 ring-1 ring-amber-200/80";
    if (x === "similar") return "bg-sky-100 text-sky-900 ring-1 ring-sky-200/80";
    return "bg-slate-100 text-slate-700 ring-1 ring-slate-200/80";
  };

  const kindChip = (kind: AiItemKind) =>
    kind === "parts" ? (
      <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-orange-900">
        ของแต่ง
      </span>
    ) : (
      <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-900">
        งาน
      </span>
    );

  const workRows = aiPreview?.items.filter((r) => r.kind !== "parts") ?? [];
  const partRows = aiPreview?.items.filter((r) => r.kind === "parts") ?? [];

  const renderAiRows = (rows: AiItemRow[]) => (
    <ul className="mt-1 max-h-40 space-y-1.5 overflow-y-auto text-xs font-medium text-slate-800">
      {rows.map((row, i) => (
        <li key={i} className="flex flex-col gap-0.5 rounded-lg bg-white/80 px-2 py-1.5 ring-1 ring-slate-200/60">
          <div className="flex flex-wrap items-center gap-1.5">
            {kindChip(row.kind)}
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", badgeClass(row.existing_match))}>
              {row.existing_match}
            </span>
            <span className="min-w-0 flex-1 break-words">{row.label}</span>
          </div>
          {row.matched_existing_label ? (
            <span className="text-[10px] text-slate-600">เทียบกับ: {row.matched_existing_label}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="mt-2 border-t border-slate-200/80 pt-2">
      <div className="space-y-2">
      <div className="px-0.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-slate-900">งานด่วน (LINE)</h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
            <span className="font-bold text-slate-800">ให้ AI ช่วย</span> = แยกทะเบียน / งานบริการ / อะไหล่·ของแต่ง
            เทียบกับรายการเก่าในระบบ แล้วบันทึกเฉพาะที่ไม่ใช่ duplicate — เพิ่มรายการเองได้ถ้า AI ไม่ครบ
          </p>
        </div>
      </div>
      {carsError ? (
        <div className="rounded-xl bg-rose-50 px-2.5 py-2 text-xs font-medium text-rose-900">โหลดรถ: {carsError}</div>
      ) : null}

      <label className="block px-0.5">
        <span className="mb-1 block text-[11px] font-semibold text-slate-600">ข้อความดิบ</span>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={8}
          className="w-full resize-y rounded-2xl border-0 bg-slate-50 p-2.5 text-sm font-medium leading-relaxed text-slate-900 ring-1 ring-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          placeholder="วางข้อความจาก LINE…"
          spellCheck={false}
        />
      </label>
      <button
        type="button"
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => void runAi()}
        disabled={aiLoading}
        className="h-10 w-full rounded-2xl bg-violet-700 text-sm font-semibold text-white disabled:opacity-60 touch-manipulation"
      >
        {aiLoading ? "AI กำลังคิด…" : "ให้ AI ช่วย"}
      </button>

      {aiPreview ? (
        <div className="rounded-xl bg-violet-50/90 p-2.5 ring-1 ring-violet-200/70">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-800">สรุปจาก AI</div>
          <p className="mt-1 text-xs font-medium text-violet-950">{aiPreview.plate_summary_th}</p>
          {aiPreview.plate_search_query ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium text-violet-900">คำค้นทะเบียน: {aiPreview.plate_search_query}</span>
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => setCarQuery(aiPreview.plate_search_query)}
                className="rounded-full bg-violet-700 px-2.5 py-1 text-[10px] font-bold text-white touch-manipulation"
              >
                ใช้เป็นคำค้น
              </button>
            </div>
          ) : null}
          {aiPreview.confidence_note_th ? (
            <p className="mt-1 text-[11px] leading-snug text-violet-900/90">{aiPreview.confidence_note_th}</p>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-xl bg-slate-50/90 p-2.5 ring-1 ring-slate-200/60">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          รายการ
          {aiPreview
            ? " (จาก AI — แท็กซ้ำ/ใหม่ · บันทึกจะส่งเฉพาะที่ไม่ใช่ duplicate + รายการที่คุณเพิ่มเอง)"
            : ` (${parsed.items.length})`}
        </div>
        {aiPreview && aiPreview.items.length > 0 ? (
          <div className="mt-1 space-y-2">
            {workRows.length > 0 ? (
              <div>
                <div className="text-[10px] font-bold text-emerald-800">งานบริการ / ช่าง</div>
                {renderAiRows(workRows)}
              </div>
            ) : null}
            {partRows.length > 0 ? (
              <div>
                <div className="text-[10px] font-bold text-orange-800">อะไหล่ / ของแต่ง</div>
                {renderAiRows(partRows)}
              </div>
            ) : null}
          </div>
        ) : parsed.items.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">ยังไม่พบบรรทัดที่ขึ้นต้นด้วย -</p>
        ) : (
          <ol className="mt-1 max-h-36 list-decimal space-y-1 overflow-y-auto pl-4 text-xs font-medium text-slate-800">
            {parsed.items.map((line, i) => (
              <li key={i} className="break-words">
                {line}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="rounded-xl bg-slate-50/90 p-2.5 ring-1 ring-slate-200/60">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">เพิ่มรายการเอง (ถ้า AI ไม่ครบ)</div>
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            value={manualAddDraft}
            onChange={(e) => setManualAddDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addManualLine();
              }
            }}
            placeholder="พิมพ์รายการแล้วกดเพิ่ม — ต้องเลือกรถก่อน"
            className="min-w-0 flex-1 rounded-2xl bg-white px-2.5 py-2 text-xs font-medium text-slate-900 outline-none ring-1 ring-slate-200 focus-visible:ring-2 focus-visible:ring-slate-400"
            autoComplete="off"
          />
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={addManualLine}
            className="h-10 shrink-0 rounded-2xl bg-slate-950 px-3 text-xs font-bold text-white touch-manipulation"
          >
            เพิ่ม
          </button>
        </div>
        {manualExtraLines.length > 0 ? (
          <ul className="mt-2 max-h-24 space-y-1 overflow-y-auto text-[11px] font-medium text-slate-800">
            {manualExtraLines.map((line, i) => (
              <li key={`${i}-${line}`} className="flex items-start justify-between gap-2 rounded-lg bg-white/90 px-2 py-1 ring-1 ring-slate-200/60">
                <span className="min-w-0 break-words">{line}</span>
                <button
                  type="button"
                  className="shrink-0 text-[10px] font-bold text-rose-600 touch-manipulation"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => setManualExtraLines((prev) => prev.filter((_, j) => j !== i))}
                >
                  ลบ
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="rounded-xl bg-slate-50/90 p-2.5 ring-1 ring-slate-200/60">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-slate-600">เลือกรถ (แก้ได้ถ้า AI เลือกผิด)</span>
          <input
            type="text"
            value={carQuery}
            onChange={(e) => setCarQuery(e.target.value)}
            className="w-full rounded-2xl bg-white px-2.5 py-2 text-sm font-medium text-slate-900 outline-none ring-1 ring-slate-200 focus-visible:ring-2 focus-visible:ring-slate-400"
            placeholder="ทะเบียน / เลขถัง / รุ่น"
            autoComplete="off"
          />
        </label>
        <div className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
          {filteredCars.map((car) => {
            const active =
              selected != null &&
              String(selected.id) === String(car.id) &&
              String(selected.row_id ?? "") === String(car.row_id ?? "");
            return (
              <button
                key={`${car.row_id ?? ""}-${car.id}`}
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => setSelected(car)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 rounded-xl px-2.5 py-1.5 text-left text-xs transition-colors touch-manipulation",
                  active ? "bg-slate-950 text-white" : "bg-white text-slate-800 ring-1 ring-slate-200/80 hover:bg-slate-50"
                )}
              >
                <span className="font-semibold">{String(car.plate_number ?? "").trim() || "—"}</span>
                <span className={cn("line-clamp-2", active ? "text-white/85" : "text-slate-600")}>{carLabelForIntake(car)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {message ? (
        <p className={cn("px-0.5 text-xs font-semibold", message === "บันทึกแล้ว" ? "text-emerald-700" : "text-rose-700")}>{message}</p>
      ) : null}

      <button
        type="button"
        disabled={saving || !selected || effectiveItems.length === 0}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => void save()}
        className="h-10 w-full rounded-2xl bg-emerald-700 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 touch-manipulation"
      >
        {saving ? "กำลังบันทึก…" : aiPreview ? "ยืนยันบันทึก" : "บันทึกลงงานรถนี้"}
      </button>
      </div>
    </div>
  );
}
