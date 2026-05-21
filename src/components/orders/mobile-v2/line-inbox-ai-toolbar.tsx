"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
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

type PendingQueueActionLine = PendingQueueNewLine & {
  suggested_note: string;
  duplicate_status: DuplicateStatus;
  matched_order_item_id: string;
  matched_item_name: string;
  confidence: number;
  default_action: "create" | "merge" | "skip";
  included_by_default: boolean;
};

type PendingQueueMessage = {
  inbox_id: string;
  received_at: string;
  source_label?: string;
  plate_display: string;
  car_title?: string;
  car_row_id: string;
  sale?: string;
  raw_text_preview: string;
  new_lines: PendingQueueNewLine[];
  new_line_count: number;
  action_lines?: PendingQueueActionLine[];
  action_line_count?: number;
  existing_items?: ExistingOrderItemRow[];
  attachments?: PendingQueueAttachment[];
  needs_human_review: boolean;
};

type PendingQueueAttachment = {
  inbox_id: string;
  line_message_id: string;
  url: string;
  file_name: string | null;
  mime_type: string | null;
  received_at: string;
};

type PendingQueueGroup = {
  group_key: string;
  car_row_id: string;
  plate_display: string;
  car_title: string;
  sale: string;
  is_unresolved: boolean;
  total_action_lines: number;
  total_new_lines: number;
  existing_items: ExistingOrderItemRow[];
  attachments: PendingQueueAttachment[];
  messages: PendingQueueMessage[];
};

