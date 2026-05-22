"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  DuplicateStatus,
  LineInboxAnalyzeItem,
  LineInboxAnalyzeResponse,
} from "@/lib/line-inbox/types";
import { LineInboxCarAiByModelPeek } from "@/components/line-inbox/car-ai-by-model-peek";
import { LineInboxTaskLinesCompare } from "@/components/line-inbox/task-lines-compare";

export type LineInboxAiOrderPick = {
  id: string;
  fullPlate: string;
  car: string;
  carRowId: string | null;
  carId: number | null;
};

type UiLang = "th" | "en";

type PendingQueueNewLine = {
  item_index: number;
  raw_text: string;
  suggested_item_name: string;
  suggested_status: string;
  reason: string;
};

type PendingQueueMessage = {
  inbox_id: string;
  received_at: string;
  plate_display: string;
  car_row_id: string;
  raw_text_preview: string;
  new_lines: PendingQueueNewLine[];
  new_line_count: number;
  needs_human_review: boolean;
  image_public_url?: string | null;
};

type RowDraft = LineInboxAnalyzeItem & {
  action: "skip" | "create" | "merge";
  note: string;
  included: boolean;
};

function defaultAction(item: LineInboxAnalyzeItem): RowDraft["action"] {
  if (item.duplicate_status === "duplicate" && String(item.matched_order_item_id ?? "").trim()) {
    return "merge";
  }
  return "create";
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

export function LineInboxAiToolbar({
  orders,
  uiLang,
  preferredOrderId,
  onSaved,
}: {
  orders: LineInboxAiOrderPick[];
  uiLang: UiLang;
  preferredOrderId?: string | null;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [rawText, setRawText] = useState("");
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState<LineInboxAnalyzeResponse["detected_car"] | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  /** แยกบรรทัดงามด้วย rule เดิม หรือ LLM เมื่อข้อความยาว */
  const [taskLinesSource, setTaskLinesSource] = useState<LineInboxAnalyzeResponse["task_lines_source"]>(undefined);
  /** จาก split-line-text สำหรับเปรียบเทียบกับผลที่ใช้จริง */
  const [taskLinesHeuristic, setTaskLinesHeuristic] = useState<string[]>([]);
  const [taskLinesAiByModel, setTaskLinesAiByModel] = useState<{
    groq: string[];
    gemini: string[];
  } | null>(null);
  const [taskLinesChosenLlm, setTaskLinesChosenLlm] =
    useState<LineInboxAnalyzeResponse["task_lines_chosen_llm"]>(undefined);
  const [detectedCarAiByModel, setDetectedCarAiByModel] =
    useState<LineInboxAnalyzeResponse["detected_car_ai_by_model"]>(undefined);
  const [rows, setRows] = useState<RowDraft[]>([]);
  const [saveHint, setSaveHint] = useState<string | null>(null);

  const [queueMessages, setQueueMessages] = useState<PendingQueueMessage[]>([]);
  const [queueTotalNew, setQueueTotalNew] = useState(0);
  /** Unchecked = not saved when user clicks save (default: all lines selected) */
  const [queueDeselected, setQueueDeselected] = useState<Record<string, Set<number>>>({});
  const [queueLoading, setQueueLoading] = useState(false);
  const [savingInboxId, setSavingInboxId] = useState<string | null>(null);
  const queueSigRef = useRef<string>("");

  const fetchQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      const res = await fetch("/api/line-inbox/pending-queue", { credentials: "same-origin" });
      const data = (await res.json()) as {
        ok?: boolean;
        total_new_lines?: number;
        messages?: PendingQueueMessage[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || res.statusText);
      const list = data.messages ?? [];
      setQueueTotalNew(typeof data.total_new_lines === "number" ? data.total_new_lines : 0);
      setQueueMessages(list);

      const sig = list.map((m) => `${m.inbox_id}:${m.new_lines.map((l) => l.item_index).join(",")}`).join("|");
      if (sig !== queueSigRef.current) {
        queueSigRef.current = sig;
        const nextDes: Record<string, Set<number>> = {};
        for (const m of list) {
          nextDes[m.inbox_id] = new Set();
        }
        setQueueDeselected(nextDes);
      }
    } catch {
      setQueueMessages([]);
      setQueueTotalNew(0);
    } finally {
      setQueueLoading(false);
    }
  }, []);

  /** ไม่โพลล์พื้นหลัง — ดึงคิวเมื่อเปิดแผงนี้เท่านั้น (หลังบันทึกก็รีเฟรชใน handler) */
  useEffect(() => {
    if (!open) return;
    void fetchQueue();
  }, [open, fetchQueue]);

  useEffect(() => {
    if (orders.length === 0) {
      setSelectedOrderId("");
      return;
    }
    const pref = String(preferredOrderId ?? "").trim();
    if (pref && orders.some((o) => o.id === pref)) {
      setSelectedOrderId(pref);
      return;
    }
    setSelectedOrderId((prev) => {
      if (prev && orders.some((o) => o.id === prev)) return prev;
      return orders[0]?.id ?? "";
    });
  }, [orders, preferredOrderId]);

  const selected = useMemo(
    () => orders.find((o) => o.id === selectedOrderId) ?? null,
    [orders, selectedOrderId]
  );

  const effectiveCarRowId = useMemo(() => {
    const fromAnalyze = String(detected?.car_row_id ?? "").trim();
    return fromAnalyze || String(selected?.carRowId ?? "").trim();
  }, [detected, selected]);

  const effectiveCarId = useMemo(() => {
    const id = selected?.carId;
    return id != null && Number.isFinite(Number(id)) ? Number(id) : null;
  }, [selected]);

  const pendingSaveCount = useMemo(
    () => rows.filter((r) => r.included && r.action !== "skip").length,
    [rows]
  );

  const rawBadgeTotal = queueTotalNew + pendingSaveCount;
  const showBadgeDot = rawBadgeTotal > 0;

  /** จำนวน car_row_id ไม่ซ้ำในคิว (มักเท่าจำนวนคันที่คนละข้อความ) */
  const queueDistinctCarCount = useMemo(() => {
    const s = new Set<string>();
    for (const m of queueMessages) {
      const id = String(m.car_row_id ?? "").trim();
      if (id) s.add(id);
    }
    return s.size;
  }, [queueMessages]);
  const queueCardCount = queueMessages.length;

  const toggleQueueLine = useCallback((inboxId: string, itemIndex: number) => {
    setQueueDeselected((prev) => {
      const copy = { ...prev };
      const set = new Set(copy[inboxId] ?? []);
      if (set.has(itemIndex)) set.delete(itemIndex);
      else set.add(itemIndex);
      copy[inboxId] = set;
      return copy;
    });
  }, []);

  const selectedIndicesForInbox = useCallback(
    (m: PendingQueueMessage) => {
      const des = queueDeselected[m.inbox_id] ?? new Set();
      return m.new_lines.map((l) => l.item_index).filter((idx) => !des.has(idx));
    },
    [queueDeselected]
  );

  const saveQueueCard = useCallback(
    async (m: PendingQueueMessage) => {
      const indices = selectedIndicesForInbox(m);
      if (indices.length === 0) return;
      setSavingInboxId(m.inbox_id);
      setError(null);
      setSaveHint(null);
      try {
        const res = await fetch("/api/line-inbox/pending-save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            saves: [{ inbox_message_id: m.inbox_id, item_indices: indices }],
          }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok) throw new Error(data.error || res.statusText);
        setSaveHint(
          uiLang === "en"
            ? `Saved ${indices.length} new line(s) from LINE queue.`
            : `บันทึกจากคิว LINE แล้ว ${indices.length} งาน`
        );
        await fetchQueue();
        onSaved?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingInboxId(null);
      }
    },
    [fetchQueue, onSaved, selectedIndicesForInbox, uiLang]
  );

  const runAnalyze = useCallback(async () => {
    setError(null);
    setSaveHint(null);
    setAnalyzeLoading(true);
    try {
      const res = await fetch("/api/line-inbox/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_text: rawText,
          car_row_id: selected?.carRowId?.trim() || undefined,
          car_id: effectiveCarId,
        }),
      });
      const data = (await res.json()) as LineInboxAnalyzeResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || res.statusText || "analyze failed");
      setDetected(data.detected_car);
      setNeedsReview(Boolean(data.needs_human_review));
      setTaskLinesSource(data.task_lines_source);
      setTaskLinesHeuristic(Array.isArray(data.task_lines_heuristic) ? data.task_lines_heuristic : []);
      setTaskLinesAiByModel(
        data.task_lines_ai_by_model &&
          Array.isArray(data.task_lines_ai_by_model.groq) &&
          Array.isArray(data.task_lines_ai_by_model.gemini)
          ? { groq: data.task_lines_ai_by_model.groq, gemini: data.task_lines_ai_by_model.gemini }
          : null
      );
      setTaskLinesChosenLlm(data.task_lines_chosen_llm);
      setDetectedCarAiByModel(data.detected_car_ai_by_model);
      const next: RowDraft[] = (data.items ?? []).map((item) => ({
        ...item,
        action: defaultAction(item),
        note: "",
        included: true,
      }));
      setRows(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
      setDetected(null);
      setTaskLinesSource(undefined);
      setTaskLinesHeuristic([]);
      setTaskLinesAiByModel(null);
      setTaskLinesChosenLlm(undefined);
      setDetectedCarAiByModel(undefined);
    } finally {
      setAnalyzeLoading(false);
    }
  }, [rawText, selected, effectiveCarId]);

  const updateRow = useCallback((index: number, patch: Partial<RowDraft>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }, []);

  const runConfirm = useCallback(async () => {
    setError(null);
    setSaveHint(null);
    setConfirmLoading(true);
    try {
      if (!effectiveCarRowId && effectiveCarId == null) {
        throw new Error(
          uiLang === "en"
            ? "Pick a car from the list or run analyze so the car matches."
            : "เลือกรถจากรายการ หรือให้วิเคราะห์จับคู่รถได้ก่อนบันทึก"
        );
      }
      const confirmations = rows.map((r) => {
        if (!r.included) {
          return {
            action: "skip" as const,
            item_name: r.suggested_item_name || r.raw_text,
          };
        }
        return {
          action: r.action,
          order_item_id: r.action === "merge" ? r.matched_order_item_id : undefined,
          item_name: r.suggested_item_name || r.raw_text,
          item_status: r.suggested_status || undefined,
          note: r.note.trim() || undefined,
        };
      });

      const res = await fetch("/api/line-inbox/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          car_row_id: effectiveCarRowId || undefined,
          car_id: effectiveCarId,
          confirmations,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        saved?: Array<{ order_item_id: string }>;
        skipped_all?: boolean;
      };
      if (!res.ok) throw new Error(data.error || res.statusText || "confirm failed");
      const count = data.skipped_all ? 0 : (data.saved ?? []).length;
      setSaveHint(
        uiLang === "en" ? `Saved ${count} line(s).` : `บันทึกแล้ว ${count} รายการ`
      );
      setRows([]);
      setDetected(null);
      setTaskLinesSource(undefined);
      setTaskLinesHeuristic([]);
      setTaskLinesAiByModel(null);
      setTaskLinesChosenLlm(undefined);
      setDetectedCarAiByModel(undefined);
      setRawText("");
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirmLoading(false);
    }
  }, [effectiveCarRowId, effectiveCarId, rows, onSaved, uiLang]);

  return (
    <>
      <button
        type="button"
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative flex min-h-[52px] min-w-[5.25rem] max-w-[9rem] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-2 text-center transition-colors touch-manipulation",
          open
            ? "bg-violet-700 text-white shadow-sm ring-1 ring-violet-500/40"
            : "bg-violet-100 text-violet-950 ring-1 ring-violet-300/90 hover:bg-violet-200/90"
        )}
        aria-expanded={open}
        title={
          queueCardCount > 0
            ? uiLang === "en"
              ? `${queueDistinctCarCount} distinct cars · ${queueTotalNew} new lines · ${queueCardCount} queue cards + manual paste`
              : `คันไม่ซ้ำ ${queueDistinctCarCount} · งานใหม่ ${queueTotalNew} บรรทัด · การ์ด ${queueCardCount} ใบ (+วางข้อความเอง)`
            : uiLang === "en"
              ? "LINE group queue + paste to analyze"
              : "คิวจากกลุ่ม LINE + วางข้อความวิเคราะห์"
        }
      >
        <span className="line-clamp-2 max-w-full text-[11px] font-semibold leading-snug">AI · LINE</span>
        <span className="text-[10px] font-medium leading-tight opacity-90">
          {uiLang === "en" ? "new jobs" : "งานใหม่"}
        </span>
        {queueCardCount > 0 && !queueLoading ? (
          <span
            className={cn(
              "line-clamp-2 max-w-[5.5rem] text-[9px] font-semibold leading-tight opacity-95",
              open ? "text-white/90" : "text-violet-950/85"
            )}
          >
            {uiLang === "en"
              ? `${queueDistinctCarCount} cars · ${queueTotalNew} lines`
              : `${queueDistinctCarCount} คัน · ${queueTotalNew} งาน`}
          </span>
        ) : null}
        {showBadgeDot ? (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-bold text-white ring-2 ring-white">
            {rawBadgeTotal > 99 ? "99+" : rawBadgeTotal}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="w-full basis-full rounded-2xl border border-violet-200 bg-white p-3 shadow-sm ring-1 ring-violet-100">
          <div className="mb-3 border-b border-violet-100 pb-3">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-violet-800">
              {uiLang === "en" ? "From LINE group (queue)" : "จากกลุ่ม LINE (คิว)"}
            </p>
            <p className="mb-1 text-[10px] leading-snug text-slate-600">
              {queueCardCount > 0 && !queueLoading
                ? uiLang === "en"
                  ? `New lines only · ${queueDistinctCarCount} cars · ${queueTotalNew} jobs · ${queueCardCount} cards`
                  : `เฉพาะงานใหม่ (ไม่ซ้ำ) · คันไม่ซ้ำ ${queueDistinctCarCount} · รวม ${queueTotalNew} งาน · การ์ดในคิว ${queueCardCount} ใบ`
                : uiLang === "en"
                  ? `New non-duplicate lines only · ${queueTotalNew} total · loaded when you open this panel`
                  : `เฉพาะงานใหม่ (ไม่ซ้ำ) · รวม ${queueTotalNew} งาน · ดึงเมื่อเปิดแผงนี้`}
            </p>
            {queueCardCount > 1 && !queueLoading ? (
              <p className="mb-2 text-[9px] leading-snug text-slate-500">
                {uiLang === "en"
                  ? "Multiple cars: scroll the list below — same layout as /m/orders/line-ai-example"
                  : "หลายคัน: เลื่อนดูการ์ดด้านล่าง (แบบเดียวกับหน้า /m/orders/line-ai-example)"}
              </p>
            ) : null}
            {queueLoading ? (
              <p className="text-[11px] text-slate-500">{uiLang === "en" ? "Loading…" : "กำลังโหลด…"}</p>
            ) : queueMessages.length === 0 ? (
              <p className="text-[11px] text-slate-500">
                {uiLang === "en" ? "No pending new jobs from LINE." : "ยังไม่มีงานใหม่ค้างจาก LINE"}
              </p>
            ) : (
              <ul className="max-h-[min(55vh,360px)] space-y-3 overflow-y-auto overscroll-contain pr-1">
                {queueMessages.map((m, cardIndex) => {
                  const selectedIdx = selectedIndicesForInbox(m);
                  const cardPos = cardIndex + 1;
                  const multiCard = queueCardCount > 1;
                  return (
                    <li
                      key={m.inbox_id}
                      className="rounded-xl border border-slate-200 bg-slate-50/90 p-2.5 ring-1 ring-slate-100"
                    >
                      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
                        <span className="text-sm font-bold tabular-nums text-violet-950">
                          {multiCard ? (
                            <span className="mr-1.5 text-[10px] font-semibold tabular-nums text-slate-500">
                              ({cardPos}/{queueCardCount})
                            </span>
                          ) : null}
                          {uiLang === "en" ? "Plate" : "ทะเบียน"}: {m.plate_display || "—"}
                        </span>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">
                          {uiLang === "en" ? "New" : "งานใหม่"} {m.new_line_count}{" "}
                          {uiLang === "en" ? "lines" : "บรรทัด"}
                        </span>
                      </div>
                      {m.image_public_url ? (
                        <div className="mb-2 overflow-hidden rounded-lg ring-1 ring-slate-200/80">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={m.image_public_url}
                            alt=""
                            className="max-h-[min(200px,28vh)] w-full object-contain bg-slate-100"
                            loading="lazy"
                          />
                        </div>
                      ) : null}
                      {m.raw_text_preview ? (
                        <p className="mb-2 line-clamp-2 text-[10px] text-slate-500">{m.raw_text_preview}</p>
                      ) : null}
                      {m.needs_human_review ? (
                        <p className="mb-2 text-[10px] text-amber-800">
                          {uiLang === "en" ? "Car match may need review." : "รถยังควรตรวจซ้ำก่อนบันทึก"}
                        </p>
                      ) : null}
                      <ul className="mb-2 space-y-2">
                        {m.new_lines.map((line) => {
                          const des = queueDeselected[m.inbox_id]?.has(line.item_index) ?? false;
                          const checked = !des;
                          return (
                            <li key={line.item_index}>
                              <label className="flex cursor-pointer gap-2 rounded-lg bg-white/80 px-2 py-1.5 ring-1 ring-slate-200/80">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleQueueLine(m.inbox_id, line.item_index)}
                                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-400"
                                />
                                <span className="min-w-0 flex-1 text-[12px] font-medium leading-snug text-slate-900">
                                  {line.suggested_item_name || line.raw_text}
                                </span>
                              </label>
                              {line.reason ? (
                                <p className="ml-7 mt-0.5 text-[10px] text-slate-500">{line.reason}</p>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                      {!m.car_row_id ? (
                        <p className="mb-2 text-[11px] font-medium text-rose-700">
                          {uiLang === "en"
                            ? "Car not matched — cannot save until plate/chassis resolves to a car in DB."
                            : "ยังจับคู่รถไม่ได้ — บันทึกไม่ได้จนกว่าจะเชื่อมคันในระบบ"}
                        </p>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        disabled={
                          savingInboxId === m.inbox_id ||
                          selectedIdx.length === 0 ||
                          !m.car_row_id
                        }
                        onClick={() => void saveQueueCard(m)}
                        className="w-full touch-manipulation bg-slate-950 hover:bg-slate-900"
                      >
                        {savingInboxId === m.inbox_id
                          ? uiLang === "en"
                            ? "Saving…"
                            : "กำลังบันทึก…"
                          : uiLang === "en"
                            ? `Save (${selectedIdx.length})`
                            : `บันทึก (${selectedIdx.length})`}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p className="mb-2 text-[11px] font-semibold leading-snug text-violet-950">
            {uiLang === "en" ? "Or paste manually" : "หรือวางข้อความเอง"}
          </p>

          <label className="mb-2 block text-[11px] font-medium text-slate-600">
            {uiLang === "en" ? "Car (all loaded; ignores filters)" : "รถ (ทั้งหมดที่โหลด — ไม่ตามการกรองหน้า)"}
            <select
              value={selectedOrderId}
              onChange={(e) => setSelectedOrderId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-sm font-medium text-slate-900"
              disabled={orders.length === 0}
            >
              {orders.length === 0 ? (
                <option value="">{uiLang === "en" ? "No cars in list" : "ไม่มีรถในรายการ"}</option>
              ) : (
                orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {(o.fullPlate || "-").trim()} · {(o.car || "").slice(0, 42)}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="mb-2 block text-[11px] font-medium text-slate-600">
            {uiLang === "en" ? "LINE message" : "ข้อความ LINE"}
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={uiLang === "en" ? "Paste here…" : "วางข้อความที่นี่…"}
              className="mt-1 min-h-[72px] w-full resize-y rounded-xl border border-slate-200 px-2 py-2 text-sm outline-none ring-violet-400 focus:ring-2"
            />
          </label>

          <div className="mb-3 flex flex-wrap items-stretch gap-2">
            <Button
              type="button"
              size="sm"
              disabled={analyzeLoading || !rawText.trim()}
              onClick={() => void runAnalyze()}
              className="touch-manipulation shrink-0 bg-violet-700 hover:bg-violet-800"
            >
              {analyzeLoading
                ? uiLang === "en"
                  ? "Analyzing…"
                  : "กำลังวิเคราะห์…"
                : uiLang === "en"
                  ? "Analyze"
                  : "วิเคราะห์"}
            </Button>
            {!analyzeLoading &&
            ((taskLinesHeuristic.length ?? 0) > 0 || rows.length > 0) ? (
              <LineInboxTaskLinesCompare
                lang={uiLang}
                ruleLines={taskLinesHeuristic}
                usedLines={rows.map((r) => r.raw_text)}
                usedSource={taskLinesSource}
                aiGroqLines={taskLinesAiByModel?.groq ?? null}
                aiGeminiLines={taskLinesAiByModel?.gemini ?? null}
                chosenAiProvider={taskLinesChosenLlm}
                className="min-w-[min(100%,12rem)]"
              />
            ) : null}
          </div>

          {error ? (
            <div className="mb-2 rounded-xl border border-rose-200 bg-rose-50 px-2 py-2 text-xs text-rose-900">
              {error}
            </div>
          ) : null}

          {saveHint ? (
            <div className="mb-2 rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-2 text-xs font-medium text-emerald-900">
              {saveHint}
            </div>
          ) : null}

          {detected ? (
            <div className="mb-3 rounded-xl bg-slate-50 px-3 py-2 text-[12px] ring-1 ring-slate-200/80">
              <div className="font-semibold text-slate-800">
                {uiLang === "en" ? "Detected plate" : "ทะเบียนที่จับได้"}
                {": "}
                <span className="font-bold tabular-nums text-violet-900">
                  {detected.plate_text?.trim() || "—"}
                </span>
              </div>
              {detected.chassis?.trim() ? (
                <div className="mt-1 text-[11px] text-slate-700">
                  {uiLang === "en" ? "Chassis" : "เลขตัวถัง"} ·{" "}
                  <span className="break-all font-mono text-[10px]">{detected.chassis.trim()}</span>
                </div>
              ) : null}
              {detected.spec?.trim() ? (
                <div className="mt-0.5 text-[11px] text-slate-700">
                  {uiLang === "en" ? "Spec (display)" : "สเปก (แสดงผลรวม)"} ·{" "}
                  <span className="break-all text-[11px] font-medium text-slate-900">
                    {detected.spec.trim()}
                  </span>
                </div>
              ) : null}
              <div className="mt-0.5 text-[11px] text-slate-700">
                {uiLang === "en" ? "Spec from message (for match)" : "สเปกจากข้อความ (ฝั่งเทียบ)"} ·{" "}
                <span className="break-all font-medium text-slate-900">
                  {detected.line_spec_snippet?.trim() || "—"}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-slate-700">
                {uiLang === "en" ? "Spec in DB (cars.spec)" : "สเปกใน DB (cars.spec)"} ·{" "}
                <span className="break-all text-slate-800">{detected.db_spec?.trim() || "—"}</span>
              </div>
              {detected.car_row_id ? (
                <div className="mt-1 font-mono text-[10px] text-slate-500">
                  car_row_id · {detected.car_row_id}
                </div>
              ) : null}
              {needsReview ? (
                <p className="mt-1 text-[11px] text-amber-800">
                  {uiLang === "en"
                    ? "Review suggested — car or duplicate lines may need your check."
                    : "ระบบแนะนำให้ตรวจทาน — รถหรืองานซ้ำอาจต้องยืนยันเอง"}
                </p>
              ) : null}
              {detectedCarAiByModel ? (
                <div className="mt-2">
                  <LineInboxCarAiByModelPeek
                    lang={uiLang}
                    aiByModel={detectedCarAiByModel}
                    finalCarRowId={String(detected.car_row_id ?? "").trim()}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {rows.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-slate-700">
                {uiLang === "en" ? "Suggested lines" : "รายการที่เสนอ"} ({rows.length})
                {taskLinesSource === "llm" ? (
                  <span className="ml-1 font-normal text-violet-700">
                    {uiLang === "en" ? " · split via AI" : " · แยกด้วย AI"}
                  </span>
                ) : null}
              </p>
              <ul className="max-h-[min(35vh,240px)] space-y-2 overflow-y-auto overscroll-contain pr-1">
                {rows.map((row, i) => (
                  <li
                    key={`${row.raw_text}-${i}`}
                    className="rounded-xl border border-slate-200 bg-slate-50/90 p-2.5"
                  >
                    <label className="flex cursor-pointer gap-2">
                      <input
                        type="checkbox"
                        checked={row.included}
                        onChange={(e) => updateRow(i, { included: e.target.checked })}
                        className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-400"
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "mb-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                            duplicateBadgeClass(row.duplicate_status)
                          )}
                        >
                          {duplicateLabelTh(row.duplicate_status)}
                        </span>
                        <span className="block text-[13px] font-medium leading-snug text-slate-900">
                          {row.suggested_item_name || row.raw_text}
                        </span>
                        <span className="text-[11px] text-slate-500">{row.reason}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>

              <Button
                type="button"
                disabled={
                  confirmLoading ||
                  pendingSaveCount === 0 ||
                  (!effectiveCarRowId && effectiveCarId == null)
                }
                onClick={() => void runConfirm()}
                className="mt-1 w-full touch-manipulation bg-slate-950 hover:bg-slate-900"
              >
                {confirmLoading
                  ? uiLang === "en"
                    ? "Saving…"
                    : "กำลังบันทึก…"
                  : uiLang === "en"
                    ? `Save (${pendingSaveCount})`
                    : `บันทึก (${pendingSaveCount})`}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
