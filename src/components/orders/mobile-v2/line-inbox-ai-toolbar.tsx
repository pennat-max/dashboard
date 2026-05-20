"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolveSaleStaffForOrder } from "@/lib/orders/sale-assignees-shared";
import type {
  DuplicateStatus,
  ExistingOrderItemRow,
  LineInboxAnalyzeItem,
  LineInboxAnalyzeResponse,
} from "@/lib/line-inbox/types";

export type LineInboxAiOrderPick = {
  id: string;
  fullPlate: string;
  car: string;
  chassis?: string | null;
  sale?: string | null;
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
};

type RowDraft = LineInboxAnalyzeItem & {
  action: "skip" | "create" | "merge";
  note: string;
  included: boolean;
  itemName: string;
  assignee: string;
  status: string;
  dueDate: string;
};

function defaultAction(item: LineInboxAnalyzeItem): RowDraft["action"] {
  if (item.duplicate_status === "duplicate" && String(item.matched_order_item_id ?? "").trim()) {
    return "merge";
  }
  if (
    item.duplicate_status === "possible_duplicate" &&
    String(item.matched_order_item_id ?? "").trim()
  ) {
    return "skip";
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

function normalizeLookup(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[\s-]+/g, "")
    .toUpperCase();
}

function safeDateValue(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  const m = raw.match(/^\d{4}-\d{2}-\d{2}/);
  return m?.[0] ?? "";
}

function addUniqueOption(target: string[], value: string | null | undefined) {
  const clean = String(value ?? "").trim();
  if (!clean) return;
  const key = clean.toLowerCase();
  if (target.some((v) => v.toLowerCase() === key)) return;
  target.push(clean);
}

function actionLabelTh(action: RowDraft["action"]): string {
  if (action === "merge") return "อัปเดตงานเดิม";
  if (action === "skip") return "ข้าม";
  return "เพิ่มงานใหม่";
}

const LINE_INBOX_PHOTO_REF_SPLIT_REGEX = /(ตามรูป|ตามภาพ|ref\s*pic|as\s+photo|see\s+photo)/gi;
const LINE_INBOX_PHOTO_REF_EXACT_REGEX = /^(ตามรูป|ตามภาพ|ref\s*pic|as\s+photo|see\s+photo)$/i;

function hasLineInboxPhotoReference(value: string | null | undefined): boolean {
  return /(ตามรูป|ตามภาพ|ref\s*pic|as\s+photo|see\s+photo)/i.test(String(value ?? ""));
}

function stablePillIndex(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

const LINE_INBOX_ASSIGNEE_PILL_CLASSES = [
  "bg-emerald-100 text-emerald-950 ring-emerald-300",
  "bg-cyan-100 text-cyan-950 ring-cyan-300",
  "bg-lime-100 text-lime-950 ring-lime-300",
  "bg-violet-100 text-violet-950 ring-violet-300",
  "bg-fuchsia-100 text-fuchsia-950 ring-fuchsia-300",
  "bg-amber-100 text-amber-950 ring-amber-300",
  "bg-sky-100 text-sky-950 ring-sky-300",
  "bg-rose-100 text-rose-950 ring-rose-300",
];

function lineInboxAssigneePillClasses(assignee: string | null | undefined): string {
  const name = String(assignee ?? "").trim();
  if (!name) return "bg-white text-slate-700 ring-slate-200";
  return LINE_INBOX_ASSIGNEE_PILL_CLASSES[
    stablePillIndex(name) % LINE_INBOX_ASSIGNEE_PILL_CLASSES.length
  ]!;
}

function lineInboxStatusPillClasses(status: string | null | undefined): string {
  const s = String(status ?? "").trim();
  if (!s) return "bg-white text-slate-700 ring-slate-200";
  if (s === "จบ") return "bg-sky-50 text-sky-800 ring-sky-300";
  if (s === "สั่ง" || s === "เช็ค") return "bg-amber-50 text-amber-900 ring-amber-300";
  return "bg-white text-emerald-900 ring-slate-200";
}

function LineInboxSuggestedItemNamePreview({
  value,
  uiLang,
  onEdit,
  onPhotoReference,
}: {
  value: string;
  uiLang: UiLang;
  onEdit: () => void;
  onPhotoReference: () => void;
}) {
  const text = String(value ?? "").trim() || "-";
  const parts = text.split(LINE_INBOX_PHOTO_REF_SPLIT_REGEX).filter(Boolean);
  return (
    <div
      data-line-inbox-item-name-preview=""
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEdit();
        }
      }}
      className="min-w-0 flex-1 cursor-text rounded-xl px-1.5 py-1 text-sm font-semibold leading-snug text-slate-900 ring-1 ring-transparent hover:bg-white/70 focus:outline-none focus:ring-slate-300"
      title={uiLang === "en" ? "Tap to edit item name" : "แตะเพื่อแก้ชื่องาน"}
    >
      {parts.map((part, index) => {
        const isPhotoRef = LINE_INBOX_PHOTO_REF_EXACT_REGEX.test(part.trim());
        if (!isPhotoRef) {
          return (
            <span key={`${part}-${index}`} className="whitespace-pre-wrap break-words">
              {part}
            </span>
          );
        }
        return (
          <button
            key={`${part}-${index}`}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onPhotoReference();
            }}
            className="inline cursor-pointer border-0 bg-transparent p-0 align-baseline font-inherit font-semibold text-sky-600 underline decoration-sky-400 decoration-2 underline-offset-2 hover:text-sky-700 active:text-sky-800"
            title={uiLang === "en" ? "Photo reference" : "รูปอ้างอิง"}
          >
            {part}
          </button>
        );
      })}
    </div>
  );
}

