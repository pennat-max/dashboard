"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardCheck,
  Filter,
  Languages,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Order, OrderItem } from "@/components/orders/mobile-v2/mobile-order-tracking-home";

export type LiffQueueTab = "all" | "check" | "working" | "done";
export type LiffQueueScope = "active" | "shipped" | "all";
type DeliveryRange = "today" | "7" | "30" | "all";

type FilterOption = {
  label: string;
  count: number;
  active: boolean;
};

type LinePendingMessage = {
  inbox_id?: string;
  plate_display?: string;
  raw_text?: string;
  manualCarSearchQuery?: string;
  manual_car_search_query?: string;
  reviewUrl?: string;
  review_url?: string;
  action_lines?: Array<{ suggested_item_name?: string; raw_text?: string }>;
  new_lines?: Array<{ suggested_item_name?: string; raw_text?: string }>;
  attachments?: unknown[];
};

type LinePendingGroup = {
  group_key?: string;
  reviewUrl?: string;
  review_url?: string;
  messages?: LinePendingMessage[];
};

type LinePendingJob = {
  key: string;
  title: string;
  items: string[];
  photoCount: number;
  href: string;
};

type Props = {
  orders: Order[];
  scope: LiffQueueScope;
  onScopeChange: (scope: LiffQueueScope) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onClearSearch: () => void;
  activeTab: LiffQueueTab;
  onTabChange: (tab: LiffQueueTab) => void;
  activeFilterCount: number;
  saleStatusOptions: FilterOption[];
  onToggleSaleStatus: (label: string) => void;
  saleOptions: FilterOption[];
  onToggleSale: (label: string) => void;
  onClearFilters: () => void;
  hasMore: boolean;
  loadMoreHref: string;
  onLoadMore: () => void;
  isLoading: boolean;
  warning: string | null;
  uiLang: "th" | "en";
  onToggleLanguage: () => void;
};

const DONE_STATUSES = new Set(["มี", "มา", "รถนอก", "ช่างนอก", "จบ"]);

function statusTone(status: string) {
  if (status === "จบ") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (["มี", "มา", "รถนอก", "ช่างนอก"].includes(status)) return "bg-blue-50 text-blue-700 ring-blue-200";
  if (["เช็ค", "ต้องสั่ง", "สั่ง"].includes(status)) return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

function itemIsDone(item: OrderItem): boolean {
  return Boolean(item.good) || DONE_STATUSES.has(item.status);
}

function orderEditorHref(order: Order): string {
  const params = new URLSearchParams();
  params.set("load", "full");
  params.set("scope", order.shipped ? "shipped" : "active");
  const search = order.fullPlate && order.fullPlate !== "-" ? order.fullPlate : order.chassis;
  if (search) params.set("search", search);
  return `/liff/orders?${params.toString()}`;
}

function formatThaiDate(value: string | undefined): string {
  const timestamp = Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestamp)) return "ไม่ระบุวันที่";
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" }).format(timestamp);
}

function insideDeliveryRange(order: Order, range: DeliveryRange): boolean {
  if (range === "all") return true;
  const timestamp = Date.parse(String(order.updatedAt ?? ""));
  if (!Number.isFinite(timestamp)) return true;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (range === "today") return timestamp >= todayStart;
  const days = range === "7" ? 7 : 30;
  return timestamp >= todayStart - (days - 1) * 24 * 60 * 60 * 1000;
}

function normalizeSearch(value: unknown): string {
  return String(value ?? "")
    .replace(/[^0-9a-zA-Z\u0E00-\u0E7F]+/g, "")
    .toLowerCase();
}

function lineJobMatchesSearch(message: LinePendingMessage, searchValue: string): boolean {
  const q = normalizeSearch(searchValue);
  if (!q) return false;
  const candidates = [
    message.plate_display,
    message.manualCarSearchQuery,
    message.manual_car_search_query,
    message.raw_text,
    message.reviewUrl,
    message.review_url,
  ];
  return candidates.some((value) => normalizeSearch(value).includes(q));
}

