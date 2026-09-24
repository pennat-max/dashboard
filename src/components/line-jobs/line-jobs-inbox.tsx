"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  ExternalLink,
  ImageIcon,
  MessageCircle,
  RefreshCcw,
  Search,
  UserCheck,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ExistingOrderItemRow, LineInboxCarCandidate } from "@/lib/line-inbox/types";

type QueueFilter = "all" | "today" | "manual" | "waiting_for_car";

type QueueCounts = Record<QueueFilter | "yesterday", number>;

type QueueActionLine = {
  raw_text?: string;
  suggested_item_name?: string;
  suggested_note?: string;
  suggested_status?: string;
  duplicate_status?: string;
  matched_item_name?: string;
  confidence?: number;
  default_action?: "create" | "merge" | "skip";
};

type QueueNewLine = {
  raw_text?: string;
  suggested_item_name?: string;
  suggested_status?: string;
  reason?: string;
};

type QueueAttachment = {
  inbox_id: string;
  url?: string;
  file_name?: string | null;
  mime_type?: string | null;
  received_at?: string;
  raw_text_preview?: string;
  rawTextPreview?: string;
};

type QueueMessage = {
  inbox_id: string;
  received_at: string;
  source_label?: string;
  plate_display?: string;
  car_title?: string;
  fallback_title?: string;
  fallbackTitle?: string;
  fallback_description?: string;
  fallbackDescription?: string;
  raw_text?: string;
  raw_text_preview?: string;
  rawTextPreview?: string;
  car_row_id?: string;
  sale?: string;
  extractionStatus?: "ok" | "no_items" | "needs_manual_review" | "matched_no_work";
  matchStatus?: "matched" | "waiting_for_car_record" | "ambiguous_vehicle" | "no_vehicle_context" | "unresolved";
  unmatchedReason?: "" | "pending_car_record" | "multiple_candidates" | "no_car_candidate";
  manual_review_reason?: string;
  action_lines?: QueueActionLine[];
  action_line_count?: number;
  new_lines?: QueueNewLine[];
  new_line_count?: number;
  existing_items?: ExistingOrderItemRow[];
  attachments?: QueueAttachment[];
  extractedCarCandidates?: LineInboxCarCandidate[];
  reviewUrl?: string;
  review_url?: string;
  needs_human_review?: boolean;
};

type QueueGroup = {
  group_key: string;
  car_row_id?: string;
  plate_display?: string;
  car_title?: string;
  fallback_title?: string;
  fallbackTitle?: string;
  fallback_description?: string;
  fallbackDescription?: string;
  source_label?: string;
  source_type?: string;
  sale?: string;
  extractionStatus?: QueueMessage["extractionStatus"];
  matchStatus?: QueueMessage["matchStatus"];
  unmatchedReason?: QueueMessage["unmatchedReason"];
  total_action_lines?: number;
  total_new_lines?: number;
  total_manual_reviews?: number;
  existing_items?: ExistingOrderItemRow[];
  attachments?: QueueAttachment[];
  messages?: QueueMessage[];
  reviewUrl?: string;
  review_url?: string;
  extractedCarCandidates?: LineInboxCarCandidate[];
};

type QueueResponse = {
  ok?: boolean;
  filter_counts?: Partial<QueueCounts>;
  total_action_lines?: number;
  total_new_lines?: number;
  total_manual_reviews?: number;
  groups?: QueueGroup[];
  recent_attachments?: QueueAttachment[];
  error?: string;
};

const FILTERS: Array<{ value: QueueFilter; label: string; hint: string }> = [
  { value: "all", label: "พร้อมทำ", hint: "จับรถได้แล้ว มีรายการงาน" },
  { value: "today", label: "วันนี้", hint: "ข้อความหรือรูปที่เข้าวันนี้" },
  { value: "manual", label: "รอตรวจ", hint: "AI ยังไม่มั่นใจ" },
  { value: "waiting_for_car", label: "รอข้อมูลรถ", hint: "ยังไม่มีรถในระบบให้ผูก" },
];