export function LineInboxAiToolbar({
  orders,
  uiLang,
  preferredOrderId,
  staffOptions = [],
  saleAssigneesBySale = {},
  statusOptions = [],
  onSaved,
}: {
  orders: LineInboxAiOrderPick[];
  uiLang: UiLang;
  preferredOrderId?: string | null;
  staffOptions?: string[];
  saleAssigneesBySale?: Record<string, string>;
  statusOptions?: string[];
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
  const [ignoredVehicleLines, setIgnoredVehicleLines] = useState<string[]>([]);
  const [ignoredMentionLines, setIgnoredMentionLines] = useState<string[]>([]);
  const [ignoredNoiseLines, setIgnoredNoiseLines] = useState<string[]>([]);
  const [existingItems, setExistingItems] = useState<ExistingOrderItemRow[]>([]);
  const [rows, setRows] = useState<RowDraft[]>([]);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
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

  useEffect(() => {
    void fetchQueue();
    const t = window.setInterval(() => void fetchQueue(), 45_000);
    return () => window.clearInterval(t);
  }, [fetchQueue]);

  useEffect(() => {
    if (open) void fetchQueue();
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
      return "";
    });
  }, [orders, preferredOrderId]);

  const selected = useMemo(
    () => orders.find((o) => o.id === selectedOrderId) ?? null,
    [orders, selectedOrderId]
  );

  const detectedOrder = useMemo(() => {
    if (!detected) return null;

    const rowId = String(detected.car_row_id ?? "").trim();
    if (rowId) {
      const byRow = orders.find((o) => String(o.carRowId ?? "").trim() === rowId);
      if (byRow) return byRow;
    }

    const plateKey = normalizeLookup(detected.plate_text);
    if (plateKey) {
      const byPlate = orders.find((o) => {
        const fullPlateKey = normalizeLookup(o.fullPlate);
        return fullPlateKey === plateKey || fullPlateKey.includes(plateKey) || plateKey.includes(fullPlateKey);
      });
      if (byPlate) return byPlate;
    }

    const chassisKey = normalizeLookup(detected.chassis);
    if (chassisKey) {
      const byChassis = orders.find((o) => normalizeLookup(o.chassis).includes(chassisKey));
      if (byChassis) return byChassis;
    }

    return selected;
  }, [detected, orders, selected]);

  const detectedCarTitle = useMemo(() => {
    if (!detected) return "";
    const plate = String(detectedOrder?.fullPlate || detected.plate_text || "").trim();
    const car = String(detectedOrder?.car || detected.spec_text || "").trim();
    const title = [plate, car].filter(Boolean).join(" ").trim();
    return title || String(detected.chassis ?? "").trim();
  }, [detected, detectedOrder]);

  const detectedChassis = useMemo(() => {
    if (!detected) return "";
    return String(detectedOrder?.chassis || detected.chassis || "").trim();
  }, [detected, detectedOrder]);

  const detectedSale = String(detectedOrder?.sale || detected?.sale || "").trim();

  const resolveMappedAssigneeForDetectedCar = useCallback(
    (detectedCar: LineInboxAnalyzeResponse["detected_car"] | null) => {
      if (!detectedCar) return "";

      let matchedOrder: LineInboxAiOrderPick | null = null;
      const rowId = String(detectedCar.car_row_id ?? "").trim();
      if (rowId) {
        matchedOrder = orders.find((o) => String(o.carRowId ?? "").trim() === rowId) ?? null;
      }

      const plateKey = normalizeLookup(detectedCar.plate_text);
      if (!matchedOrder && plateKey) {
        matchedOrder =
          orders.find((o) => {
            const fullPlateKey = normalizeLookup(o.fullPlate);
            return fullPlateKey === plateKey || fullPlateKey.includes(plateKey) || plateKey.includes(fullPlateKey);
          }) ?? null;
      }

      const chassisKey = normalizeLookup(detectedCar.chassis);
      if (!matchedOrder && chassisKey) {
        matchedOrder = orders.find((o) => normalizeLookup(o.chassis).includes(chassisKey)) ?? null;
      }

      if (!matchedOrder && selected) matchedOrder = selected;
      const sale = String(matchedOrder?.sale || detectedCar.sale || "").trim();
      return resolveSaleStaffForOrder(sale, saleAssigneesBySale);
    },
    [orders, saleAssigneesBySale, selected]
  );

  const showDebugDetails =
    process.env.NODE_ENV !== "production" &&
    Boolean(
      String(detected?.car_row_id ?? "").trim() ||
        ignoredVehicleLines.length ||
        ignoredMentionLines.length ||
        ignoredNoiseLines.length
    );

  const effectiveCarRowId = useMemo(() => {
    const fromAnalyze = String(detected?.car_row_id ?? "").trim();
    return fromAnalyze || String(selected?.carRowId ?? "").trim();
  }, [detected, selected]);

  const effectiveCarId = useMemo(() => {
    const id = selected?.carId;
    return id != null && Number.isFinite(Number(id)) ? Number(id) : null;
  }, [selected]);
  const hasEffectiveCar = Boolean(effectiveCarRowId || effectiveCarId != null);

  const staffChoices = useMemo(() => {
    const out: string[] = [];
    for (const name of staffOptions) addUniqueOption(out, name);
    for (const item of existingItems) addUniqueOption(out, item.assignee_staff);
    for (const row of rows) addUniqueOption(out, row.assignee);
    return out;
  }, [existingItems, rows, staffOptions]);

  const statusChoices = useMemo(() => {
    const out: string[] = [];
    for (const status of statusOptions) addUniqueOption(out, status);
    for (const status of ["เช็ค", "มี", "สั่ง", "มา", "รถนอก", "ช่างนอก", "จบ"]) {
      addUniqueOption(out, status);
    }
    for (const item of existingItems) addUniqueOption(out, item.status);
    for (const row of rows) addUniqueOption(out, row.status);
    return out;
  }, [existingItems, rows, statusOptions]);

  const pendingSaveCount = useMemo(
    () => rows.filter((r) => r.included && r.action !== "skip").length,
    [rows]
  );

  const rawBadgeTotal = queueTotalNew + pendingSaveCount;
  const showBadgeDot = rawBadgeTotal > 0;

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
    setExistingItems([]);
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
      setIgnoredVehicleLines(data.ignored_vehicle_spec_lines ?? []);
      setIgnoredMentionLines(data.ignored_mention_lines ?? []);
      setIgnoredNoiseLines(data.ignored_noise_lines ?? []);
      const existingFromAnalyze = data.existing_items ?? [];
      setExistingItems(existingFromAnalyze);
      const existingById = new Map(
        existingFromAnalyze.map((item) => [String(item.id ?? "").trim(), item])
      );
      const mappedAssignee = resolveMappedAssigneeForDetectedCar(data.detected_car);
      const next: RowDraft[] = (data.items ?? []).map((item) => {
        const action = defaultAction(item);
        const matched = existingById.get(String(item.matched_order_item_id ?? "").trim());
        return {
          ...item,
          action,
          note: "",
          included: action !== "skip",
          itemName: item.suggested_item_name || item.raw_text,
          assignee: matched?.assignee_staff || mappedAssignee || "",
          status: item.suggested_status || matched?.status || "",
          dueDate: safeDateValue(matched?.due_date),
        };
      });
      setRows(next);
      setExpandedRows({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
      setExpandedRows({});
      setDetected(null);
      setExistingItems([]);
      setIgnoredVehicleLines([]);
      setIgnoredMentionLines([]);
      setIgnoredNoiseLines([]);
    } finally {
      setAnalyzeLoading(false);
    }
  }, [rawText, selected, effectiveCarId, resolveMappedAssigneeForDetectedCar]);

  const updateRow = useCallback((index: number, patch: Partial<RowDraft>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }, []);

  const setRowExpanded = useCallback((rowKey: string, expanded: boolean) => {
    setExpandedRows((prev) => ({ ...prev, [rowKey]: expanded }));
  }, []);

  const toggleRowExpanded = useCallback((rowKey: string) => {
    setExpandedRows((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }));
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
        const itemName = String(r.itemName || r.suggested_item_name || r.raw_text).trim();
        const status = String(r.status || r.suggested_status || "").trim();
        const note = String(r.note ?? "").trim();
        const assignee = String(r.assignee ?? "").trim();
        const dueDate = safeDateValue(r.dueDate);
        if (!r.included || r.action === "skip") {
          return {
            action: "skip" as const,
            item_name: itemName,
          };
        }
        return {
          action: r.action,
          order_item_id: r.action === "merge" ? r.matched_order_item_id : undefined,
          item_name: itemName,
          item_status: status || undefined,
          note: note || undefined,
          assignee_staff: assignee || undefined,
          due_date: dueDate || undefined,
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
      setExpandedRows({});
      setDetected(null);
      setExistingItems([]);
      setIgnoredVehicleLines([]);
      setIgnoredMentionLines([]);
      setIgnoredNoiseLines([]);
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
          "relative flex min-h-[52px] min-w-[5.25rem] max-w-[9rem] shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center transition-colors touch-manipulation",
          open
            ? "bg-violet-700 text-white shadow-sm ring-1 ring-violet-500/40"
            : "bg-violet-100 text-violet-950 ring-1 ring-violet-300/90 hover:bg-violet-200/90"
        )}
        aria-expanded={open}
        title={
          uiLang === "en"
            ? "LINE group queue + paste to analyze"
            : "คิวจากกลุ่ม LINE + วางข้อความวิเคราะห์"
        }
      >
        <span className="line-clamp-2 max-w-full text-[11px] font-semibold leading-snug">AI · LINE</span>
        <span className="text-[10px] font-medium leading-tight opacity-90">
          {uiLang === "en" ? "new jobs" : "งานใหม่"}
        </span>
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
            <p className="mb-2 text-[10px] leading-snug text-slate-600">
              {uiLang === "en"
                ? `New non-duplicate lines only · ${queueTotalNew} total · auto-refresh ~45s`
                : `เฉพาะงานใหม่ (ไม่ซ้ำ) · รวม ${queueTotalNew} งาน · รีเฟรชอัตโนมัติ ~45 วินาที`}
            </p>
            {queueLoading ? (
              <p className="text-[11px] text-slate-500">{uiLang === "en" ? "Loading…" : "กำลังโหลด…"}</p>
            ) : queueMessages.length === 0 ? (
              <p className="text-[11px] text-slate-500">
                {uiLang === "en" ? "No pending new jobs from LINE." : "ยังไม่มีงานใหม่ค้างจาก LINE"}
              </p>
            ) : (
              <ul className="max-h-[min(45vh,280px)] space-y-3 overflow-y-auto overscroll-contain pr-1">
                {queueMessages.map((m) => {
                  const selectedIdx = selectedIndicesForInbox(m);
                  return (
                    <li
                      key={m.inbox_id}
                      className="rounded-xl border border-slate-200 bg-slate-50/90 p-2.5 ring-1 ring-slate-100"
                    >
                      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
                        <span className="text-sm font-bold tabular-nums text-violet-950">
                          {uiLang === "en" ? "Plate" : "ทะเบียน"}: {m.plate_display || "—"}
                        </span>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">
                          {uiLang === "en" ? "New" : "งานใหม่"} {m.new_line_count}{" "}
                          {uiLang === "en" ? "lines" : "บรรทัด"}
                        </span>
                      </div>
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
                <>
                  <option value="">
                    {uiLang === "en"
                      ? "Let AI match from message / pick if not found"
                      : "ให้ AI จับรถจากข้อความ / เลือกเองถ้าจับไม่ได้"}
                  </option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {(o.fullPlate || "-").trim()} · {(o.car || "").slice(0, 42)}
                    </option>
                  ))}
                </>
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

          <div className="mb-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={analyzeLoading || !rawText.trim()}
              onClick={() => void runAnalyze()}
              className="touch-manipulation bg-violet-700 hover:bg-violet-800"
            >
              {analyzeLoading
                ? uiLang === "en"
                  ? "Analyzing…"
                  : "กำลังวิเคราะห์…"
                : uiLang === "en"
                  ? "Analyze"
                  : "วิเคราะห์"}
            </Button>
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
                {uiLang === "en" ? "Detected car" : "รถที่จับได้"}
                {": "}
                <span className="font-bold tabular-nums text-violet-900">
                  {detectedCarTitle || (uiLang === "en" ? "Needs review" : "ต้องตรวจสอบ")}
                </span>
              </div>
              {detectedChassis ? (
                <div className="mt-1 text-[11px] font-medium text-slate-600">
                  {uiLang === "en" ? "Chassis" : "เลขถัง"}:{" "}
                  <span className="font-mono text-[10px]">{detectedChassis}</span>
                </div>
              ) : null}
              {detectedSale ? (
                <div className="mt-1 text-[11px] font-medium text-slate-600">
                  {uiLang === "en" ? "Sale" : "เซลล์"}: <span className="font-bold">{detectedSale}</span>
                </div>
              ) : null}
              {needsReview ? (
                <p className="mt-1 text-[11px] text-amber-800">
                  {uiLang === "en"
                    ? "Review suggested — car or duplicate lines may need your check."
                    : "ระบบแนะนำให้ตรวจทาน — รถหรืองานซ้ำอาจต้องยืนยันเอง"}
                </p>
              ) : null}
              {!hasEffectiveCar ? (
                <p className="mt-1 text-[11px] font-medium text-rose-700">
                  {uiLang === "en"
                    ? "Car not found yet — search or pick a car before saving."
                    : "ยังจับคู่รถไม่ได้ — ค้นหรือเลือกรถก่อนบันทึก"}
                </p>
              ) : null}
            </div>
          ) : null}

          {showDebugDetails ? (
            <details className="mb-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-[11px] text-slate-600">
              <summary className="cursor-pointer select-none font-semibold text-slate-700">
                {uiLang === "en" ? "AI ignored details" : "รายละเอียดที่ AI ตัดออก"}
              </summary>
              {detected?.car_row_id ? (
                <p className="mt-2 break-all font-mono text-[10px] text-slate-500">
                  car_row_id · {detected.car_row_id}
                </p>
              ) : null}
              {ignoredMentionLines.length || ignoredNoiseLines.length ? (
                <div className="mt-2">
                  <p className="font-semibold text-slate-700">
                    {uiLang === "en" ? "Mentions / noise" : "mention / noise"}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {[...ignoredMentionLines, ...ignoredNoiseLines].slice(0, 6).map((line, index) => (
                      <li key={`ignored-mention-${index}`} className="line-clamp-1">
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {ignoredVehicleLines.length ? (
                <div className="mt-2">
                  <p className="font-semibold text-slate-700">
                    {uiLang === "en" ? "Vehicle context" : "ข้อมูลรถที่ใช้เป็น context"}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {ignoredVehicleLines.slice(0, 6).map((line, index) => (
                      <li key={`ignored-vehicle-${index}`} className="line-clamp-1">
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </details>
          ) : null}

          {detected && hasEffectiveCar ? (
            <div className="mb-3 rounded-xl border border-slate-200 bg-white px-3 py-2 ring-1 ring-slate-100">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <p className="text-[12px] font-bold text-slate-800">งานเดิมของรถคันนี้</p>
                <span className="text-[11px] font-semibold tabular-nums text-slate-500">
                  {existingItems.length}
                </span>
              </div>
              {existingItems.length === 0 ? (
                <p className="rounded-lg bg-slate-50 px-2 py-2 text-[11px] text-slate-500">
                  ยังไม่พบงานเดิมของรถคันนี้ใน order_items
                </p>
              ) : (
                <ul className="max-h-[min(28vh,220px)] space-y-2 overflow-y-auto overscroll-contain pr-1">
                  {existingItems.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-lg bg-slate-50 px-2 py-2 text-[11px] ring-1 ring-slate-200/80"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <span className="min-w-0 flex-1 font-semibold leading-snug text-slate-900">
                          {item.label || "-"}
                        </span>
                        {item.status ? (
                          <span className="rounded-full bg-white px-2 py-0.5 font-semibold text-slate-700 ring-1 ring-slate-200">
                            {item.status}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-slate-500">
                        {item.assignee_staff ? <span>ผู้รับผิดชอบ: {item.assignee_staff}</span> : null}
                        {item.due_date ? <span>วันกำหนด: {safeDateValue(item.due_date) || item.due_date}</span> : null}
                        {item.updated_at ? <span>อัปเดต: {safeDateValue(item.updated_at) || item.updated_at}</span> : null}
                      </div>
                      {item.note ? <p className="mt-1 line-clamp-2 text-slate-500">หมายเหตุ: {item.note}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {rows.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-slate-700">
                {uiLang === "en" ? "New AI suggestions" : "งานใหม่ที่ AI เสนอ"} ({rows.length})
              </p>
              <ul className="max-h-[min(48vh,420px)] space-y-3 overflow-y-auto overscroll-contain pr-1">
                {rows.map((row, i) => {
                  const canMerge = Boolean(String(row.matched_order_item_id ?? "").trim());
                  const rowKey = `${row.raw_text}-${row.matched_order_item_id ?? ""}-${i}`;
                  const expanded = Boolean(expandedRows[rowKey]);
                  const hasPhotoRef = hasLineInboxPhotoReference(row.itemName);
                  return (
                    <li
                      key={`${row.raw_text}-${i}`}
                      className={cn(
                        "space-y-2 rounded-2xl border p-2.5 ring-1 ring-transparent",
                        row.included ? "border-slate-200 bg-slate-100" : "border-slate-200 bg-slate-50 opacity-80",
                        row.duplicate_status === "duplicate" ? "bg-amber-50" : "",
                        row.duplicate_status === "possible_duplicate" ? "bg-orange-50" : ""
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-slate-900">
                          <input
                            type="checkbox"
                            checked={row.included}
                            onChange={(e) => {
                              const included = e.target.checked;
                              updateRow(i, {
                                included,
                                action: included && row.action === "skip" ? "create" : row.action,
                              });
                            }}
                            className="h-5 w-5 shrink-0 rounded border-slate-400"
                          />
                          {uiLang === "en" ? "Approve" : "เลือกบันทึก"}
                        </label>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={cn(
                              "inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                              duplicateBadgeClass(row.duplicate_status)
                            )}
                          >
                            {duplicateLabelTh(row.duplicate_status)}
                          </span>
                          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200">
                            {actionLabelTh(row.action)}
                          </span>
                        </div>
                      </div>

                      <div className="flex min-w-0 items-center gap-1.5">
                        <LineInboxSuggestedItemNamePreview
                          value={row.itemName}
                          uiLang={uiLang}
                          onEdit={() => setRowExpanded(rowKey, true)}
                          onPhotoReference={() => setRowExpanded(rowKey, true)}
                        />
                        <div className="flex shrink-0 items-center gap-1.5">
                          <select
                            value={row.assignee}
                            onChange={(e) => updateRow(i, { assignee: e.target.value })}
                            title={uiLang === "en" ? "Owner" : "พนักงาน"}
                            className={cn(
                              "h-10 min-h-[40px] w-[76px] shrink-0 touch-manipulation rounded-full border-0 px-2 py-1.5 text-xs font-semibold shadow-sm outline-none ring-1 focus-visible:ring-2 sm:w-[88px]",
                              lineInboxAssigneePillClasses(row.assignee)
                            )}
                          >
                            <option value="">{uiLang === "en" ? "-" : "—"}</option>
                            {staffChoices.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                          <select
                            value={row.status}
                            onChange={(e) => updateRow(i, { status: e.target.value })}
                            title={uiLang === "en" ? "Item status" : "สถานะรายการ"}
                            className={cn(
                              "h-10 min-h-[40px] w-[5.5rem] shrink-0 touch-manipulation rounded-full border-0 px-2 py-1.5 text-xs font-medium shadow-sm outline-none ring-1 focus-visible:ring-2 sm:w-[6.25rem]",
                              lineInboxStatusPillClasses(row.status)
                            )}
                          >
                            <option value="">{uiLang === "en" ? "-" : "—"}</option>
                            {statusChoices.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => toggleRowExpanded(rowKey)}
                            className="h-10 min-h-[40px] shrink-0 rounded-full bg-white px-2.5 text-[11px] font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200"
                            aria-expanded={expanded}
                          >
                            {expanded
                              ? uiLang === "en"
                                ? "Close"
                                : "ปิด"
                              : uiLang === "en"
                                ? "Edit"
                                : "แก้"}
                          </button>
                        </div>
                      </div>

                      {expanded ? (
                        <>
                      {row.matched_item_name ? (
                        <p className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-900 ring-1 ring-amber-200/80">
                          {uiLang === "en" ? "Similar existing item" : "คล้ายงานเดิม"}:{" "}
                          <span className="font-semibold">{row.matched_item_name}</span>
                        </p>
                      ) : null}

                      <label className="block text-[11px] font-medium text-slate-600">
                        {uiLang === "en" ? "Item name" : "ชื่องาน"}
                        <input
                          value={row.itemName}
                          onChange={(e) => updateRow(i, { itemName: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[13px] font-medium text-slate-900 outline-none ring-violet-400 focus:ring-2"
                        />
                      </label>

                      <div className="grid gap-2 sm:grid-cols-3">
                        <label className="block text-[11px] font-medium text-slate-600">
                          {uiLang === "en" ? "Action" : "การทำงาน"}
                          <select
                            value={row.action}
                            onChange={(e) => {
                              const action = e.target.value as RowDraft["action"];
                              updateRow(i, {
                                action,
                                included: action === "skip" ? false : row.included || true,
                              });
                            }}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[13px] font-semibold text-slate-900"
                          >
                            <option value="create">{uiLang === "en" ? "Create new" : "เพิ่มงานใหม่"}</option>
                            <option value="merge" disabled={!canMerge}>
                              {uiLang === "en" ? "Update existing" : "อัปเดตงานเดิม"}
                            </option>
                            <option value="skip">{uiLang === "en" ? "Skip" : "ข้าม"}</option>
                          </select>
                        </label>
                        <label className="block text-[11px] font-medium text-slate-600">
                          {uiLang === "en" ? "Assignee" : "ผู้รับผิดชอบ"}
                          <select
                            value={row.assignee}
                            onChange={(e) => updateRow(i, { assignee: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[13px] font-semibold text-slate-900"
                          >
                            <option value="">{uiLang === "en" ? "Not set" : "ยังไม่ระบุ"}</option>
                            {staffChoices.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-[11px] font-medium text-slate-600">
                          {uiLang === "en" ? "Status" : "สถานะ"}
                          <select
                            value={row.status}
                            onChange={(e) => updateRow(i, { status: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[13px] font-semibold text-slate-900"
                          >
                            <option value="">{uiLang === "en" ? "Not set" : "ยังไม่ระบุ"}</option>
                            {statusChoices.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                        <label className="block text-[11px] font-medium text-slate-600">
                          {uiLang === "en" ? "Due date" : "วันกำหนด"}
                          <input
                            type="date"
                            value={row.dueDate}
                            onChange={(e) => updateRow(i, { dueDate: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[13px] font-semibold text-slate-900"
                          />
                        </label>
                        <label className="block text-[11px] font-medium text-slate-600">
                          {uiLang === "en" ? "Note" : "หมายเหตุ"}
                          <input
                            value={row.note}
                            onChange={(e) => updateRow(i, { note: e.target.value })}
                            placeholder={uiLang === "en" ? "Optional note" : "เพิ่มหมายเหตุได้"}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[13px] text-slate-900 outline-none ring-violet-400 focus:ring-2"
                          />
                        </label>
                      </div>

                      {hasPhotoRef ? (
                        <div className="rounded-lg bg-sky-50 px-2 py-1.5 text-[11px] leading-snug text-sky-900 ring-1 ring-sky-200/80">
                          <span className="font-semibold">
                            {uiLang === "en" ? "Photo reference" : "รูปอ้างอิง"}
                          </span>
                          {" · "}
                          {uiLang === "en"
                            ? "Save this row first, then attach photos from the refreshed order card."
                            : "บันทึกรายการนี้ก่อน แล้วแนบรูปจากการ์ดงานที่ refresh แล้ว"}
                        </div>
                      ) : null}

                      {row.suggested_note ? (
                        <p className="rounded-lg bg-sky-50 px-2 py-1.5 text-[11px] leading-snug text-sky-900 ring-1 ring-sky-200/80">
                          {uiLang === "en" ? "Reference from LINE" : "รายละเอียดอ้างอิงจาก LINE"}:{" "}
                          <span className="font-medium">{row.suggested_note}</span>
                        </p>
                      ) : null}

                      {row.reason ? <p className="text-[11px] text-slate-500">{row.reason}</p> : null}
                        </>
                      ) : null}
                    </li>
                  );
                })}
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
