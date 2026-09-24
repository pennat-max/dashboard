"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  ImageIcon,
  MessageCircle,
  RefreshCcw,
  Search,
  UserCheck,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BoardStatus = "new" | "review" | "working" | "done";
type QueueFilter = "today" | "all" | "manual" | "waiting_for_car";

type QueueLine = {
  raw_text?: string;
  suggested_item_name?: string;
  suggested_note?: string;
  suggested_status?: string;
  reason?: string;
};

type QueueAttachment = {
  inbox_id?: string;
  url?: string;
  file_name?: string | null;
  received_at?: string;
};

type QueueMessage = {
  inbox_id?: string;
  received_at?: string;
  source_label?: string;
  raw_text?: string;
  raw_text_preview?: string;
  rawTextPreview?: string;
  action_lines?: QueueLine[];
  new_lines?: QueueLine[];
  manual_review_reason?: string;
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
  sale?: string;
  matchStatus?: string;
  unmatchedReason?: string;
  total_action_lines?: number;
  total_new_lines?: number;
  total_manual_reviews?: number;
  attachments?: QueueAttachment[];
  messages?: QueueMessage[];
  reviewUrl?: string;
  review_url?: string;
};

type QueueResponse = {
  groups?: QueueGroup[];
  total_action_lines?: number;
  total_new_lines?: number;
  total_manual_reviews?: number;
  filter_counts?: Partial<Record<QueueFilter | "yesterday", number>>;
  error?: string;
};

const REFRESH_MS = 20_000;

const COLUMNS: Array<{ id: BoardStatus; title: string; hint: string }> = [
  { id: "new", title: "งานใหม่", hint: "จับคู่รถได้แล้ว พร้อมให้คนรับงาน" },
  { id: "review", title: "รอตรวจ", hint: "AI ไม่มั่นใจ หรือยังขาดข้อมูล" },
  { id: "working", title: "กำลังทำ", hint: "งานที่มีผู้รับผิดชอบแล้ว" },
  { id: "done", title: "เสร็จวันนี้", hint: "งานที่ปิดคิวแล้ว" },
];

const FILTERS: Array<{ id: QueueFilter; label: string }> = [
  { id: "today", label: "วันนี้" },
  { id: "all", label: "ทั้งหมด" },
  { id: "manual", label: "รอตรวจ" },
  { id: "waiting_for_car", label: "รอข้อมูลรถ" },
];

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function titleFor(group: QueueGroup): string {
  return (
    clean(group.plate_display) ||
    clean(group.car_title) ||
    clean(group.fallbackTitle ?? group.fallback_title) ||
    "ยังไม่รู้รถ"
  );
}

function descriptionFor(group: QueueGroup): string {
  return clean(group.car_title) || clean(group.fallbackDescription ?? group.fallback_description) || "ข้อความจาก LINE";
}

function requesterFor(group: QueueGroup): string {
  return clean(group.source_label) || clean(group.messages?.[0]?.source_label) || "LINE group";
}

function assigneeFor(group: QueueGroup): string {
  return clean(group.sale) || "ยังไม่ระบุ";
}

function linesFor(group: QueueGroup): QueueLine[] {
  return (group.messages ?? []).flatMap((message) => [...(message.action_lines ?? []), ...(message.new_lines ?? [])]);
}

function messageText(message: QueueMessage): string {
  return clean(message.raw_text) || clean(message.raw_text_preview) || clean(message.rawTextPreview) || "มีรูป/ไฟล์แนบจาก LINE";
}

function reviewUrlFor(group: QueueGroup): string {
  const direct = clean(group.reviewUrl ?? group.review_url);
  if (direct) return direct;
  const rowId = clean(group.car_row_id);
  return rowId ? `/m/orders?focusCarRowId=${encodeURIComponent(rowId)}` : "/m/orders";
}