const REFRESH_MS = 20_000;

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function countLines(group: QueueGroup): number {
  return Math.max(0, Number(group.total_action_lines ?? 0)) + Math.max(0, Number(group.total_new_lines ?? 0));
}

function displayTitle(group: QueueGroup): string {
  return clean(group.plate_display) || clean(group.car_title) || clean(group.fallbackTitle ?? group.fallback_title) || "ยังไม่รู้รถ";
}

function displayDescription(group: QueueGroup): string {
  return clean(group.car_title) || clean(group.fallbackDescription ?? group.fallback_description) || "รออ่านรายละเอียดจาก LINE";
}

function displayRequester(group: QueueGroup): string {
  return clean(group.source_label) || (clean(group.source_type) ? `LINE ${group.source_type}` : "LINE group");
}

function displayAssignee(group: QueueGroup): string {
  const fromGroup = clean(group.sale);
  if (fromGroup) return fromGroup;
  for (const message of group.messages ?? []) {
    const sale = clean(message.sale);
    if (sale) return sale;
  }
  return "ยังไม่ระบุ";
}

function groupBucket(group: QueueGroup): "ready" | "review" | "waiting" {
  if (clean(group.matchStatus) === "waiting_for_car_record" || clean(group.unmatchedReason) === "pending_car_record") {
    return "waiting";
  }
  if (Math.max(0, Number(group.total_manual_reviews ?? 0)) > 0 || clean(group.matchStatus) !== "matched") return "review";
  return "ready";
}

function bucketLabel(group: QueueGroup): string {
  const bucket = groupBucket(group);
  if (bucket === "ready") return "พร้อมรับงาน";
  if (bucket === "waiting") return "รอเพิ่มรถ";
  return "รอตรวจ";
}