type QueueActionDraft = {
  included: boolean;
  action: "create" | "merge" | "skip";
  itemName: string;
  assignee: string;
  status: string;
  note: string;
  dueDate: string;
  orderItemId: string;
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

type LineInboxItemPhoto = {
  id: string;
  url: string;
  created_at?: string | null;
};

type LineInboxStagedPhoto = {
  id: string;
  file: File;
  previewUrl: string;
};

type SuggestionPhotoSheetState = {
  rowKey: string;
  rowIndex: number;
  itemName?: string;
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

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function buildLineReplyText({
  plate,
  lines,
  uiLang,
}: {
  plate: string;
  lines: Array<{ name: string; status: string }>;
  uiLang: UiLang;
}): string {
  const safePlate = plate.trim() || "-";
  const itemLines =
    lines.length > 0
      ? lines.map((line, index) => `${index + 1}. ${line.name.trim() || "-"} - ${line.status.trim() || "-"}`).join("\n")
      : "-";

  if (uiLang === "en") {
    return [
      "Received the request.",
      `Car: ${safePlate}`,
      "Items:",
      itemLines,
      "You can follow the status in Order Tracking.",
    ].join("\n");
  }

  return [
    "รับงานแล้วครับ",
    `รถ: ${safePlate}`,
    "รายการ:",
    itemLines,
    "ติดตามสถานะในระบบ Order Tracking ได้ครับ",
  ].join("\n");
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
  const hasRef = LINE_INBOX_PHOTO_REF_SPLIT_REGEX.test(String(value ?? ""));
  LINE_INBOX_PHOTO_REF_SPLIT_REGEX.lastIndex = 0;
  return hasRef;
}

function queueSuggestionRowKey(inboxId: string, itemIndex: number): string {
  return `queue:${inboxId}:${itemIndex}`;
}

function queueActionDraftForLine(
  line: PendingQueueActionLine,
  fallbackAssignee: string
): QueueActionDraft {
  return {
    included: Boolean(line.included_by_default) && line.default_action !== "skip",
    action: line.default_action,
    itemName: String(line.suggested_item_name || line.raw_text || "").trim(),
    assignee: fallbackAssignee,
    status: String(line.suggested_status ?? "").trim(),
    note: "",
    dueDate: "",
    orderItemId: String(line.matched_order_item_id ?? "").trim(),
  };
}

function safeQueueAction(action: string): QueueActionDraft["action"] {
  if (action === "merge" || action === "skip") return action;
  return "create";
}

function revokeStagedPhotoMap(map: Record<string, LineInboxStagedPhoto[]>) {
  Object.values(map).forEach((list) => {
    list.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
  });
}

function stablePillIndex(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

const LINE_INBOX_ASSIGNEE_SURFACE_CLASSES = [
  "bg-emerald-100 text-emerald-950 ring-emerald-300",
  "bg-cyan-100 text-cyan-950 ring-cyan-300",
  "bg-lime-100 text-lime-950 ring-lime-300",
  "bg-violet-100 text-violet-950 ring-violet-300",
  "bg-fuchsia-100 text-fuchsia-950 ring-fuchsia-300",
  "bg-amber-100 text-amber-950 ring-amber-300",
  "bg-sky-100 text-sky-950 ring-sky-300",
  "bg-rose-100 text-rose-950 ring-rose-300",
];

function lineInboxAssigneeLinkClasses(assignee: string | null | undefined): string {
  const name = String(assignee ?? "").trim();
  if (!name) return "bg-white text-slate-700 ring-slate-200";
  return LINE_INBOX_ASSIGNEE_SURFACE_CLASSES[
    stablePillIndex(name) % LINE_INBOX_ASSIGNEE_SURFACE_CLASSES.length
  ]!;
}

function lineInboxStatusLinkClasses(status: string | null | undefined): string {
  const s = String(status ?? "").trim();
  if (!s) return "bg-white text-slate-700 ring-slate-200";
  if (s === "จบ") return "bg-sky-50 text-sky-800 ring-sky-300";
  if (s === "สั่ง" || s === "เช็ค") return "bg-white text-amber-900 ring-slate-200";
  return "bg-white text-emerald-900 ring-slate-200";
}

function lineInboxAssigneePillClasses(assignee: string | null | undefined): string {
  return lineInboxAssigneeLinkClasses(assignee);
}

function lineInboxStatusPillClasses(status: string | null | undefined): string {
  return lineInboxStatusLinkClasses(status);
}

function LineInboxInlineSelectLink({
  value,
  options,
  onChange,
  title,
  emptyLabel,
  className,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  title: string;
  emptyLabel: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      title={title}
      aria-label={title}
      className={cn(
        "h-10 min-h-[40px] w-[76px] min-w-[4.5rem] shrink-0 touch-manipulation rounded-full border-0 px-2 py-1.5 text-xs font-semibold shadow-sm outline-none ring-1 focus-visible:ring-2 sm:w-[88px]",
        className
      )}
    >
      <option value="">{emptyLabel}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function LineInboxSuggestedItemNameField({
  value,
  uiLang,
  onChange,
  onPhotoReference,
}: {
  value: string;
  uiLang: UiLang;
  onChange: (value: string) => void;
  onPhotoReference: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const text = String(value ?? "");
  const trimmed = text.trim();
  const hasPhotoReference = hasLineInboxPhotoReference(text);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    try {
      el.setSelectionRange(len, len);
    } catch {
      /* ignore */
    }
  }, [editing]);

  const inputClass =
    "min-w-0 flex-1 basis-0 rounded-xl bg-transparent px-1.5 py-1.5 text-sm font-semibold text-slate-900 outline-none focus:bg-white focus:ring-2 focus:ring-slate-300/80";

  if (!hasPhotoReference || editing) {
    return (
      <input
        ref={inputRef}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setEditing(false)}
        placeholder={uiLang === "en" ? "Task name" : "ชื่องาน"}
        className={inputClass}
      />
    );
  }

  const parts = trimmed.split(LINE_INBOX_PHOTO_REF_SPLIT_REGEX).filter(Boolean);
  return (
    <div
      data-line-inbox-item-name-preview=""
      role="button"
      tabIndex={0}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-line-inbox-photo-link]")) return;
        setEditing(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setEditing(true);
        }
      }}
      className="inline-flex max-w-full min-w-0 flex-1 cursor-text flex-nowrap items-baseline gap-0 overflow-x-auto rounded-xl bg-transparent px-1.5 py-1.5 text-sm font-semibold leading-snug text-slate-900 ring-1 ring-transparent hover:bg-slate-50/80 focus:outline-none focus:ring-slate-300"
      title={uiLang === "en" ? "Tap to edit task name" : "ชื่องาน — แตะเพื่อแก้ไข"}
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
            type="button"
            data-line-inbox-photo-link=""
            key={`${part}-${index}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onPhotoReference();
            }}
            className="inline shrink-0 cursor-pointer border-0 bg-transparent p-0 align-baseline font-inherit font-semibold text-sky-600 underline decoration-sky-400 decoration-2 underline-offset-2 hover:text-sky-700 active:text-sky-800"
            title={uiLang === "en" ? "Upload/view photos for this item" : "เพิ่มรูปและดูรูปตามรายการนี้"}
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
  const [carSearch, setCarSearch] = useState("");
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
  const [suggestionPhotoSheet, setSuggestionPhotoSheet] = useState<SuggestionPhotoSheetState | null>(null);
  const [suggestionItemPhotos, setSuggestionItemPhotos] = useState<LineInboxItemPhoto[]>([]);
  const [suggestionPhotosLoading, setSuggestionPhotosLoading] = useState(false);
  const [stagedSuggestionPhotos, setStagedSuggestionPhotos] = useState<Record<string, LineInboxStagedPhoto[]>>({});
  const [stagedLineAttachments, setStagedLineAttachments] = useState<Record<string, PendingQueueAttachment[]>>({});
  const [photoBusyRowKey, setPhotoBusyRowKey] = useState<string | null>(null);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyCopied, setReplyCopied] = useState(false);

  const [queueMessages, setQueueMessages] = useState<PendingQueueMessage[]>([]);
  const [queueGroups, setQueueGroups] = useState<PendingQueueGroup[]>([]);
  const [queueAttachments, setQueueAttachments] = useState<PendingQueueAttachment[]>([]);
  const [queueTotalNew, setQueueTotalNew] = useState(0);
  const [queueTotalAction, setQueueTotalAction] = useState(0);
  const [queueTab, setQueueTab] = useState<"actions" | "messages" | "photos">("actions");
  const [queueDrafts, setQueueDrafts] = useState<Record<string, QueueActionDraft>>({});
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
        total_action_lines?: number;
        messages?: PendingQueueMessage[];
        groups?: PendingQueueGroup[];
        recent_attachments?: PendingQueueAttachment[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || res.statusText);
      const list = data.messages ?? [];
      const groups = data.groups ?? [];
      const attachments = (data.recent_attachments ?? []).filter((attachment) => attachment.url);
      setQueueTotalNew(typeof data.total_new_lines === "number" ? data.total_new_lines : 0);
      setQueueTotalAction(typeof data.total_action_lines === "number" ? data.total_action_lines : 0);
      setQueueMessages(list);
      setQueueGroups(groups);
      setQueueAttachments(attachments);

      const sig = list
        .map((m) => `${m.inbox_id}:${(m.action_lines ?? m.new_lines).map((l) => l.item_index).join(",")}`)
        .join("|");
      if (sig !== queueSigRef.current) {
        queueSigRef.current = sig;
        const nextDes: Record<string, Set<number>> = {};
        for (const m of list) {
          nextDes[m.inbox_id] = new Set();
        }
        setQueueDeselected(nextDes);
        const nextDrafts: Record<string, QueueActionDraft> = {};
        for (const group of groups) {
          const fallbackAssignee = resolveSaleStaffForOrder(group.sale, saleAssigneesBySale);
          for (const message of group.messages) {
            for (const line of message.action_lines ?? []) {
              nextDrafts[queueSuggestionRowKey(message.inbox_id, line.item_index)] = queueActionDraftForLine(
                line,
                fallbackAssignee
              );
            }
          }
        }
        setQueueDrafts(nextDrafts);
      }
    } catch {
      setQueueMessages([]);
      setQueueGroups([]);
      setQueueAttachments([]);
      setQueueTotalNew(0);
      setQueueTotalAction(0);
      setQueueDrafts({});
    } finally {
      setQueueLoading(false);
    }
  }, [saleAssigneesBySale]);

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

  const visibleOrders = useMemo(() => {
    const q = normalizeSearchText(carSearch);
    const filtered = q
      ? orders.filter((o) =>
          normalizeSearchText(
            `${o.fullPlate} ${o.car} ${o.chassis ?? ""} ${o.sale ?? ""} ${o.carRowId ?? ""} ${o.carId ?? ""}`
          ).includes(q)
        )
      : orders;
    if (selected && !filtered.some((o) => o.id === selected.id)) {
      return [selected, ...filtered];
    }
    return filtered;
  }, [carSearch, orders, selected]);

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
        ignoredNoiseLines.length ||
        rows.some((row) => String(row.reason ?? "").trim())
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
    for (const draft of Object.values(queueDrafts)) addUniqueOption(out, draft.assignee);
    return out;
  }, [existingItems, queueDrafts, rows, staffOptions]);

  const statusChoices = useMemo(() => {
    const out: string[] = [];
    for (const status of statusOptions) addUniqueOption(out, status);
    for (const status of ["เช็ค", "มี", "สั่ง", "มา", "รถนอก", "ช่างนอก", "จบ"]) {
      addUniqueOption(out, status);
    }
    for (const item of existingItems) addUniqueOption(out, item.status);
    for (const row of rows) addUniqueOption(out, row.status);
    for (const draft of Object.values(queueDrafts)) addUniqueOption(out, draft.status);
    return out;
  }, [existingItems, queueDrafts, rows, statusOptions]);

  const pendingSaveCount = useMemo(
    () => rows.filter((r) => r.included && r.action !== "skip").length,
    [rows]
  );
  const selectedRiskCount = useMemo(
    () => rows.filter((r) => r.included && r.action !== "skip" && r.duplicate_status !== "new").length,
    [rows]
  );

  const suggestionPhotoSheetRow = useMemo(() => {
    if (!suggestionPhotoSheet) return null;
    if (suggestionPhotoSheet.rowIndex < 0) return null;
    return rows[suggestionPhotoSheet.rowIndex] ?? null;
  }, [rows, suggestionPhotoSheet]);

  const suggestionPhotoSheetItemId = String(
    suggestionPhotoSheetRow?.matched_order_item_id ?? ""
  ).trim();
  const canUseSuggestionPhotoSheet = Boolean(
    suggestionPhotoSheetItemId && (effectiveCarRowId || effectiveCarId != null)
  );
  const stagedPhotosForOpenSheet = suggestionPhotoSheet
    ? stagedSuggestionPhotos[suggestionPhotoSheet.rowKey] ?? []
    : [];
  const stagedLineAttachmentsForOpenSheet = suggestionPhotoSheet
    ? stagedLineAttachments[suggestionPhotoSheet.rowKey] ?? []
    : [];

  const rawBadgeTotal = (queueTotalAction || queueTotalNew) + pendingSaveCount;
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

  const updateQueueDraft = useCallback((rowKey: string, patch: Partial<QueueActionDraft>) => {
    setQueueDrafts((prev) => ({
      ...prev,
      [rowKey]: {
        ...(prev[rowKey] ?? {
          included: false,
          action: "create",
          itemName: "",
          assignee: "",
          status: "",
          note: "",
          dueDate: "",
          orderItemId: "",
        }),
        ...patch,
      },
    }));
  }, []);

  const selectedIndicesForInbox = useCallback(
    (m: PendingQueueMessage) => {
      const des = queueDeselected[m.inbox_id] ?? new Set();
      return m.new_lines.map((l) => l.item_index).filter((idx) => !des.has(idx));
    },
    [queueDeselected]
  );

  const selectedQueueActionsForInbox = useCallback(
    (m: PendingQueueMessage) => {
      return (m.action_lines ?? []).flatMap((line) => {
        const rowKey = queueSuggestionRowKey(m.inbox_id, line.item_index);
        const draft = queueDrafts[rowKey] ?? queueActionDraftForLine(line, "");
        if (!draft.included || draft.action === "skip") return [];
        return [
          {
            item_index: line.item_index,
            action: draft.action,
            order_item_id: draft.action === "merge" ? draft.orderItemId || line.matched_order_item_id : undefined,
            item_name: draft.itemName || line.suggested_item_name || line.raw_text,
            item_status: draft.status || line.suggested_status || undefined,
            note: draft.note || undefined,
            assignee_staff: draft.assignee || undefined,
            due_date: safeDateValue(draft.dueDate) || undefined,
          },
        ];
      });
    },
    [queueDrafts]
  );

  const clearStagedForRowKeys = useCallback((rowKeys: string[]) => {
    const keySet = new Set(rowKeys);
    if (keySet.size === 0) return;
    setStagedSuggestionPhotos((prev) => {
      const next = { ...prev };
      keySet.forEach((key) => {
        (next[key] ?? []).forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
        delete next[key];
      });
      return next;
    });
    setStagedLineAttachments((prev) => {
      const next = { ...prev };
      keySet.forEach((key) => delete next[key]);
      return next;
    });
  }, []);

  const runAnalyze = useCallback(async () => {
    setError(null);
    setSaveHint(null);
    setReplyText("");
    setReplyCopied(false);
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
      setSuggestionPhotoSheet(null);
      setSuggestionItemPhotos([]);
      setStagedSuggestionPhotos((prev) => {
        revokeStagedPhotoMap(prev);
        return {};
      });
      setStagedLineAttachments({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
      setExpandedRows({});
      setSuggestionPhotoSheet(null);
      setSuggestionItemPhotos([]);
      setStagedSuggestionPhotos((prev) => {
        revokeStagedPhotoMap(prev);
        return {};
      });
      setStagedLineAttachments({});
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

  const toggleRowExpanded = useCallback((rowKey: string) => {
    setExpandedRows((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }));
  }, []);

  const openSuggestionPhotoSheet = useCallback((rowKey: string, rowIndex: number, itemName?: string) => {
    setSuggestionPhotoSheet({ rowKey, rowIndex, itemName });
    setSuggestionItemPhotos([]);
  }, []);

  const closeSuggestionPhotoSheet = useCallback(() => {
    setSuggestionPhotoSheet(null);
    setSuggestionItemPhotos([]);
  }, []);

  const clearStagedSuggestionPhotos = useCallback(() => {
    setStagedSuggestionPhotos((prev) => {
      revokeStagedPhotoMap(prev);
      return {};
    });
  }, []);

  const clearStagedLineAttachments = useCallback(() => {
    setStagedLineAttachments({});
  }, []);

  const stageSuggestionPhotos = useCallback((rowKey: string, files: FileList | null) => {
    const images = Array.from(files ?? []).filter((file) => String(file.type ?? "").startsWith("image/"));
    if (!images.length) return;
    setStagedSuggestionPhotos((prev) => ({
      ...prev,
      [rowKey]: [
        ...(prev[rowKey] ?? []),
        ...images.map((file) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          file,
          previewUrl: URL.createObjectURL(file),
        })),
      ],
    }));
  }, []);

  const removeStagedSuggestionPhoto = useCallback((rowKey: string, photoId: string) => {
    setStagedSuggestionPhotos((prev) => {
      const current = prev[rowKey] ?? [];
      const target = current.find((photo) => photo.id === photoId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      const nextList = current.filter((photo) => photo.id !== photoId);
      const next = { ...prev };
      if (nextList.length) next[rowKey] = nextList;
      else delete next[rowKey];
      return next;
    });
  }, []);

  const toggleStagedLineAttachment = useCallback((rowKey: string, attachment: PendingQueueAttachment) => {
    const id = String(attachment.line_message_id || attachment.url).trim();
    if (!id || !attachment.url) return;
    setStagedLineAttachments((prev) => {
      const current = prev[rowKey] ?? [];
      const exists = current.some((item) => String(item.line_message_id || item.url).trim() === id);
      const nextList = exists
        ? current.filter((item) => String(item.line_message_id || item.url).trim() !== id)
        : [...current, attachment];
      const next = { ...prev };
      if (nextList.length) next[rowKey] = nextList;
      else delete next[rowKey];
      return next;
    });
  }, []);

  const loadSuggestionItemPhotos = useCallback(
    async (orderItemId: string) => {
      const itemId = String(orderItemId ?? "").trim();
      if (!itemId || (!effectiveCarRowId && effectiveCarId == null)) {
        setSuggestionItemPhotos([]);
        return;
      }
      setSuggestionPhotosLoading(true);
      try {
        const params = new URLSearchParams();
        if (effectiveCarRowId) params.set("car_row_id", effectiveCarRowId);
        if (effectiveCarId != null) params.set("car_id", String(effectiveCarId));
        const res = await fetch(`/api/m/order-photos/list?${params.toString()}`, {
          credentials: "same-origin",
        });
        const data = (await res.json()) as {
          error?: string;
          itemPhotosByItemId?: Record<string, LineInboxItemPhoto[]>;
        };
        if (!res.ok) throw new Error(data.error || res.statusText || "load photos failed");
        setSuggestionItemPhotos(data.itemPhotosByItemId?.[itemId] ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setSuggestionItemPhotos([]);
      } finally {
        setSuggestionPhotosLoading(false);
      }
    },
    [effectiveCarId, effectiveCarRowId]
  );

  const uploadSuggestionPhotos = useCallback(
    async (
      rowKey: string,
      orderItemId: string | null | undefined,
      files: FileList | File[] | null,
      options: { silent?: boolean; carRowId?: string | null; carId?: number | null } = {}
    ) => {
      const itemId = String(orderItemId ?? "").trim();
      if (!itemId || !files?.length) return;
      const uploadCarRowId = String(options.carRowId ?? effectiveCarRowId ?? "").trim();
      const uploadCarId = options.carId !== undefined ? options.carId : effectiveCarId;
      if (!uploadCarRowId && uploadCarId == null) return;
      setPhotoBusyRowKey(rowKey);
      setError(null);
      if (!options.silent) setSaveHint(null);
      try {
        const form = new FormData();
        form.append("target_type", "item");
        form.append("order_item_id", itemId);
        if (uploadCarRowId) form.append("car_row_id", uploadCarRowId);
        if (uploadCarId != null) form.append("car_id", String(uploadCarId));
        Array.from(files).forEach((file) => form.append("files", file));
        const res = await fetch("/api/m/order-photos/upload", {
          method: "POST",
          body: form,
          credentials: "same-origin",
        });
        const data = (await res.json()) as { ok?: boolean; error?: string; uploaded?: unknown[] };
        if (!res.ok) throw new Error(data.error || res.statusText || "upload failed");
        const count = Array.isArray(data.uploaded) ? data.uploaded.length : files.length;
        if (!options.silent) {
          setSaveHint(uiLang === "en" ? `Attached ${count} photo(s).` : `แนบรูปแล้ว ${count} รูป`);
        }
        await loadSuggestionItemPhotos(itemId);
        onSaved?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPhotoBusyRowKey((cur) => (cur === rowKey ? null : cur));
      }
    },
    [effectiveCarId, effectiveCarRowId, loadSuggestionItemPhotos, onSaved, uiLang]
  );

  const attachSuggestionPhotoUrls = useCallback(
    async (
      rowKey: string,
      orderItemId: string | null | undefined,
      urls: string[],
      options: { silent?: boolean; carRowId?: string | null; carId?: number | null } = {}
    ) => {
      const itemId = String(orderItemId ?? "").trim();
      const uniqueUrls = Array.from(new Set(urls.map((url) => String(url ?? "").trim()).filter(Boolean)));
      if (!itemId || uniqueUrls.length === 0) return;
      const uploadCarRowId = String(options.carRowId ?? effectiveCarRowId ?? "").trim();
      const uploadCarId = options.carId !== undefined ? options.carId : effectiveCarId;
      if (!uploadCarRowId && uploadCarId == null) return;
      setPhotoBusyRowKey(rowKey);
      setError(null);
      if (!options.silent) setSaveHint(null);
      try {
        const res = await fetch("/api/m/order-photos/fetch-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            target_type: "item",
            order_item_id: itemId,
            car_row_id: uploadCarRowId || undefined,
            car_id: uploadCarId,
            urls: uniqueUrls,
          }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string; uploaded?: unknown[] };
        if (!res.ok) throw new Error(data.error || res.statusText || "attach URL failed");
        const count = Array.isArray(data.uploaded) ? data.uploaded.length : uniqueUrls.length;
        if (!options.silent) {
          setSaveHint(uiLang === "en" ? `Attached ${count} LINE photo(s).` : `แนบรูปจาก LINE แล้ว ${count} รูป`);
        }
        await loadSuggestionItemPhotos(itemId);
        onSaved?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPhotoBusyRowKey((cur) => (cur === rowKey ? null : cur));
      }
    },
    [effectiveCarId, effectiveCarRowId, loadSuggestionItemPhotos, onSaved, uiLang]
  );

  const saveQueueCard = useCallback(
    async (m: PendingQueueMessage) => {
      const actions = selectedQueueActionsForInbox(m);
      const indices = actions.length > 0 ? [] : selectedIndicesForInbox(m);
      const selectedCount = actions.length || indices.length;
      if (selectedCount === 0) return;
      const riskyCount = (m.action_lines ?? []).filter((line) => {
        const rowKey = queueSuggestionRowKey(m.inbox_id, line.item_index);
        const draft = queueDrafts[rowKey] ?? queueActionDraftForLine(line, "");
        return draft.included && draft.action !== "skip" && line.duplicate_status !== "new";
      }).length;
      if (riskyCount > 0) {
        const ok = window.confirm(`${riskyCount} selected queue item(s) may be duplicate or unclear. Continue?`);
        if (!ok) return;
      }
      setSavingInboxId(m.inbox_id);
      setError(null);
      setSaveHint(null);
      setReplyText("");
      setReplyCopied(false);
      try {
        const res = await fetch("/api/line-inbox/pending-save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            saves: [
              actions.length > 0
                ? { inbox_message_id: m.inbox_id, actions }
                : { inbox_message_id: m.inbox_id, item_indices: indices },
            ],
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          results?: Array<{
            inbox_message_id: string;
            saved_items?: Array<{ item_index: number; order_item_id: string }>;
          }>;
        };
        if (!res.ok) throw new Error(data.error || res.statusText);

        const savedItems =
          data.results?.flatMap((result) =>
            result.inbox_message_id === m.inbox_id ? result.saved_items ?? [] : []
          ) ?? [];
        let attachedPhotoCount = 0;
        const touchedRowKeys: string[] = [];

        for (const saved of savedItems) {
          const rowKey = queueSuggestionRowKey(m.inbox_id, saved.item_index);
          const savedItemId = String(saved.order_item_id ?? "").trim();
          if (!savedItemId) continue;
          touchedRowKeys.push(rowKey);

          const staged = stagedSuggestionPhotos[rowKey] ?? [];
          const stagedLineUrls = (stagedLineAttachments[rowKey] ?? [])
            .map((attachment) => attachment.url)
            .filter(Boolean);

          if (staged.length > 0) {
            await uploadSuggestionPhotos(
              rowKey,
              savedItemId,
              staged.map((photo) => photo.file),
              { silent: true, carRowId: m.car_row_id }
            );
            attachedPhotoCount += staged.length;
          }

          if (stagedLineUrls.length > 0) {
            await attachSuggestionPhotoUrls(rowKey, savedItemId, stagedLineUrls, {
              silent: true,
              carRowId: m.car_row_id,
            });
            attachedPhotoCount += stagedLineUrls.length;
          }
        }

        clearStagedForRowKeys(touchedRowKeys);
        setSaveHint(
          uiLang === "en"
            ? `Saved ${selectedCount} item(s) from LINE queue${attachedPhotoCount ? ` + attached ${attachedPhotoCount} photo(s)` : ""}.`
            : `บันทึกจากคิว LINE แล้ว ${selectedCount} งาน${attachedPhotoCount ? ` + แนบรูป ${attachedPhotoCount} รูป` : ""}`
        );
        const savedLines =
          actions.length > 0
            ? actions.map((line) => ({
                name: String(line.item_name ?? "").trim(),
                status: String(line.item_status ?? "").trim() || "เช็ค",
              }))
            : m.new_lines
                .filter((line) => indices.includes(line.item_index))
                .map((line) => ({
                  name: line.suggested_item_name || line.raw_text,
                  status: line.suggested_status || "เช็ค",
                }));
        setReplyText(
          buildLineReplyText({
            plate: m.plate_display || "",
            lines: savedLines,
            uiLang,
          })
        );
        await fetchQueue();
        onSaved?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingInboxId(null);
      }
    },
    [
      attachSuggestionPhotoUrls,
      clearStagedForRowKeys,
      fetchQueue,
      onSaved,
      queueDrafts,
      selectedQueueActionsForInbox,
      selectedIndicesForInbox,
      stagedLineAttachments,
      stagedSuggestionPhotos,
      uiLang,
      uploadSuggestionPhotos,
    ]
  );

  const skipQueueCard = useCallback(
    async (m: PendingQueueMessage) => {
      setSavingInboxId(m.inbox_id);
      setError(null);
      setSaveHint(null);
      try {
        const res = await fetch("/api/line-inbox/pending-save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            saves: [{ inbox_message_id: m.inbox_id, skip_all: true }],
          }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok) throw new Error(data.error || res.statusText);
        const rowKeys = (m.action_lines ?? m.new_lines).map((line) =>
          queueSuggestionRowKey(m.inbox_id, line.item_index)
        );
        clearStagedForRowKeys(rowKeys);
        setSaveHint(uiLang === "en" ? "Skipped this LINE queue message." : "ข้ามข้อความ LINE นี้แล้ว");
        await fetchQueue();
        onSaved?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingInboxId(null);
      }
    },
    [clearStagedForRowKeys, fetchQueue, onSaved, uiLang]
  );

  useEffect(() => {
    if (!suggestionPhotoSheet) return;
    if (!suggestionPhotoSheetItemId || !canUseSuggestionPhotoSheet) {
      setSuggestionItemPhotos([]);
      return;
    }
    void loadSuggestionItemPhotos(suggestionPhotoSheetItemId);
  }, [
    canUseSuggestionPhotoSheet,
    loadSuggestionItemPhotos,
    suggestionPhotoSheet,
    suggestionPhotoSheetItemId,
  ]);

  const copyReply = useCallback(async () => {
    const text = replyText.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setReplyCopied(true);
      window.setTimeout(() => setReplyCopied(false), 1400);
    } catch {
      window.prompt(uiLang === "en" ? "Copy LINE reply" : "คัดลอกข้อความตอบ LINE", text);
    }
  }, [replyText, uiLang]);

  const runConfirm = useCallback(async () => {
    setError(null);
    setSaveHint(null);
    setReplyText("");
    setReplyCopied(false);
    setConfirmLoading(true);
    try {
      if (!effectiveCarRowId && effectiveCarId == null) {
        throw new Error(
          uiLang === "en"
            ? "Pick a car from the list or run analyze so the car matches."
            : "เลือกรถจากรายการ หรือให้วิเคราะห์จับคู่รถได้ก่อนบันทึก"
        );
      }
      const selectedRows = rows.filter((r) => r.included && r.action !== "skip");
      const riskyRows = selectedRows.filter((r) => r.duplicate_status !== "new");
      if (riskyRows.length > 0) {
        const ok = window.confirm(
          uiLang === "en"
            ? `${riskyRows.length} selected line(s) may be duplicate or unclear. Continue saving?`
            : `มี ${riskyRows.length} รายการที่อาจซ้ำหรือไม่ชัด ต้องการบันทึกต่อหรือไม่?`
        );
        if (!ok) return;
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
      const actionableRowKeys = rows
        .map((r, index) => ({
          row: r,
          rowKey: `${r.raw_text}-${r.matched_order_item_id ?? ""}-${index}`,
        }))
        .filter(({ row }) => row.included && row.action !== "skip");
      let attachedPhotoCount = 0;
      for (let i = 0; i < actionableRowKeys.length; i += 1) {
        const savedItemId = String(data.saved?.[i]?.order_item_id ?? "").trim();
        const rowKey = actionableRowKeys[i]?.rowKey ?? "";
        const staged = rowKey ? stagedSuggestionPhotos[rowKey] ?? [] : [];
        const stagedLineUrls = rowKey
          ? (stagedLineAttachments[rowKey] ?? []).map((attachment) => attachment.url).filter(Boolean)
          : [];
        if (!savedItemId) continue;
        if (staged.length > 0) {
          await uploadSuggestionPhotos(
            rowKey,
            savedItemId,
            staged.map((photo) => photo.file),
            { silent: true }
          );
          attachedPhotoCount += staged.length;
        }
        if (stagedLineUrls.length > 0) {
          await attachSuggestionPhotoUrls(rowKey, savedItemId, stagedLineUrls, { silent: true });
          attachedPhotoCount += stagedLineUrls.length;
        }
      }
      setSaveHint(
        uiLang === "en"
          ? `Saved ${count} line(s)${attachedPhotoCount ? ` + attached ${attachedPhotoCount} photo(s)` : ""}.`
          : `บันทึกแล้ว ${count} รายการ${attachedPhotoCount ? ` + แนบรูป ${attachedPhotoCount} รูป` : ""}`
      );
      setReplyText(
        buildLineReplyText({
          plate: detectedOrder?.fullPlate || selected?.fullPlate || detected?.plate_text || "",
          lines: selectedRows.map((row) => ({
            name: String(row.itemName || row.suggested_item_name || row.raw_text).trim(),
            status: String(row.status || row.suggested_status || "เช็ค").trim(),
          })),
          uiLang,
        })
      );
      setRows([]);
      setExpandedRows({});
      setSuggestionPhotoSheet(null);
      setSuggestionItemPhotos([]);
      clearStagedSuggestionPhotos();
      clearStagedLineAttachments();
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
  }, [
    attachSuggestionPhotoUrls,
    clearStagedLineAttachments,
    clearStagedSuggestionPhotos,
    detected,
    detectedOrder,
    effectiveCarId,
    effectiveCarRowId,
    rows,
    onSaved,
    selected,
    stagedLineAttachments,
    stagedSuggestionPhotos,
    uiLang,
    uploadSuggestionPhotos,
  ]);

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
                ? `Action queue · ${queueTotalAction || queueTotalNew} pending action(s) · auto-refresh ~45s`
                : `รอจัดการ · ${queueTotalAction || queueTotalNew} รายการ · รีเฟรชอัตโนมัติ ~45 วินาที`}
            </p>
            <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
              {[
                { key: "actions" as const, label: uiLang === "en" ? "Action queue" : "รอจัดการ" },
                { key: "messages" as const, label: uiLang === "en" ? "Messages" : "ข้อความเข้าใหม่" },
                { key: "photos" as const, label: uiLang === "en" ? "LINE photos" : "รูปจาก LINE" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setQueueTab(tab.key)}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 touch-manipulation",
                    queueTab === tab.key
                      ? "bg-slate-950 text-white ring-slate-950"
                      : "bg-slate-50 text-slate-700 ring-slate-200"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {queueTab === "actions" ? (
              queueLoading ? (
                <p className="text-[11px] text-slate-500">{uiLang === "en" ? "Loading…" : "กำลังโหลด…"}</p>
              ) : queueGroups.length === 0 ? (
                <p className="text-[11px] text-slate-500">
                  {uiLang === "en" ? "No analyzed LINE actions are waiting." : "ยังไม่มีรายการ LINE ที่รอจัดการ"}
                </p>
              ) : (
                <ul className="max-h-[min(58vh,520px)] space-y-3 overflow-y-auto overscroll-contain pr-1">
                  {queueGroups.map((group) => (
                    <li
                      key={group.group_key}
                      className="rounded-2xl border border-slate-200 bg-slate-50/90 p-2.5 ring-1 ring-slate-100"
                    >
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm font-bold leading-snug text-violet-950">
                            {group.car_title || group.plate_display || (uiLang === "en" ? "Unmatched car" : "ยังไม่จับรถ")}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] font-semibold text-slate-500">
                            {group.sale ? <span>Sale: {group.sale}</span> : null}
                            <span>{group.messages.length} msg</span>
                            <span>{group.total_action_lines} action</span>
                          </div>
                        </div>
                        {group.is_unresolved ? (
                          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-200">
                            {uiLang === "en" ? "Needs car" : "ต้องเลือกรถ"}
                          </span>
                        ) : null}
                      </div>

                      {group.attachments.length > 0 ? (
                        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
                          {group.attachments.slice(0, 8).map((attachment) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={`${attachment.line_message_id}-${attachment.url}`}
                              src={attachment.url}
                              alt=""
                              className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
                              loading="lazy"
                            />
                          ))}
                        </div>
                      ) : null}

                      <details className="mb-2 rounded-xl bg-white px-2 py-1.5 text-[11px] ring-1 ring-slate-200/80">
                        <summary className="cursor-pointer select-none font-bold text-slate-700">
                          {uiLang === "en" ? "Existing tasks" : "งานเดิมของรถคันนี้"} ({group.existing_items.length})
                        </summary>
                        {group.existing_items.length === 0 ? (
                          <p className="mt-1 text-slate-500">{uiLang === "en" ? "No existing items found." : "ยังไม่พบงานเดิม"}</p>
                        ) : (
                          <ul className="mt-2 space-y-1">
                            {group.existing_items.slice(0, 12).map((item) => (
                              <li key={item.id} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1">
                                <span className="min-w-0 flex-1 font-semibold text-slate-900">{item.label || "-"}</span>
                                {item.assignee_staff ? <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-slate-200">{item.assignee_staff}</span> : null}
                                {item.status ? <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-slate-200">{item.status}</span> : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </details>

                      <div className="space-y-3">
                        {group.messages.map((m) => {
                          const selectedActions = selectedQueueActionsForInbox(m);
                          return (
                            <div key={m.inbox_id} className="rounded-xl bg-white px-2 py-2 ring-1 ring-slate-200/80">
                              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[10px] font-bold text-slate-500">
                                  {m.source_label || "LINE"} · {m.received_at ? new Date(m.received_at).toLocaleString() : ""}
                                </span>
                                {m.needs_human_review ? (
                                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800 ring-1 ring-amber-200">
                                    review
                                  </span>
                                ) : null}
                              </div>
                              {m.raw_text_preview ? (
                                <details className="mb-2 text-[11px] text-slate-500">
                                  <summary className="cursor-pointer select-none font-semibold">
                                    {uiLang === "en" ? "Source message" : "ข้อความต้นทาง"}
                                  </summary>
                                  <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 px-2 py-1.5">{m.raw_text_preview}</p>
                                </details>
                              ) : null}

                              <ul className="space-y-2">
                                {(m.action_lines ?? []).map((line) => {
                                  const rowKey = queueSuggestionRowKey(m.inbox_id, line.item_index);
                                  const draft = queueDrafts[rowKey] ?? queueActionDraftForLine(line, "");
                                  const lineName = draft.itemName || line.suggested_item_name || line.raw_text;
                                  const hasPhotoRef = hasLineInboxPhotoReference(lineName);
                                  const stagedPhotoCount =
                                    (stagedSuggestionPhotos[rowKey]?.length ?? 0) +
                                    (stagedLineAttachments[rowKey]?.length ?? 0);
                                  const canMerge = Boolean(line.matched_order_item_id || draft.orderItemId);
                                  return (
                                    <li
                                      key={line.item_index}
                                      className={cn(
                                        "space-y-2 rounded-xl border p-2",
                                        draft.included ? "border-slate-200 bg-slate-100" : "border-slate-200 bg-slate-50 opacity-80",
                                        line.duplicate_status === "duplicate" ? "bg-amber-50" : "",
                                        line.duplicate_status === "possible_duplicate" ? "bg-orange-50" : ""
                                      )}
                                    >
                                      <div className="flex min-w-0 items-center gap-2">
                                        <input
                                          type="checkbox"
                                          checked={draft.included}
                                          onChange={(event) =>
                                            updateQueueDraft(rowKey, {
                                              included: event.target.checked,
                                              action:
                                                event.target.checked && draft.action === "skip" ? "create" : draft.action,
                                            })
                                          }
                                          className="h-5 w-5 shrink-0 rounded border-slate-400"
                                        />
                                        <LineInboxSuggestedItemNameField
                                          value={lineName}
                                          uiLang={uiLang}
                                          onChange={(value) => updateQueueDraft(rowKey, { itemName: value })}
                                          onPhotoReference={() => openSuggestionPhotoSheet(rowKey, -1, lineName)}
                                        />
                                      </div>
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <LineInboxInlineSelectLink
                                          value={draft.assignee}
                                          options={staffChoices}
                                          onChange={(value) => updateQueueDraft(rowKey, { assignee: value })}
                                          title={uiLang === "en" ? "Owner" : "พนักงาน"}
                                          emptyLabel="-"
                                          className={lineInboxAssigneePillClasses(draft.assignee)}
                                        />
                                        <LineInboxInlineSelectLink
                                          value={draft.status}
                                          options={statusChoices}
                                          onChange={(value) => updateQueueDraft(rowKey, { status: value })}
                                          title={uiLang === "en" ? "Item status" : "สถานะรายการ"}
                                          emptyLabel="-"
                                          className={cn("w-[5.5rem] min-w-[5.5rem]", lineInboxStatusPillClasses(draft.status))}
                                        />
                                        <select
                                          value={draft.action}
                                          onChange={(event) => {
                                            const action = safeQueueAction(event.target.value);
                                            updateQueueDraft(rowKey, {
                                              action,
                                              included: action === "skip" ? false : true,
                                              orderItemId:
                                                action === "merge" ? draft.orderItemId || line.matched_order_item_id : draft.orderItemId,
                                            });
                                          }}
                                          className="h-10 min-h-[40px] rounded-full bg-white px-2 text-[11px] font-bold text-slate-700 shadow-sm ring-1 ring-slate-200"
                                        >
                                          <option value="create">{uiLang === "en" ? "Add new" : "เพิ่มงานใหม่"}</option>
                                          <option value="merge" disabled={!canMerge}>
                                            {uiLang === "en" ? "Merge" : "อัปเดตงานเดิม"}
                                          </option>
                                          <option value="skip">{uiLang === "en" ? "Skip" : "ข้าม"}</option>
                                        </select>
                                        {hasPhotoRef ? (
                                          <button
                                            type="button"
                                            onClick={() => openSuggestionPhotoSheet(rowKey, -1, lineName)}
                                            className={cn(
                                              "h-10 min-h-[40px] rounded-full px-3 text-[11px] font-bold ring-1 touch-manipulation",
                                              stagedPhotoCount > 0
                                                ? "bg-violet-700 text-white ring-violet-700"
                                                : "bg-sky-50 text-sky-700 ring-sky-200"
                                            )}
                                          >
                                            {uiLang === "en" ? "Photo" : "รูป"}
                                            {stagedPhotoCount > 0 ? ` ${stagedPhotoCount}` : ""}
                                          </button>
                                        ) : null}
                                      </div>
                                      {line.matched_item_name ? (
                                        <p className="text-[10px] font-medium text-amber-800">
                                          {uiLang === "en" ? "Similar existing" : "คล้ายงานเดิม"}: {line.matched_item_name}
                                        </p>
                                      ) : null}
                                      <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                                        <input
                                          type="date"
                                          value={draft.dueDate}
                                          onChange={(event) => updateQueueDraft(rowKey, { dueDate: event.target.value })}
                                          className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-[12px] font-semibold text-slate-900"
                                        />
                                        <input
                                          value={draft.note}
                                          onChange={(event) => updateQueueDraft(rowKey, { note: event.target.value })}
                                          placeholder={uiLang === "en" ? "Note (optional)" : "หมายเหตุ (ถ้ามี)"}
                                          className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-[12px] text-slate-900 outline-none ring-violet-400 focus:ring-2"
                                        />
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                              {!m.car_row_id ? (
                                <p className="mt-2 text-[11px] font-medium text-rose-700">
                                  {uiLang === "en" ? "Car is not matched yet; save is disabled." : "ยังจับรถไม่ได้ จึงยังบันทึกไม่ได้"}
                                </p>
                              ) : null}
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={savingInboxId === m.inbox_id || selectedActions.length === 0 || !m.car_row_id}
                                  onClick={() => void saveQueueCard(m)}
                                  className="touch-manipulation bg-slate-950 hover:bg-slate-900"
                                >
                                  {savingInboxId === m.inbox_id
                                    ? uiLang === "en"
                                      ? "Saving…"
                                      : "กำลังบันทึก…"
                                    : uiLang === "en"
                                      ? `Approve (${selectedActions.length})`
                                      : `อนุมัติ (${selectedActions.length})`}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={savingInboxId === m.inbox_id}
                                  onClick={() => void skipQueueCard(m)}
                                  className="touch-manipulation"
                                >
                                  {uiLang === "en" ? "Skip all" : "ข้ามทั้งหมด"}
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              )
            ) : queueTab === "photos" ? (
              queueAttachments.length === 0 ? (
                <p className="text-[11px] text-slate-500">{uiLang === "en" ? "No captured LINE photos yet." : "ยังไม่มีรูปจาก LINE"}</p>
              ) : (
                <div className="grid max-h-[min(45vh,320px)] grid-cols-4 gap-2 overflow-y-auto pr-1">
                  {queueAttachments.slice(0, 40).map((attachment) => (
                    <a
                      key={`${attachment.line_message_id}-${attachment.url}`}
                      href={attachment.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={attachment.url} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              )
            ) : queueLoading ? (
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
                          const lineName = line.suggested_item_name || line.raw_text;
                          const hasPhotoRef = hasLineInboxPhotoReference(lineName);
                          const rowKey = queueSuggestionRowKey(m.inbox_id, line.item_index);
                          const stagedPhotoCount =
                            (stagedSuggestionPhotos[rowKey]?.length ?? 0) +
                            (stagedLineAttachments[rowKey]?.length ?? 0);
                          return (
                            <li key={line.item_index}>
                              <div className="flex items-start gap-2 rounded-lg bg-white/80 px-2 py-1.5 ring-1 ring-slate-200/80">
                                <label className="flex min-w-0 flex-1 cursor-pointer gap-2">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleQueueLine(m.inbox_id, line.item_index)}
                                    className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-400"
                                  />
                                  <span className="min-w-0 flex-1 text-[12px] font-medium leading-snug text-slate-900">
                                    {lineName}
                                  </span>
                                </label>
                                {hasPhotoRef ? (
                                  <button
                                    type="button"
                                    onClick={() => openSuggestionPhotoSheet(rowKey, -1, lineName)}
                                    className={cn(
                                      "shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ring-1 touch-manipulation",
                                      stagedPhotoCount > 0
                                        ? "bg-violet-700 text-white ring-violet-700"
                                        : "bg-sky-50 text-sky-700 ring-sky-200"
                                    )}
                                    title={uiLang === "en" ? "Choose LINE photo" : "เลือกรูปจาก LINE"}
                                  >
                                    {uiLang === "en" ? "Photo" : "รูป"}
                                    {stagedPhotoCount > 0 ? ` ${stagedPhotoCount}` : ""}
                                  </button>
                                ) : null}
                              </div>
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
            {uiLang === "en" ? "Search/select car" : "ค้นหา/เลือกรถ"}
            <input
              value={carSearch}
              onChange={(e) => setCarSearch(e.target.value)}
              placeholder={uiLang === "en" ? "Plate / chassis / keyword" : "ทะเบียน / เลขถัง / คำค้นรถ"}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm font-medium text-slate-900 outline-none ring-violet-400 focus:ring-2"
              autoComplete="off"
            />
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
                  {visibleOrders.length === 0 ? (
                    <option value="" disabled>
                      {uiLang === "en" ? "No car matches this search" : "ไม่พบรถตามคำค้น"}
                    </option>
                  ) : (
                    visibleOrders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {(o.fullPlate || "-").trim()} · {(o.car || "").slice(0, 42)}
                      </option>
                    ))
                  )}
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

          {replyText ? (
            <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50 px-2.5 py-2 text-xs text-sky-950">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">
                  {uiLang === "en" ? "Copy-ready LINE reply" : "ข้อความตอบ LINE พร้อมคัดลอก"}
                </p>
                <button
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => void copyReply()}
                  className="inline-flex min-h-8 items-center gap-1 rounded-full bg-slate-950 px-3 py-1 text-[11px] font-bold text-white touch-manipulation"
                >
                  {replyCopied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                  {replyCopied
                    ? uiLang === "en"
                      ? "Copied"
                      : "คัดลอกแล้ว"
                    : uiLang === "en"
                      ? "Copy"
                      : "คัดลอกข้อความตอบ LINE"}
                </button>
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-white/85 p-2 text-[11px] leading-relaxed text-slate-800 ring-1 ring-sky-100">
                {replyText}
              </pre>
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
              {rows.some((row) => String(row.reason ?? "").trim()) ? (
                <div className="mt-2">
                  <p className="font-semibold text-slate-700">
                    {uiLang === "en" ? "AI / duplicate reasons" : "เหตุผล AI / duplicate"}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {rows
                      .map((row) => String(row.reason ?? "").trim())
                      .filter(Boolean)
                      .slice(0, 8)
                      .map((reason, index) => (
                        <li key={`line-inbox-reason-${index}`} className="line-clamp-2">
                          {reason}
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
                        <LineInboxSuggestedItemNameField
                          value={row.itemName}
                          uiLang={uiLang}
                          onChange={(value) => updateRow(i, { itemName: value })}
                          onPhotoReference={() => openSuggestionPhotoSheet(rowKey, i)}
                        />
                        <div className="flex shrink-0 items-center gap-1.5">
                          <LineInboxInlineSelectLink
                            value={row.assignee}
                            options={staffChoices}
                            onChange={(value) => updateRow(i, { assignee: value })}
                            title={uiLang === "en" ? "Owner" : "พนักงาน"}
                            emptyLabel={uiLang === "en" ? "-" : "—"}
                            className={lineInboxAssigneePillClasses(row.assignee)}
                          />
                          <LineInboxInlineSelectLink
                            value={row.status}
                            options={statusChoices}
                            onChange={(value) => updateRow(i, { status: value })}
                            title={uiLang === "en" ? "Item status" : "สถานะรายการ"}
                            emptyLabel={uiLang === "en" ? "-" : "—"}
                            className={cn(
                              "w-[5.5rem] min-w-[5.5rem] font-medium sm:w-[6.25rem]",
                              lineInboxStatusPillClasses(row.status)
                            )}
                          />
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

                      <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)]">
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

                      {row.suggested_note ? (
                        <p className="rounded-lg bg-sky-50 px-2 py-1.5 text-[11px] leading-snug text-sky-900 ring-1 ring-sky-200/80">
                          {uiLang === "en" ? "Reference from LINE" : "รายละเอียดอ้างอิงจาก LINE"}:{" "}
                          <span className="font-medium">{row.suggested_note}</span>
                        </p>
                      ) : null}

                        </>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              {selectedRiskCount > 0 ? (
                <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-900 ring-1 ring-amber-200/80">
                  {uiLang === "en"
                    ? `${selectedRiskCount} selected line(s) may be duplicate or unclear. You will be asked again before saving.`
                    : `มี ${selectedRiskCount} รายการที่อาจซ้ำหรือไม่ชัด ระบบจะถามยืนยันอีกครั้งก่อนบันทึก`}
                </p>
              ) : null}

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

      {suggestionPhotoSheet ? (
        <div
          role="presentation"
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-2 outline-none sm:p-3"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeSuggestionPhotoSheet();
          }}
        >
          <div className="mb-[max(env(safe-area-inset-bottom),0px)] w-full max-w-md rounded-2xl bg-white p-4 shadow-xl ring-1 ring-slate-200/80">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <b className="text-sm font-semibold text-slate-950">
                  {uiLang === "en" ? "Item Photos" : "รูปตามรายการ"}
                </b>
                <p className="mt-1 line-clamp-2 text-xs font-medium text-slate-600">
                  {String(
                    suggestionPhotoSheetRow?.itemName ||
                      suggestionPhotoSheetRow?.suggested_item_name ||
                      suggestionPhotoSheet.itemName ||
                      ""
                  ).trim() ||
                    (uiLang === "en" ? "Suggested item" : "งานที่ AI เสนอ")}
                </p>
              </div>
              <button
                type="button"
                onClick={closeSuggestionPhotoSheet}
                className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-800 touch-manipulation"
              >
                {uiLang === "en" ? "Close" : "ปิด"}
              </button>
            </div>

            <div className="mb-3">
              <label
                className={cn(
                  "inline-flex min-h-10 w-full cursor-pointer items-center justify-center rounded-xl px-3 text-xs font-semibold touch-manipulation",
                  photoBusyRowKey === suggestionPhotoSheet.rowKey
                    ? "cursor-not-allowed bg-slate-200 text-slate-500"
                    : "bg-sky-600 text-white"
                )}
              >
                {photoBusyRowKey === suggestionPhotoSheet.rowKey
                  ? uiLang === "en"
                    ? "Uploading..."
                    : "กำลังแนบรูป..."
                  : uiLang === "en"
                    ? "Add photo"
                    : "เพิ่มรูป"}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={photoBusyRowKey === suggestionPhotoSheet.rowKey}
                  className="hidden"
                  onChange={(event) => {
                    const files = event.currentTarget.files;
                    if (canUseSuggestionPhotoSheet) {
                      void uploadSuggestionPhotos(
                        suggestionPhotoSheet.rowKey,
                        suggestionPhotoSheetItemId,
                        files
                      );
                    } else {
                      stageSuggestionPhotos(suggestionPhotoSheet.rowKey, files);
                    }
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>

            {queueAttachments.length > 0 ? (
              <div className="mb-3">
                <p className="mb-2 text-[11px] font-semibold text-slate-600">
                  {uiLang === "en" ? "Recent LINE photos" : "รูปจาก LINE ล่าสุด"}
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {queueAttachments.slice(0, 20).map((attachment) => {
                    const selected = stagedLineAttachmentsForOpenSheet.some(
                      (item) => item.line_message_id === attachment.line_message_id
                    );
                    return (
                      <button
                        type="button"
                        key={`${attachment.inbox_id}-${attachment.line_message_id}`}
                        onClick={() => toggleStagedLineAttachment(suggestionPhotoSheet.rowKey, attachment)}
                        className={cn(
                          "relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-100 ring-2",
                          selected ? "ring-violet-500" : "ring-slate-200"
                        )}
                        title={uiLang === "en" ? "Use this LINE photo" : "เลือกรูปจาก LINE นี้"}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={attachment.url}
                          alt={uiLang === "en" ? "LINE photo" : "รูปจาก LINE"}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                        <span
                          className={cn(
                            "absolute inset-x-1 bottom-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                            selected ? "bg-violet-700 text-white" : "bg-white/90 text-slate-700"
                          )}
                        >
                          {selected ? (uiLang === "en" ? "Selected" : "เลือกแล้ว") : uiLang === "en" ? "Use" : "เลือก"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {stagedPhotosForOpenSheet.length > 0 ? (
              <div className="mb-3">
                <p className="mb-2 text-[11px] font-semibold text-slate-600">
                  {uiLang === "en"
                    ? `Ready to attach after save (${stagedPhotosForOpenSheet.length})`
                    : `พร้อมแนบหลังบันทึก (${stagedPhotosForOpenSheet.length})`}
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {stagedPhotosForOpenSheet.map((photo) => (
                    <div
                      key={photo.id}
                      className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.previewUrl}
                        alt={uiLang === "en" ? "Pending item photo" : "รูปที่รอแนบ"}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeStagedSuggestionPhoto(suggestionPhotoSheet.rowKey, photo.id)}
                        className="absolute right-1 top-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white"
                      >
                        {uiLang === "en" ? "Remove" : "ลบ"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {stagedLineAttachmentsForOpenSheet.length > 0 ? (
              <p className="mb-3 rounded-lg bg-violet-50 px-2 py-1.5 text-[11px] font-semibold text-violet-900 ring-1 ring-violet-100">
                {uiLang === "en"
                  ? `LINE photo(s) selected for this item: ${stagedLineAttachmentsForOpenSheet.length}`
                  : `เลือกรูปจาก LINE สำหรับรายการนี้แล้ว ${stagedLineAttachmentsForOpenSheet.length} รูป`}
              </p>
            ) : null}

            {canUseSuggestionPhotoSheet ? (
              suggestionPhotosLoading ? (
                <p className="mb-2 text-center text-xs font-medium text-slate-500">
                  {uiLang === "en" ? "Loading photos..." : "กำลังโหลดรูป..."}
                </p>
              ) : suggestionItemPhotos.length === 0 ? (
                <p className="text-center text-xs font-medium text-slate-500">
                  {uiLang === "en" ? "No photos yet - use Add photo" : "ยังไม่มีรูป - กดเพิ่มรูปได้"}
                </p>
              ) : (
                <div className="flex max-h-48 gap-2 overflow-x-auto overflow-y-auto pb-1">
                  {suggestionItemPhotos.map((photo) => (
                    <a
                      key={photo.id}
                      href={photo.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group relative h-28 w-28 shrink-0 overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.url}
                        alt={uiLang === "en" ? "Item photo thumbnail" : "รูปรายการ"}
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                        loading="lazy"
                      />
                    </a>
                  ))}
                </div>
              )
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