function statusFor(group: QueueGroup): BoardStatus {
  const matchStatus = clean(group.matchStatus);
  const unmatched = clean(group.unmatchedReason);
  const manual = Number(group.total_manual_reviews ?? 0) > 0;
  const hasCar = Boolean(clean(group.car_row_id));
  const assignee = assigneeFor(group);
  if (!hasCar || matchStatus === "waiting_for_car_record" || unmatched) return "review";
  if (manual || matchStatus !== "matched") return "review";
  if (assignee !== "ยังไม่ระบุ") return "working";
  return "new";
}

function formatTime(value?: string): string {
  const date = new Date(clean(value));
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function ackText(group: QueueGroup): string {
  const title = titleFor(group);
  const assignee = assigneeFor(group);
  if (assignee !== "ยังไม่ระบุ") return `รับทราบครับ งานของ ${title} อยู่กับ ${assignee} แล้ว`;
  return `รับทราบครับ ระบบบันทึกงานของ ${title} แล้ว รอระบุผู้รับผิดชอบ`;
}

function columnTone(status: BoardStatus): string {
  if (status === "new") return "border-sky-200 bg-sky-50";
  if (status === "review") return "border-rose-200 bg-rose-50";
  if (status === "working") return "border-amber-200 bg-amber-50";
  return "border-emerald-200 bg-emerald-50";
}

function statusPill(status: BoardStatus): string {
  if (status === "new") return "bg-sky-100 text-sky-900";
  if (status === "review") return "bg-rose-100 text-rose-900";
  if (status === "working") return "bg-amber-100 text-amber-900";
  return "bg-emerald-100 text-emerald-900";
}

export function LineWorkBoard() {
  const [filter, setFilter] = useState<QueueFilter>("today");
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadQueue = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/line-inbox/pending-queue?mode=full&filter=${filter}`, { cache: "no-store" });
      const body = (await res.json()) as QueueResponse;
      if (!res.ok || body.error) throw new Error(body.error || `โหลดงานจาก LINE ไม่สำเร็จ (${res.status})`);
      setData(body);
      setLastUpdated(new Date());
      setSelectedKey((current) => (current && body.groups?.some((group) => group.group_key === current) ? current : body.groups?.[0]?.group_key ?? ""));
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
    const timer = window.setInterval(() => void loadQueue(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadQueue]);

  const groups = useMemo(() => data?.groups ?? [], [data?.groups]);
  const visibleGroups = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return groups;
    return groups.filter((group) =>
      [
        titleFor(group),
        descriptionFor(group),
        requesterFor(group),
        assigneeFor(group),
        ...linesFor(group).map((line) => `${line.suggested_item_name ?? ""} ${line.raw_text ?? ""}`),
        ...(group.messages ?? []).map(messageText),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [groups, query]);

  const groupsByStatus = useMemo(() => {
    const out: Record<BoardStatus, QueueGroup[]> = { new: [], review: [], working: [], done: [] };
    for (const group of visibleGroups) out[statusFor(group)].push(group);
    return out;
  }, [visibleGroups]);

  const selected = visibleGroups.find((group) => group.group_key === selectedKey) ?? visibleGroups[0] ?? null;
  const totalJobs = (data?.total_action_lines ?? 0) + (data?.total_new_lines ?? 0);

  async function copyAck(group: QueueGroup) {
    await navigator.clipboard.writeText(`${ackText(group)}\n${reviewUrlFor(group)}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-4 text-slate-950 sm:px-5">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase text-sky-700">
              <MessageCircle className="size-4" aria-hidden />
              LINE Job Inbox
            </div>
            <h1 className="mt-1 text-2xl font-bold">กระดานงานจาก LINE</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              ใช้หน้านี้แทนการไล่อ่านแชทกลุ่ม: ดูรถ, คนสั่ง, คนรับผิดชอบ, รูป, ข้อความต้นทาง และกดเข้าไปแก้ใน Order Tracking
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void loadQueue()} disabled={loading}>
              <RefreshCcw className={cn("mr-2 size-4", loading ? "animate-spin" : "")} aria-hidden />
              โหลดใหม่
            </Button>
            <Link href="/m/orders" className={buttonVariants({ size: "sm" })}>
              Order Tracking
              <ExternalLink className="ml-2 size-4" aria-hidden />
            </Link>
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-4">
          <div className="rounded-md bg-slate-100 px-3 py-2">
            <p className="text-xs text-slate-500">งานทั้งหมด</p>
            <p className="text-xl font-bold">{visibleGroups.length}</p>
          </div>
          <div className="rounded-md bg-sky-50 px-3 py-2">
            <p className="text-xs text-sky-700">รายการที่จับได้</p>
            <p className="text-xl font-bold text-sky-950">{totalJobs}</p>
          </div>
          <div className="rounded-md bg-rose-50 px-3 py-2">
            <p className="text-xs text-rose-700">รอตรวจ</p>
            <p className="text-xl font-bold text-rose-950">{data?.total_manual_reviews ?? 0}</p>
          </div>
          <div className="rounded-md bg-emerald-50 px-3 py-2">
            <p className="text-xs text-emerald-700">อัปเดตล่าสุด</p>
            <p className="text-sm font-bold text-emerald-950">{lastUpdated ? formatTime(lastUpdated.toISOString()) : "-"}</p>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-2 overflow-x-auto">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={cn(
                "shrink-0 rounded-md border px-3 py-2 text-sm font-bold",
                filter === item.id ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-700"
              )}
            >
              {item.label}
              {data?.filter_counts?.[item.id] != null ? ` ${data.filter_counts[item.id]}` : ""}
            </button>
          ))}
        </div>
        <label className="flex h-10 min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 lg:w-96">
          <Search className="size-4 shrink-0 text-slate-400" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ค้นหารถ คน หรือข้อความ"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
      </section>

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">{error}</div> : null}

      <section className="grid gap-3 xl:grid-cols-4">
        {COLUMNS.map((column) => (
          <div key={column.id} className={cn("rounded-lg border p-3", columnTone(column.id))}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="font-bold">{column.title}</h2>
                <p className="text-xs text-slate-600">{column.hint}</p>
              </div>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-bold">{groupsByStatus[column.id].length}</span>
            </div>
            <div className="space-y-2">
              {groupsByStatus[column.id].length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 bg-white/70 px-3 py-8 text-center text-sm text-slate-500">
                  ยังไม่มีงาน
                </div>
              ) : (
                groupsByStatus[column.id].map((group) => (
                  <button
                    key={group.group_key}
                    type="button"
                    onClick={() => setSelectedKey(group.group_key)}
                    className={cn(
                      "w-full rounded-md border bg-white p-3 text-left shadow-sm transition hover:border-sky-400",
                      selected?.group_key === group.group_key ? "border-sky-500 ring-2 ring-sky-100" : "border-slate-200"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-bold">{titleFor(group)}</p>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold", statusPill(statusFor(group)))}>
                        {linesFor(group).length}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{descriptionFor(group)}</p>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-slate-600">
                      <span className="truncate">สั่ง: {requesterFor(group)}</span>
                      <span className="truncate">รับ: {assigneeFor(group)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        {!selected ? (
          <div className="flex min-h-64 flex-col items-center justify-center text-center text-slate-500">
            <MessageCircle className="mb-3 size-8" aria-hidden />
            <p className="font-bold">{loading ? "กำลังโหลดงานจาก LINE" : "เลือกงานเพื่อดูรายละเอียด"}</p>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-4">
              <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold">{titleFor(selected)}</h2>
                    <span className={cn("rounded-full px-2 py-1 text-xs font-bold", statusPill(statusFor(selected)))}>
                      {COLUMNS.find((column) => column.id === statusFor(selected))?.title}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{descriptionFor(selected)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void copyAck(selected)}>
                    <CheckCircle2 className="mr-2 size-4" aria-hidden />
                    {copied ? "คัดลอกแล้ว" : "คัดลอกตอบรับ"}
                  </Button>
                  <Link href={reviewUrlFor(selected)} className={buttonVariants({ size: "sm" })}>
                    ดู/แก้ไขรถ
                    <ExternalLink className="ml-2 size-4" aria-hidden />
                  </Link>
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                <InfoBox icon={<MessageCircle className="size-4" aria-hidden />} label="คนสั่ง" value={requesterFor(selected)} />
                <InfoBox icon={<UserCheck className="size-4" aria-hidden />} label="ผู้รับผิดชอบ" value={assigneeFor(selected)} />
                <InfoBox icon={<ClipboardCheck className="size-4" aria-hidden />} label="จำนวนงาน" value={`${linesFor(selected).length} รายการ`} />
              </div>

              <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-3">
                <p className="text-xs font-bold text-sky-800">ข้อความตอบกลับที่ควรส่งใน LINE</p>
                <p className="mt-1 text-sm font-medium text-sky-950">{ackText(selected)}</p>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-bold">รายการงานที่ระบบอ่านได้</h3>
                <div className="space-y-2">
                  {linesFor(selected).length === 0 ? (
                    <div className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500">
                      ยังแยกรายการงานไม่ได้ ให้พนักงานอ่านข้อความต้นทางแล้วกดเข้าไปจัดในรถ
                    </div>
                  ) : (
                    linesFor(selected).map((line, index) => (
                      <div key={`${line.raw_text ?? ""}-${index}`} className="rounded-md border border-slate-200 px-3 py-3">
                        <p className="font-bold">{clean(line.suggested_item_name) || clean(line.raw_text) || `งาน ${index + 1}`}</p>
                        <p className="mt-1 text-sm text-slate-600">{clean(line.suggested_note) || clean(line.reason) || clean(line.raw_text) || "รอตรวจรายละเอียด"}</p>
                        {line.suggested_status ? (
                          <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">{line.suggested_status}</span>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-bold">ข้อความต้นทางจาก LINE</h3>
                <div className="space-y-2">
                  {(selected.messages ?? []).map((message, index) => (
                    <div key={message.inbox_id || index} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                      <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                        <span>{message.source_label || requesterFor(selected)}</span>
                        <span>{formatTime(message.received_at)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6">{messageText(message)}</p>
                      {message.manual_review_reason ? (
                        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs font-bold text-amber-900">{message.manual_review_reason}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <aside className="space-y-4">
              <div className="rounded-lg border border-slate-200 p-3">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
                  <ImageIcon className="size-4" aria-hidden />
                  รูป/ไฟล์จาก LINE
                </h3>
                {selected.attachments?.length ? (
                  <div className="grid grid-cols-2 gap-2">
                    {selected.attachments.slice(0, 8).map((attachment, index) => (
                      <a key={attachment.inbox_id || attachment.url || index} href={attachment.url || "#"} target="_blank" rel="noreferrer" className="overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                        {attachment.url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- LINE/R2 attachment URLs are stored by the app and may be dynamic.
                          <img src={attachment.url} alt={attachment.file_name || "LINE attachment"} className="aspect-square w-full object-cover" />
                        ) : (
                          <div className="flex aspect-square items-center justify-center text-xs text-slate-500">ไม่มีรูป</div>
                        )}
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">ไม่มีรูปแนบ</p>
                )}
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-950">
                  <AlertTriangle className="size-4" aria-hidden />
                  วิธีให้พนักงานใช้
                </h3>
                <ol className="space-y-2 text-sm text-amber-950">
                  <li>1. ดูช่อง “งานใหม่” ก่อน</li>
                  <li>2. ถ้าอยู่ “รอตรวจ” ให้เปิดรายละเอียดแล้วเลือก/แก้รถ</li>
                  <li>3. กด “ดู/แก้ไขรถ” เพื่ออัปเดตงานจริง</li>
                  <li>4. คัดลอกข้อความตอบรับไปส่ง LINE เมื่อจำเป็น</li>
                </ol>
              </div>
            </aside>
          </div>
        )}
      </section>
    </main>
  );
}

function InfoBox({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-3">
      <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
        {icon}
        {label}
      </div>
      <p className="mt-1 truncate text-sm font-bold">{value}</p>
    </div>
  );
}