function bucketClass(group: QueueGroup): string {
  const bucket = groupBucket(group);
  if (bucket === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (bucket === "waiting") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-rose-200 bg-rose-50 text-rose-900";
}

function formatTime(value: string | undefined): string {
  const date = new Date(clean(value));
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function firstReviewUrl(group: QueueGroup): string {
  const direct = clean(group.reviewUrl ?? group.review_url);
  if (direct) return direct;
  for (const message of group.messages ?? []) {
    const url = clean(message.reviewUrl ?? message.review_url);
    if (url) return url;
  }
  const rowId = clean(group.car_row_id);
  return rowId ? `/m/orders?car=${encodeURIComponent(rowId)}` : "/m/orders";
}

function acknowledgementText(group: QueueGroup): string {
  const title = displayTitle(group);
  const assignee = displayAssignee(group);
  if (assignee !== "ยังไม่ระบุ") return `รับทราบครับ บันทึกงาน ${title} ให้ ${assignee} ตรวจต่อแล้ว`;
  return `รับทราบครับ บันทึกงาน ${title} เข้าระบบแล้ว รอตรวจสอบผู้รับผิดชอบ`;
}

function lineDetail(line: QueueActionLine | QueueNewLine): string {
  if ("suggested_note" in line && line.suggested_note) return line.suggested_note;
  if ("reason" in line && line.reason) return line.reason;
  return clean(line.raw_text) || "ไม่มีรายละเอียดเพิ่ม";
}

function EmptyState({ loading }: { loading: boolean }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-5 text-center">
      <MessageCircle className="mb-3 size-8 text-slate-400" aria-hidden />
      <p className="text-sm font-semibold text-slate-900">{loading ? "กำลังโหลดงานจาก LINE" : "ยังไม่มีงานในมุมนี้"}</p>
      <p className="mt-1 max-w-sm text-xs text-slate-500">ถ้ามีข้อความใหม่จากกลุ่ม LINE หน้านี้จะดึงมาแสดงอัตโนมัติ</p>
    </div>
  );
}

export function LineJobsInbox() {
  const [filter, setFilter] = useState<QueueFilter>("today");
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [query, setQuery] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/line-inbox/pending-queue?mode=full&filter=${filter}`, { cache: "no-store" });
      const body = (await res.json()) as QueueResponse;
      if (!res.ok || body.error) throw new Error(body.error || `โหลด LINE queue ไม่สำเร็จ (${res.status})`);
      setData(body);
      setLastUpdated(new Date());
      const firstKey = body.groups?.[0]?.group_key ?? "";
      setSelectedKey((current) => (current && body.groups?.some((group) => group.group_key === current) ? current : firstKey));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadQueue();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadQueue]);

  const groups = useMemo(() => data?.groups ?? [], [data?.groups]);
  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((group) => {
      const haystack = [
        displayTitle(group),
        displayDescription(group),
        displayRequester(group),
        displayAssignee(group),
        ...(group.messages ?? []).flatMap((message) => [
          message.raw_text,
          message.raw_text_preview,
          message.rawTextPreview,
          ...(message.action_lines ?? []).map((line) => line.raw_text),
          ...(message.new_lines ?? []).map((line) => line.raw_text),
        ]),
      ]
        .map(clean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [groups, query]);

  const selected = filteredGroups.find((group) => group.group_key === selectedKey) ?? filteredGroups[0] ?? null;
  const counts = data?.filter_counts ?? {};
  const totalJobs = (data?.total_action_lines ?? 0) + (data?.total_new_lines ?? 0);

  async function copyAck(group: QueueGroup) {
    await navigator.clipboard.writeText(acknowledgementText(group));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  async function closeSelectedGroup(group: QueueGroup) {
    const inboxIds = Array.from(new Set((group.messages ?? []).map((message) => clean(message.inbox_id)).filter(Boolean)));
    if (inboxIds.length === 0) {
      setActionError("ปิดคิวไม่ได้ เพราะรายการนี้ไม่มี inbox id");
      return;
    }

    setActionLoading(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const res = await fetch("/api/line-inbox/pending-save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          saves: inboxIds.slice(0, 50).map((inbox_message_id) => ({
            inbox_message_id,
            skip_all: true,
          })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || body.error) throw new Error(body.error || `ปิดคิวไม่สำเร็จ (${res.status})`);
      setActionNotice(`ปิดจากคิวแล้ว ${Math.min(inboxIds.length, 50)} ข้อความ`);
      await loadQueue();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <header className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-sm md:px-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-sky-700">
              <MessageCircle className="size-4" aria-hidden />
              LINE Job Inbox
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-normal text-slate-950">งานจาก LINE</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              รวมข้อความและรูปจากกลุ่ม LINE แล้วจับคู่รถ ผู้สั่งงาน ผู้รับผิดชอบ และรายการที่ต้องตรวจต่อในเว็บ
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void loadQueue()} disabled={loading}>
              <RefreshCcw className={cn("mr-2 size-4", loading ? "animate-spin" : "")} aria-hidden />
              โหลดใหม่
            </Button>
            <Link href="/m/orders" className={buttonVariants({ size: "sm" })}>
              เปิด Order Tracking
              <ExternalLink className="ml-2 size-4" aria-hidden />
            </Link>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-4">
          <div className="rounded-md bg-slate-100 px-3 py-2">
            <p className="text-xs text-slate-500">งานในมุมนี้</p>
            <p className="text-xl font-bold text-slate-950">{groups.length}</p>
          </div>
          <div className="rounded-md bg-emerald-50 px-3 py-2">
            <p className="text-xs text-emerald-700">รายการงาน</p>
            <p className="text-xl font-bold text-emerald-900">{totalJobs}</p>
          </div>
          <div className="rounded-md bg-rose-50 px-3 py-2">
            <p className="text-xs text-rose-700">รอตรวจ</p>
            <p className="text-xl font-bold text-rose-900">{data?.total_manual_reviews ?? 0}</p>
          </div>
          <div className="rounded-md bg-sky-50 px-3 py-2">
            <p className="text-xs text-sky-700">อัปเดตล่าสุด</p>
            <p className="text-sm font-semibold text-sky-950">{lastUpdated ? formatTime(lastUpdated.toISOString()) : "-"}</p>
          </div>
        </div>
      </header>

      <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="flex gap-2 overflow-x-auto">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={cn(
                "shrink-0 rounded-md border px-3 py-2 text-left transition",
                filter === item.value
                  ? "border-slate-950 bg-slate-950 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              )}
            >
              <span className="block text-sm font-semibold">
                {item.label} {counts[item.value] != null ? `(${counts[item.value]})` : ""}
              </span>
              <span className={cn("block text-[11px]", filter === item.value ? "text-slate-300" : "text-slate-500")}>{item.hint}</span>
            </button>
          ))}
        </div>
        <label className="flex h-10 min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 md:w-80">
          <Search className="size-4 shrink-0 text-slate-400" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ค้นหาทะเบียน รถ คน หรือข้อความ"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
      </section>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-900">{error}</div>
      ) : null}
      {actionNotice ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">{actionNotice}</div>
      ) : null}
      {actionError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-900">{actionError}</div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
        <section className="flex flex-col gap-2">
          {filteredGroups.length === 0 ? (
            <EmptyState loading={loading} />
          ) : (
            filteredGroups.map((group) => {
              const selectedNow = selected?.group_key === group.group_key;
              return (
                <button
                  key={group.group_key}
                  type="button"
                  onClick={() => setSelectedKey(group.group_key)}
                  className={cn(
                    "rounded-lg border bg-white p-3 text-left shadow-sm transition hover:border-sky-300",
                    selectedNow ? "border-sky-500 ring-2 ring-sky-100" : "border-slate-200"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-bold text-slate-950">{displayTitle(group)}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{displayDescription(group)}</p>
                    </div>
                    <span className={cn("shrink-0 rounded-full border px-2 py-1 text-[11px] font-semibold", bucketClass(group))}>
                      {bucketLabel(group)}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md bg-slate-50 px-2 py-1.5">
                      <p className="text-slate-500">ผู้สั่ง</p>
                      <p className="truncate font-semibold text-slate-900">{displayRequester(group)}</p>
                    </div>
                    <div className="rounded-md bg-slate-50 px-2 py-1.5">
                      <p className="text-slate-500">รับผิดชอบ</p>
                      <p className="truncate font-semibold text-slate-900">{displayAssignee(group)}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <ClipboardCheck className="size-3.5" aria-hidden />
                      {countLines(group)} งาน
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="size-3.5" aria-hidden />
                      {group.messages?.length ?? 0} ข้อความ
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <ImageIcon className="size-3.5" aria-hidden />
                      {group.attachments?.length ?? 0} รูป/ไฟล์
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </section>

        <section className="min-h-[560px] rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          {!selected ? (
            <EmptyState loading={loading} />
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold text-slate-950">{displayTitle(selected)}</h2>
                    <span className={cn("rounded-full border px-2 py-1 text-[11px] font-semibold", bucketClass(selected))}>
                      {bucketLabel(selected)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{displayDescription(selected)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void copyAck(selected)}>
                    <CheckCircle2 className="mr-2 size-4" aria-hidden />
                    {copied ? "คัดลอกแล้ว" : "คัดลอกคำตอบรับทราบ"}
                  </Button>
                  <Link href={firstReviewUrl(selected)} className={buttonVariants({ size: "sm" })}>
                    ดู/แก้ไข
                    <ExternalLink className="ml-2 size-4" aria-hidden />
                  </Link>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void closeSelectedGroup(selected)}
                    disabled={actionLoading || (selected.messages?.length ?? 0) === 0}
                  >
                    <ClipboardCheck className="mr-2 size-4" aria-hidden />
                    {actionLoading ? "กำลังปิดคิว..." : "ตรวจแล้ว / ปิดจากคิว"}
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-md bg-slate-50 px-3 py-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                    <MessageCircle className="size-4" aria-hidden />
                    ผู้สั่ง
                  </div>
                  <p className="mt-1 text-sm font-bold text-slate-950">{displayRequester(selected)}</p>
                </div>
                <div className="rounded-md bg-slate-50 px-3 py-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                    <UserCheck className="size-4" aria-hidden />
                    รับผิดชอบ
                  </div>
                  <p className="mt-1 text-sm font-bold text-slate-950">{displayAssignee(selected)}</p>
                </div>
                <div className="rounded-md bg-slate-50 px-3 py-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                    <Car className="size-4" aria-hidden />
                    รถ
                  </div>
                  <p className="mt-1 text-sm font-bold text-slate-950">{clean(selected.car_row_id) || "ยังไม่ผูก row_id"}</p>
                </div>
              </div>

              <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-3">
                <p className="text-xs font-semibold text-sky-800">ข้อความตอบกลับที่ระบบควรส่งเมื่อเปิด LINE_REPLY ภายหลัง</p>
                <p className="mt-1 text-sm font-medium text-sky-950">{acknowledgementText(selected)}</p>
              </div>

              {selected.extractedCarCandidates?.length ? (
                <div>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
                    <AlertTriangle className="size-4 text-amber-600" aria-hidden />
                    รถที่ระบบเดาไว้
                  </h3>
                  <div className="grid gap-2 md:grid-cols-2">
                    {selected.extractedCarCandidates.slice(0, 6).map((candidate, index) => (
                      <div key={`${candidate.text}-${index}`} className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                        <p className="font-semibold">{candidate.text || "ไม่ระบุ"}</p>
                        <p className="mt-0.5 text-amber-800">{candidate.reason || candidate.kind || "รอเลือกโดยพนักงาน"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div>
                <h3 className="mb-2 text-sm font-bold text-slate-900">รายการงานที่อ่านได้</h3>
                <div className="space-y-2">
                  {(selected.messages ?? []).flatMap((message) => [
                    ...(message.action_lines ?? []).map((line, index) => ({ line, index, type: "action" as const, message })),
                    ...(message.new_lines ?? []).map((line, index) => ({ line, index, type: "new" as const, message })),
                  ]).length === 0 ? (
                    <div className="rounded-md border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500">
                      ยังแยกรายการงานไม่ได้ ต้องตรวจข้อความด้วยมือ
                    </div>
                  ) : (
                    (selected.messages ?? []).flatMap((message) => [
                      ...(message.action_lines ?? []).map((line, index) => ({ line, index, type: "action" as const, message })),
                      ...(message.new_lines ?? []).map((line, index) => ({ line, index, type: "new" as const, message })),
                    ]).map(({ line, index, type, message }) => (
                      <div key={`${message.inbox_id}-${type}-${index}`} className="rounded-md border border-slate-200 px-3 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-950">{line.suggested_item_name || line.raw_text || "งานจาก LINE"}</p>
                            <p className="mt-1 text-xs text-slate-500">{lineDetail(line)}</p>
                          </div>
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
                            {line.suggested_status || (type === "action" ? "ตรวจงาน" : "งานใหม่")}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {selected.attachments?.length ? (
                <div>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
                    <ImageIcon className="size-4" aria-hidden />
                    รูปและไฟล์จาก LINE
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {selected.attachments.slice(0, 9).map((attachment) => (
                      <a
                        key={attachment.inbox_id}
                        href={attachment.url || "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                      >
                        {attachment.url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- LINE/R2 attachment URLs are already proxied by the app and may not be next/image-compatible.
                          <img src={attachment.url} alt={attachment.file_name || "LINE attachment"} className="aspect-video w-full object-cover" />
                        ) : (
                          <div className="flex aspect-video items-center justify-center text-xs text-slate-500">ไม่มี preview</div>
                        )}
                        <div className="px-2 py-2 text-xs text-slate-600">
                          <p className="truncate font-medium text-slate-900">{attachment.file_name || "LINE image"}</p>
                          <p className="mt-0.5 flex items-center gap-1">
                            <Clock className="size-3" aria-hidden />
                            {formatTime(attachment.received_at)}
                          </p>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}

              <div>
                <h3 className="mb-2 text-sm font-bold text-slate-900">ข้อความต้นทาง</h3>
                <div className="space-y-2">
                  {(selected.messages ?? []).map((message) => (
                    <div key={message.inbox_id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span>{message.source_label || displayRequester(selected)}</span>
                        <span>{formatTime(message.received_at)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">
                        {message.raw_text || message.raw_text_preview || message.rawTextPreview || "ไม่มีข้อความ มีเฉพาะรูป/ไฟล์"}
                      </p>
                      {message.manual_review_reason ? (
                        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">{message.manual_review_reason}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
