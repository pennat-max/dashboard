"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DuplicateStatus, LineInboxAnalyzeItem, LineInboxAnalyzeResponse } from "@/lib/line-inbox/types";

type RowDraft = LineInboxAnalyzeItem & {
  action: "skip" | "create" | "merge";
  note: string;
};

function defaultAction(item: LineInboxAnalyzeItem): RowDraft["action"] {
  if (item.duplicate_status === "duplicate" && String(item.matched_order_item_id ?? "").trim()) {
    return "merge";
  }
  return "create";
}

function duplicateBadgeClass(status: DuplicateStatus): string {
  switch (status) {
    case "new":
      return "border-emerald-200 bg-emerald-50 text-emerald-950";
    case "duplicate":
      return "border-amber-200 bg-amber-50 text-amber-950";
    case "possible_duplicate":
      return "border-orange-200 bg-orange-50 text-orange-950";
    default:
      return "border-slate-200 bg-slate-100 text-slate-800";
  }
}

function duplicateLabelTh(status: DuplicateStatus): string {
  switch (status) {
    case "new":
      return "งานใหม่";
    case "duplicate":
      return "ซ้ำ";
    case "possible_duplicate":
      return "อาจซ้ำ";
    default:
      return "ไม่ชัด";
  }
}

type Props = {
  initialCarRowId?: string;
  initialCarId?: number | null;
};