function lineJobItems(message: LinePendingMessage): string[] {
  const source = [...(message.action_lines ?? []), ...(message.new_lines ?? [])];
  const out: string[] = [];
  for (const line of source) {
    const value = String(line.suggested_item_name ?? line.raw_text ?? "").replace(/\s+/g, " ").trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

function pendingJobsFromGroups(groups: LinePendingGroup[], searchValue: string): LinePendingJob[] {
  const out: LinePendingJob[] = [];
  for (const group of groups) {
    for (const message of group.messages ?? []) {
      if (!lineJobMatchesSearch(message, searchValue)) continue;
      const key = String(message.inbox_id ?? group.group_key ?? out.length);
      const items = lineJobItems(message);
      out.push({
        key,
        title: String(message.plate_display ?? message.manualCarSearchQuery ?? message.raw_text ?? "LINE").replace(/\s+/g, " ").trim(),
        items,
        photoCount: Array.isArray(message.attachments) ? message.attachments.length : 0,
        href: String(message.reviewUrl ?? message.review_url ?? group.reviewUrl ?? group.review_url ?? "/line-jobs-v2"),
      });
    }
  }
  return out.slice(0, 3);
}

function PendingLineJobs({ jobs }: { jobs: LinePendingJob[] }) {
  if (jobs.length === 0) return null;
  return (
    <section className="space-y-3 rounded-[18px] border border-cyan-200 bg-cyan-50 p-4 text-cyan-950 shadow-[0_8px_22px_rgba(8,145,178,0.08)]">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-cyan-700">LINE pending</p>
        <h2 className="mt-1 text-lg font-bold leading-6">งานจาก LINE รอบันทึก</h2>
        <p className="mt-1 text-xs font-medium text-cyan-800">พบงานที่จับคู่รถได้แล้ว แต่ยังไม่ได้บันทึกเข้า Order</p>
      </div>
      {jobs.map((job) => (
        <a key={job.key} href={job.href} className="block rounded-2xl bg-white p-3 ring-1 ring-cyan-100 transition active:scale-[0.99]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-base font-bold text-slate-950">{job.title}</h3>
              <p className="mt-1 text-xs font-semibold text-cyan-700">
                {job.items.length} งาน · {job.photoCount} รูป
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-cyan-100 px-2.5 py-1 text-[11px] font-bold text-cyan-800">เปิดงาน</span>
          </div>
          {job.items.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {job.items.slice(0, 4).map((item) => (
                <li key={item} className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">{item}</li>
              ))}
            </ul>
          ) : null}
        </a>
      ))}
    </section>
  );
}

function TaskCard({ order }: { order: Order }) {
  const items = order.items ?? [];
  const doneCount = items.filter(itemIsDone).length;
  const totalCount = items.length;
  const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const nextItem = items.find((item) => !itemIsDone(item)) ?? items[0] ?? null;
  const status = nextItem?.status ?? (totalCount > 0 ? "จบ" : "ยังไม่มีงาน");
  const heading = order.fullPlate !== "-" ? order.fullPlate : order.car;
  const href = orderEditorHref(order);

  return (
    <a
      href={href}
      aria-label={`เปิดรายละเอียด ${heading}`}
      className="block rounded-[18px] border border-slate-200 bg-white shadow-[0_8px_22px_rgba(15,23,42,0.05)] transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b3b72]"
    >
      <article className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[18px] font-bold leading-6 text-[#071a3a]">{heading}</h2>
          <p className="mt-0.5 line-clamp-1 text-[13px] font-medium text-slate-600">{order.car}</p>
        </div>
        <span className={cn("shrink-0 rounded-xl px-2.5 py-1 text-[11px] font-semibold ring-1", statusTone(status))}>{status}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <p className="truncate text-slate-500">ลูกค้า <span className="font-semibold text-slate-800">{order.buyer || "-"}</span></p>
        <p className="truncate text-right text-slate-500">เซลล์ <span className="font-semibold text-slate-800">{order.sale || "-"}</span></p>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-[#00b884] transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
        <span className="shrink-0 text-xs font-bold tabular-nums text-[#071a3a]">{doneCount}/{totalCount}</span>
      </div>
      <div className="mt-4 flex min-h-12 items-center gap-3 border-t border-slate-100 pt-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium text-slate-500">งานถัดไป</span>
          <span className="block truncate text-[15px] font-semibold text-slate-900">{nextItem?.name || "เพิ่มรายการงาน"}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-[#0b3b72]">
          เปิดรายละเอียด
          <ChevronRight className="size-5" aria-hidden />
        </span>
      </div>
      </article>
    </a>
  );
}

function ShippedRow({ order }: { order: Order }) {
  return (
    <a href={orderEditorHref(order)} className="block rounded-[18px] border border-slate-200 bg-white p-4 shadow-[0_8px_22px_rgba(15,23,42,0.04)] transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b3b72]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[18px] font-bold text-[#071a3a]">{order.fullPlate !== "-" ? order.fullPlate : order.car}</h2>
          <p className="mt-0.5 line-clamp-1 text-sm text-slate-600">{order.car}</p>
        </div>
        <span className="shrink-0 rounded-xl bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">ส่งแล้ว</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-xs">
        <p className="truncate text-slate-500">ลูกค้า <span className="font-semibold text-slate-800">{order.buyer || "-"}</span></p>
        <p className="truncate text-right text-slate-500">เซลล์ <span className="font-semibold text-slate-800">{order.sale || "-"}</span></p>
      </div>
      <p className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-600">
        <CalendarDays className="size-4 text-[#0b3b72]" aria-hidden />
        {order.shipped || `อัปเดต ${formatThaiDate(order.updatedAt)}`}
      </p>
    </a>
  );
}

function FilterChips({ options, onToggle }: { options: FilterOption[]; onToggle: (label: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button type="button" key={option.label} onClick={() => onToggle(option.label)} className={cn("min-h-10 rounded-full px-3 text-sm font-semibold ring-1", option.active ? "bg-[#071a3a] text-white ring-[#071a3a]" : "bg-white text-slate-700 ring-slate-200")}>
          {option.label} <span className={option.active ? "text-white/70" : "text-slate-400"}>{option.count}</span>
        </button>
      ))}
    </div>
  );
}

export function LiffTaskQueueView({
  orders,
  scope,
  onScopeChange,
  searchValue,
  onSearchChange,
  onClearSearch,
  activeTab,
  onTabChange,
  activeFilterCount,
  saleStatusOptions,
  onToggleSaleStatus,
  saleOptions,
  onToggleSale,
  onClearFilters,
  hasMore,
  loadMoreHref,
  onLoadMore,
  isLoading,
  warning,
  uiLang,
  onToggleLanguage,
}: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draftScope, setDraftScope] = useState<LiffQueueScope>(scope);
  const [deliveryRange, setDeliveryRange] = useState<DeliveryRange>("30");
  const [pendingLineJobs, setPendingLineJobs] = useState<LinePendingJob[]>([]);
  const tabs = useMemo(() => [
    { id: "all" as const, label: "ทั้งหมด" },
    { id: "check" as const, label: "ต้องเช็ก" },
    { id: "working" as const, label: "กำลังทำ" },
    { id: "done" as const, label: "เสร็จ" },
  ], []);
  const rangeFilteredOrders = useMemo(
    () => scope === "shipped" ? orders.filter((order) => insideDeliveryRange(order, deliveryRange)) : orders,
    [deliveryRange, orders, scope]
  );

  useEffect(() => {
    const search = String(searchValue ?? "").trim();
    if (!search) {
      setPendingLineJobs([]);
      return;
    }
    const controller = new AbortController();
    fetch("/api/line-inbox/pending-queue?mode=full&filter=all", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json()) as { groups?: LinePendingGroup[] };
        if (!res.ok) throw new Error("LINE pending queue failed");
        setPendingLineJobs(pendingJobsFromGroups(body.groups ?? [], search));
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setPendingLineJobs([]);
      });
    return () => controller.abort();
  }, [searchValue]);

  const openFilters = () => {
    setDraftScope(scope);
    setSheetOpen(true);
  };

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-900 antialiased">
      <div className="mx-auto w-full max-w-lg pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        {scope === "shipped" ? (
          <div className="flex items-center gap-3 bg-white px-4 py-3">
            <button type="button" onClick={() => onScopeChange("active")} aria-label="กลับไปงานปัจจุบัน" className="flex size-11 items-center justify-center rounded-full bg-slate-100 text-[#071a3a]">
              <ArrowLeft className="size-5" aria-hidden />
            </button>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-[#071a3a]">รถส่งแล้ว</h2>
              <p className="text-xs text-slate-500">ไม่แสดงในหน้าหลัก แต่ค้นหาได้เสมอ</p>
            </div>
            <button type="button" onClick={onToggleLanguage} className="min-h-10 rounded-xl px-2 text-xs font-bold text-[#0b3b72]">{uiLang === "th" ? "TH/EN" : "EN/TH"}</button>
          </div>
        ) : null}

        <section className="bg-white px-4 pb-4 pt-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#0b3b72]" strokeWidth={2} aria-hidden />
            <input type="search" value={searchValue} onChange={(event) => onSearchChange(event.target.value)} placeholder="ทะเบียน / เลขตัวถัง" aria-label="ค้นหาทะเบียนหรือเลขตัวถัง" className="h-14 w-full rounded-2xl border border-slate-200 bg-white pl-12 pr-12 text-[16px] font-medium outline-none shadow-sm placeholder:text-slate-400 focus:border-[#0b3b72] focus:ring-2 focus:ring-[#0b3b72]/10" />
            {searchValue ? <button type="button" onClick={onClearSearch} aria-label="ล้างคำค้นหา" className="absolute right-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"><X className="size-5" aria-hidden /></button> : null}
          </div>
        </section>

        {scope === "shipped" ? (
          <section className="space-y-3 border-y border-slate-100 bg-white px-4 pb-4">
            <div className="flex items-center gap-2">
              {(["today", "7", "30", "all"] as DeliveryRange[]).map((range) => (
                <button type="button" key={range} onClick={() => setDeliveryRange(range)} className={cn("min-h-10 flex-1 rounded-xl text-xs font-bold ring-1", deliveryRange === range ? "bg-[#00b884] text-white ring-[#00b884]" : "bg-white text-slate-600 ring-slate-200")}>
                  {range === "today" ? "วันนี้" : range === "all" ? "ทั้งหมด" : `${range} วัน`}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
              <span className="flex items-center gap-2"><Check className="size-5" aria-hidden /> ส่งแล้ว</span>
              <span>{rangeFilteredOrders.length} คัน</span>
            </div>
          </section>
        ) : (
          <>
            <div className="sticky top-[72px] z-20 border-y border-slate-100 bg-white/95 px-4 py-3 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <div className="grid min-w-0 flex-1 grid-cols-4 rounded-2xl bg-slate-100 p-1">
                  {tabs.map((tab) => <button type="button" key={tab.id} onClick={() => onTabChange(tab.id)} className={cn("min-h-11 rounded-xl px-1 text-xs font-semibold", activeTab === tab.id ? "bg-[#071a3a] text-white shadow-sm" : "text-slate-600")}>{tab.label}</button>)}
                </div>
                <button type="button" onClick={openFilters} aria-label="เปิดตัวกรอง" className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white text-[#0b3b72] ring-1 ring-slate-200">
                  <Filter className="size-5" aria-hidden />
                  {activeFilterCount > 0 ? <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-[#00b884] px-1 text-center text-[10px] font-bold leading-5 text-white">{activeFilterCount}</span> : null}
                </button>
              </div>
              <p className="mt-2 text-[11px] font-medium text-slate-500">
                แสดง {rangeFilteredOrders.length} คันแรก · กดโหลดเพิ่มเพื่อดูรายการถัดไป
              </p>
            </div>
          </>
        )}

        {warning ? <div className="mx-4 mt-4 flex items-start gap-2 rounded-2xl bg-amber-50 px-3 py-2.5 text-xs font-medium leading-5 text-amber-900 ring-1 ring-amber-200"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /><span>{warning}</span></div> : null}

        <main className="space-y-3 px-4 py-4">
          <PendingLineJobs jobs={pendingLineJobs} />
          {rangeFilteredOrders.map((order) => scope === "shipped" ? <ShippedRow key={order.id} order={order} /> : <TaskCard key={order.id} order={order} />)}
          {isLoading ? <div className="rounded-[18px] border border-slate-200 bg-white p-4"><div className="h-5 w-2/3 animate-pulse rounded-full bg-slate-200" /><div className="mt-3 h-3 w-1/3 animate-pulse rounded-full bg-slate-100" /><div className="mt-5 h-12 animate-pulse rounded-2xl bg-slate-100" /></div> : null}
          {!isLoading && rangeFilteredOrders.length === 0 ? (
            <div className="rounded-[18px] border border-slate-200 bg-white px-5 py-10 text-center">
              <ClipboardCheck className="mx-auto size-9 text-slate-300" strokeWidth={1.7} aria-hidden />
              <h2 className="mt-3 text-base font-bold text-slate-900">{scope === "shipped" ? "ไม่พบรถส่งแล้วในช่วงนี้" : "ไม่พบงานในคิวนี้"}</h2>
              <p className="mt-1 text-sm text-slate-500">ลองเปลี่ยนช่วงเวลาหรือล้างตัวกรอง</p>
            </div>
          ) : null}
          {hasMore ? (
            <a
              href={loadMoreHref}
              onClick={(event) => {
                event.preventDefault();
                onLoadMore();
              }}
              className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-white text-sm font-semibold text-[#0b3b72] ring-1 ring-slate-200"
            >
              โหลดเพิ่ม
            </a>
          ) : null}
        </main>
      </div>

      {sheetOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40" role="presentation" onClick={() => setSheetOpen(false)}>
          <section role="dialog" aria-modal="true" aria-label="ตัวกรอง" onClick={(event) => event.stopPropagation()} className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-white px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pt-3 shadow-2xl">
            <div className="mx-auto h-1.5 w-12 rounded-full bg-slate-200" />
            <div className="mt-4 flex items-center justify-between"><h2 className="text-2xl font-bold text-[#071a3a]">ตัวกรอง</h2><button type="button" onClick={() => setSheetOpen(false)} className="flex size-10 items-center justify-center rounded-full bg-slate-100" aria-label="ปิด"><X className="size-5" aria-hidden /></button></div>
            <div className="mt-6">
              <h3 className="text-base font-bold text-[#071a3a]">สถานะรถ</h3>
              <div className="mt-3 space-y-2">
                {([
                  ["active", "งานปัจจุบัน", "แสดงเฉพาะรถที่ยังไม่ส่ง"],
                  ["shipped", "ส่งแล้ว", "ดูประวัติรถที่ส่งมอบแล้ว"],
                  ["all", "ทั้งหมด", "ค้นหาทั้งงานปัจจุบันและรถส่งแล้ว"],
                ] as const).map(([value, title, description]) => (
                  <button type="button" key={value} onClick={() => setDraftScope(value)} className="flex min-h-16 w-full items-center gap-3 rounded-2xl px-3 text-left hover:bg-slate-50">
                    <span className={cn("flex size-6 items-center justify-center rounded-full border-2", draftScope === value ? "border-[#00b884]" : "border-slate-300")}>{draftScope === value ? <span className="size-3 rounded-full bg-[#00b884]" /> : null}</span>
                    <span><span className="block text-[16px] font-bold text-slate-900">{title}</span><span className="block text-xs text-slate-500">{description}</span></span>
                  </button>
                ))}
              </div>
            </div>
            {draftScope !== "active" ? (
              <div className="mt-5 border-t border-slate-100 pt-5">
                <h3 className="text-base font-bold text-[#071a3a]">ช่วงเวลาส่งแล้ว</h3>
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {(["today", "7", "30", "all"] as DeliveryRange[]).map((range) => <button type="button" key={range} onClick={() => setDeliveryRange(range)} className={cn("min-h-11 rounded-xl text-xs font-bold ring-1", deliveryRange === range ? "bg-emerald-50 text-emerald-700 ring-emerald-400" : "text-slate-600 ring-slate-200")}>{range === "today" ? "วันนี้" : range === "all" ? "ทั้งหมด" : `${range} วัน`}</button>)}
                </div>
              </div>
            ) : null}
            <div className="mt-5 border-t border-slate-100 pt-5"><h3 className="mb-3 text-sm font-bold text-slate-900">เซลล์</h3><FilterChips options={saleOptions} onToggle={onToggleSale} /></div>
            <div className="mt-5"><h3 className="mb-3 text-sm font-bold text-slate-900">สถานะขายเดิม</h3><FilterChips options={saleStatusOptions} onToggle={onToggleSaleStatus} /></div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => { setDraftScope("active"); setDeliveryRange("30"); onClearFilters(); }} className="min-h-14 rounded-2xl border border-slate-300 text-sm font-bold text-slate-700">ล้างตัวกรอง</button>
              <button type="button" onClick={() => { onScopeChange(draftScope); setSheetOpen(false); }} className="min-h-14 rounded-2xl bg-[#00b884] text-sm font-bold text-white shadow-sm">แสดงผล</button>
            </div>
            <button type="button" onClick={onToggleLanguage} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 text-sm font-semibold text-slate-500"><Languages className="size-4" aria-hidden /> ภาษา: {uiLang === "th" ? "ไทย" : "English"}</button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