export function LineInboxClient({ initialCarRowId = "", initialCarId = null }: Props) {
  const [rawText, setRawText] = useState("");
  const [carRowIdHint, setCarRowIdHint] = useState(initialCarRowId);
  const [carIdHint, setCarIdHint] = useState(
    initialCarId != null && Number.isFinite(initialCarId) ? String(initialCarId) : ""
  );
  const [lineInboxMessageId, setLineInboxMessageId] = useState("");

  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detected, setDetected] = useState<LineInboxAnalyzeResponse["detected_car"] | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [rows, setRows] = useState<RowDraft[]>([]);
  const [lastSaved, setLastSaved] = useState<{ taskId: string | null; count: number } | null>(null);

  const effectiveCarRowId = useMemo(() => {
    const fromAnalyze = String(detected?.car_row_id ?? "").trim();
    return fromAnalyze || String(carRowIdHint ?? "").trim();
  }, [detected, carRowIdHint]);

  const effectiveCarId = useMemo(() => {
    const t = String(carIdHint ?? "").trim();
    if (t && Number.isFinite(Number(t))) return Number(t);
    return null;
  }, [carIdHint]);

  const runAnalyze = useCallback(async () => {
    setError(null);
    setLastSaved(null);
    setAnalyzeLoading(true);
    try {
      const res = await fetch("/api/line-inbox/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_text: rawText,
          car_row_id: carRowIdHint.trim() || undefined,
          car_id: effectiveCarId,
          line_inbox_message_id: lineInboxMessageId.trim() || undefined,
        }),
      });
      const data = (await res.json()) as LineInboxAnalyzeResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || res.statusText || "analyze failed");
      }
      setDetected(data.detected_car);
      setNeedsReview(Boolean(data.needs_human_review));
      const next: RowDraft[] = (data.items ?? []).map((item) => ({
        ...item,
        action: defaultAction(item),
        note: item.suggested_note ?? "",
      }));
      setRows(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
      setDetected(null);
    } finally {
      setAnalyzeLoading(false);
    }
  }, [rawText, carRowIdHint, effectiveCarId, lineInboxMessageId]);

  const updateRow = useCallback((index: number, patch: Partial<RowDraft>) => {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r))
    );
  }, []);

  const runConfirm = useCallback(async () => {
    setError(null);
    setConfirmLoading(true);
    try {
      if (!effectiveCarRowId && effectiveCarId == null) {
        throw new Error("ต้องระบุรถ (car_row_id / car_id) หรือให้วิเคราะห์จับคู่รถได้ก่อนยืนยัน");
      }
      const confirmations = rows.map((r) => ({
        action: r.action,
        order_item_id: r.action === "merge" ? r.matched_order_item_id : undefined,
        item_name: r.suggested_item_name || r.raw_text,
        item_status: r.suggested_status || undefined,
        note: r.note.trim() || undefined,
      }));

      const res = await fetch("/api/line-inbox/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          car_row_id: effectiveCarRowId || undefined,
          car_id: effectiveCarId,
          line_inbox_message_id: lineInboxMessageId.trim() || undefined,
          confirmations,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        order_task_id?: string | null;
        saved?: Array<{ order_item_id: string }>;
        skipped_all?: boolean;
      };
      if (!res.ok) {
        throw new Error(data.error || res.statusText || "confirm failed");
      }
      const saved = data.saved ?? [];
      setLastSaved({
        taskId: data.order_task_id ?? null,
        count: data.skipped_all ? 0 : saved.length,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirmLoading(false);
    }
  }, [effectiveCarRowId, effectiveCarId, lineInboxMessageId, rows]);

  return (
    <div className="flex min-h-0 flex-col gap-4 bg-white px-3 py-4 text-sm text-slate-900">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">LINE Inbox → งานรถ</h1>
        <p className="text-[12px] leading-snug text-slate-600">
          วิเคราะห์ข้อความอัตโนมัติ (ไม่บันทึก) แล้วตรวจทานก่อนกดยืนยัน — เฉพาะขั้นยืนยันถึงเขียนลง order_items
        </p>
      </header>

      <section className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
          ข้อความดิบ
        </label>
        <textarea
          className="min-h-[120px] w-full resize-y rounded-md border border-slate-200 bg-white px-2 py-2 text-[13px] outline-none ring-slate-400 focus:ring-2"
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder="วางข้อความจาก LINE…"
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[11px] text-slate-600">
            car_row_id (ช่วยจับคู่)
            <input
              className="rounded border border-slate-200 px-2 py-1.5 text-[13px]"
              value={carRowIdHint}
              onChange={(e) => setCarRowIdHint(e.target.value)}
              placeholder="uuid จากตาราง cars"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-600">
            car_id (ทางเลือก)
            <input
              className="rounded border border-slate-200 px-2 py-1.5 text-[13px]"
              value={carIdHint}
              onChange={(e) => setCarIdHint(e.target.value)}
              inputMode="numeric"
              placeholder="ตัวเลข id ใน cars"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[11px] text-slate-600">
          line_inbox_message_id (อ้างอิงข้อความ — ไม่บังคับ)
          <input
            className="rounded border border-slate-200 px-2 py-1.5 text-[13px]"
            value={lineInboxMessageId}
            onChange={(e) => setLineInboxMessageId(e.target.value)}
          />
        </label>
        <Button
          type="button"
          className="w-full sm:w-auto"
          disabled={analyzeLoading || !rawText.trim()}
          onClick={() => void runAnalyze()}
        >
          {analyzeLoading ? "กำลังวิเคราะห์…" : "วิเคราะห์"}
        </Button>
      </section>

      {error ? (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-900"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {detected ? (
        <section className="space-y-2 rounded-lg border border-slate-200 p-3">
          <h2 className="text-[13px] font-semibold text-slate-800">รถที่ตรวจจับ</h2>
          <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[12px]">
            <dt className="text-slate-500">ทะเบียน</dt>
            <dd className="font-medium">{detected.plate_text || "—"}</dd>
            <dt className="text-slate-500">เลขตัวถัง</dt>
            <dd className="break-all font-mono text-[11px]">{detected.chassis || "—"}</dd>
            <dt className="text-slate-500">car_row_id</dt>
            <dd className="break-all font-mono text-[11px]">{detected.car_row_id || "—"}</dd>
            <dt className="text-slate-500">ความมั่นใจ</dt>
            <dd>{Math.round((detected.confidence ?? 0) * 100)}%</dd>
          </dl>
          {needsReview ? (
            <p className="text-[12px] text-amber-800">
              ระบบแนะนำให้ตรวจทานเพิ่ม (รถไม่ชัด / งานอาจซ้ำ / ไม่มีบรรทัดงาน)
            </p>
          ) : null}
        </section>
      ) : null}

      {rows.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold text-slate-800">รายการงาน ({rows.length})</h2>
          <ul className="space-y-3">
            {rows.map((row, i) => (
              <li
                key={`${row.raw_text}-${i}`}
                className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      duplicateBadgeClass(row.duplicate_status)
                    )}
                  >
                    {duplicateLabelTh(row.duplicate_status)}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    ความมั่นใจ {Math.round(row.confidence * 100)}%
                  </span>
                </div>
                <p className="text-[12px] text-slate-600">{row.reason}</p>
                <label className="block text-[11px] font-medium text-slate-600">ชื่องาน</label>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-[13px]"
                  value={row.suggested_item_name}
                  onChange={(e) => updateRow(i, { suggested_item_name: e.target.value })}
                />
                <label className="block text-[11px] font-medium text-slate-600">สถานะที่เสนอ</label>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-[13px]"
                  value={row.suggested_status}
                  onChange={(e) => updateRow(i, { suggested_status: e.target.value })}
                />
                <label className="block text-[11px] font-medium text-slate-600">หมายเหตุ (ไม่บังคับ)</label>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-[13px]"
                  value={row.note}
                  onChange={(e) => updateRow(i, { note: e.target.value })}
                  placeholder="เพิ่มบริบทให้ร้าน / พนักงาน"
                />
                {row.matched_order_item_id ? (
                  <p className="text-[11px] text-slate-600">
                    งานเดิมที่จับคู่:{" "}
                    <span className="font-mono">{row.matched_order_item_id}</span>
                    {row.matched_item_name ? (
                      <>
                        {" "}
                        · <span>{row.matched_item_name}</span>
                      </>
                    ) : null}
                  </p>
                ) : null}
                <label className="flex flex-col gap-1 text-[11px] text-slate-600">
                  การทำงาน
                  <select
                    className="rounded border border-slate-200 px-2 py-2 text-[13px]"
                    value={row.action}
                    onChange={(e) =>
                      updateRow(i, { action: e.target.value as RowDraft["action"] })
                    }
                  >
                    <option value="skip">ข้าม</option>
                    <option value="create">สร้างงานใหม่</option>
                    <option
                      value="merge"
                      disabled={!String(row.matched_order_item_id ?? "").trim()}
                    >
                      รวมกับงานเดิม (ต้องมีรหัสงานจับคู่)
                    </option>
                  </select>
                </label>
              </li>
            ))}
          </ul>

          <Button
            type="button"
            className="w-full"
            disabled={
              confirmLoading ||
              (!effectiveCarRowId && effectiveCarId == null)
            }
            onClick={() => void runConfirm()}
          >
            {confirmLoading ? "กำลังบันทึก…" : "ยืนยันบันทึกลงระบบ"}
          </Button>

          {lastSaved ? (
            <p className="text-center text-[12px] text-emerald-800">
              บันทึกแล้ว {lastSaved.count} รายการ
              {lastSaved.taskId ? (
                <>
                  {" "}
                  · order_task_id:{" "}
                  <span className="font-mono">{lastSaved.taskId}</span>
                </>
              ) : null}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
