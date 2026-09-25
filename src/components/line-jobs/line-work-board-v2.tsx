"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Car,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  MessageCircle,
  RefreshCcw,
  Search,
  UserCheck,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type QueueFilter = "all" | "today" | "manual" | "waiting_for_car";
type ViewTab = "mine" | "new" | "review";

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
  unmatched_reason?: string;
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

type JobState = "ready" | "review" | "waiting_car" | "working";

const REFRESH_MS = 20_000;

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function titleFor(group: QueueGroup): string {
  return (
    clean(group.plate_display) ||
    firstCarTitlePart(group) ||
    clean(group.fallbackTitle ?? group.fallback_title) ||
    "ยังไม่รู้รถ"
  );
}

function stripRepeatedPrefix(text: string, prefix: string): string {
  let safeText = clean(text);
  const safePrefix = clean(prefix);
  if (!safeText || !safePrefix) return safeText;
  const compactPrefix = safePrefix.replace(/\s+/g, "").toLowerCase();
  for (let i = 0; i < 3; i += 1) {
    const compactText = safeText.replace(/\s+/g, "").toLowerCase();
    if (!compactText.startsWith(compactPrefix)) break;
    const next = safeText.slice(safePrefix.length).replace(/^[\s:|/-]+/, "").trim();
    if (!next || next === safeText) break;
    safeText = next;
  }
  return safeText;
}

function firstCarTitlePart(group: QueueGroup): string {
  const carTitle = clean(group.car_title);
  const plate = clean(group.plate_display);
  if (!carTitle) return "";
  if (!plate) return carTitle;
  return stripRepeatedPrefix(carTitle, plate) || carTitle;
}

function descriptionFor(group: QueueGroup): string {
  const title = titleFor(group);
  const carTitle = firstCarTitlePart(group);
  const fallback = clean(group.fallbackDescription ?? group.fallback_description);
  const description = carTitle || fallback || "ข้อความจาก LINE";
  return stripRepeatedPrefix(description, title) || description;
}

function requesterFor(group: QueueGroup): string {
  return clean(group.source_label) || clean(group.messages?.[0]?.source_label) || "LINE group";
}

function assigneeFor(group: QueueGroup): string {
  return clean(group.sale) || "ยังไม่ระบุ";
}

function lineKey(line: QueueLine): string {
  return [clean(line.suggested_item_name), clean(line.raw_text), clean(line.suggested_status)]
    .join("|")
    .toLowerCase();
}

function linesFor(group: QueueGroup): QueueLine[] {
  const seen = new Set<string>();
  const out: QueueLine[] = [];
  for (const message of group.messages ?? []) {
    const source = message.action_lines?.length ? message.action_lines : message.new_lines ?? [];
    for (const line of source) {
      const key = lineKey(line);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(line);
    }
  }
  return out;
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

function jobStateFor(group: QueueGroup): JobState {
  const matchStatus = clean(group.matchStatus);
  const unmatched = clean(group.unmatchedReason ?? group.unmatched_reason);
  const hasCar = Boolean(clean(group.car_row_id));
  const manual = Number(group.total_manual_reviews ?? 0) > 0;
  const assignee = assigneeFor(group);

  if (matchStatus === "waiting_for_car_record" || unmatched === "pending_car_record") return "waiting_car";
  if (!hasCar || manual || matchStatus !== "matched") return "review";
  if (assignee !== "ยังไม่ระบุ") return "working";
  return "ready";
}

function stateLabel(state: JobState): string {
  if (state === "ready") return "รอรับงาน";
  if (state === "review") return "รอตรวจ";
  if (state === "waiting_car") return "รอข้อมูลรถ";
  return "กำลังทำ";
}

function stateTone(state: JobState): string {
  if (state === "ready") return "bg-orange-50 text-orange-900 border-orange-200";
  if (state === "review") return "bg-rose-100 text-rose-900 border-rose-200";
  if (state === "waiting_car") return "bg-amber-100 text-amber-900 border-amber-200";
  return "bg-emerald-50 text-emerald-900 border-emerald-200";
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
  if (assignee !== "ยังไม่ระบุ") return `รับทราบงานของ ${title} อยู่กับ ${assignee} แล้ว`;
  return `รับทราบงานของ ${title} แล้ว รอตรวจผู้รับผิดชอบ`;
}

function groupKeyForJob(groups: QueueGroup[], job: string): string {
  const target = clean(job);
  if (!target) return "";
  return (
    groups.find((group) => {
      if (group.group_key === target) return true;
      return (group.messages ?? []).some((message) => clean(message.inbox_id) === target);
    })?.group_key ?? ""
  );
}

function groupMatchesTab(group: QueueGroup, tab: ViewTab): boolean {
  const state = jobStateFor(group);
  if (tab === "review") return state === "review" || state === "waiting_car";
  if (tab === "new") return state === "ready";
  return state === "working" || state === "ready";
}

export function LineWorkBoardV2() {
  const searchParams = useSearchParams();
  const targetJob = clean(searchParams?.get("job"));
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [tab, setTab] = useState<ViewTab>("mine");
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
      const groups = body.groups ?? [];
      setData(body);
      setLastUpdated(new Date());
      const targetKey = groupKeyForJob(groups, targetJob);
      setSelectedKey((current) =>
        targetKey || (current && groups.some((group) => group.group_key === current) ? current : groups[0]?.group_key ?? "")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filter, targetJob]);

  useEffect(() => {
    setLoading(true);
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    const timer = window.setInterval(() => void loadQueue(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadQueue]);

  const groups = useMemo(() => data?.groups ?? [], [data?.groups]);
  const searchedGroups = useMemo(() => {
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

  const visibleGroups = useMemo(() => searchedGroups.filter((group) => groupMatchesTab(group, tab)), [searchedGroups, tab]);
  const selected = searchedGroups.find((group) => group.group_key === selectedKey) ?? visibleGroups[0] ?? searchedGroups[0] ?? null;
  const allLines = (data?.total_action_lines ?? 0) + (data?.total_new_lines ?? 0);
  const reviewCount = searchedGroups.filter((group) => groupMatchesTab(group, "review")).length;
  const mineCount = searchedGroups.filter((group) => groupMatchesTab(group, "mine")).length;
  const newCount = searchedGroups.filter((group) => groupMatchesTab(group, "new")).length;

  async function copyAck(group: QueueGroup) {
    await navigator.clipboard.writeText(`${ackText(group)}\n${reviewUrlFor(group)}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <main className="min-h-dvh bg-[#f4f7fb] text-slate-950">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-3 pb-24 pt-3 sm:px-5 sm:pt-5 lg:grid lg:grid-cols-[390px_minmax(0,1fr)] lg:items-start lg:gap-5 lg:pb-8">
        <section className="flex flex-col gap-3 lg:sticky lg:top-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-xl bg-teal-700 text-base font-black text-white">V</div>
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-teal-700">LINE Jobs</p>
                  <h1 className="text-2xl font-black tracking-normal">งานวันนี้</h1>
                </div>
              </div>
              <Button type="button" variant="outline" size="icon" className="size-10 rounded-xl" onClick={() => void loadQueue()} disabled={loading}>
                <RefreshCcw className={cn("size-4", loading ? "animate-spin" : "")} aria-hidden />
                <span className="sr-only">โหลดใหม่</span>
              </Button>
            </div>

            <p className="mt-3 text-sm leading-6 text-slate-600">ดูงานจากกลุ่ม LINE รับผิดชอบงาน และเปิดรายละเอียดรถจากมือถือได้เร็วขึ้น</p>

            <label className="mt-4 flex min-h-11 items-center gap-2 rounded-2xl bg-slate-100 px-3 text-slate-500">
              <Search className="size-4 shrink-0" aria-hidden />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ค้นหาทะเบียน / คน / ข้อความ"
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-500"
              />
            </label>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <Metric label="ของฉัน" value={mineCount} className="border-cyan-200 bg-cyan-50 text-cyan-900" />
            <Metric label="ใหม่" value={newCount} className="border-orange-200 bg-orange-50 text-orange-900" />
            <Metric label="รอตรวจ" value={reviewCount} className="border-rose-200 bg-rose-50 text-rose-900" />
            <Metric label="งานย่อย" value={allLines} className="border-slate-200 bg-white text-slate-800" />
          </div>

          <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-200/70 p-1">
            <TabButton active={tab === "mine"} label="ของฉัน" count={mineCount} onClick={() => setTab("mine")} />
            <TabButton active={tab === "new"} label="งานใหม่" count={newCount} onClick={() => setTab("new")} />
            <TabButton active={tab === "review"} label="รอตรวจ" count={reviewCount} onClick={() => setTab("review")} />
          </div>

          <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <FilterButton active={filter === "all"} label="ทั้งหมด" count={data?.filter_counts?.all} onClick={() => setFilter("all")} />
            <FilterButton active={filter === "today"} label="วันนี้" count={data?.filter_counts?.today} onClick={() => setFilter("today")} />
            <FilterButton active={filter === "manual"} label="AI ไม่มั่นใจ" count={data?.filter_counts?.manual} onClick={() => setFilter("manual")} />
            <FilterButton
              active={filter === "waiting_for_car"}
              label="รอรถ"
              count={data?.filter_counts?.waiting_for_car}
              onClick={() => setFilter("waiting_for_car")}
            />
          </div>

          {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-900">{error}</div> : null}

          <div className="flex flex-col gap-2">
            {visibleGroups.length === 0 ? (
              <EmptyCard loading={loading} />
            ) : (
              visibleGroups.map((group) => (
                <JobCard key={group.group_key} group={group} selected={selected?.group_key === group.group_key} onSelect={() => setSelectedKey(group.group_key)} />
              ))
            )}
          </div>
        </section>

        <section className="min-h-[520px] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:p-5">
          {selected ? (
            <JobDetail group={selected} copied={copied} onCopy={() => void copyAck(selected)} lastUpdated={lastUpdated} />
          ) : (
            <EmptyCard loading={loading} />
          )}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className={cn("min-h-20 rounded-2xl border p-3", className)}>
      <p className="text-[11px] font-black">{label}</p>
      <p className="mt-2 text-2xl font-black leading-none">{value}</p>
    </div>
  );
}

function TabButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("min-h-10 rounded-xl text-xs font-black transition", active ? "bg-slate-950 text-white shadow-sm" : "text-slate-600")}
    >
      {label} {count}
    </button>
  );
}

function FilterButton({ active, label, count, onClick }: { active: boolean; label: string; count?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-2 text-xs font-black transition",
        active ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-600"
      )}
    >
      {label}
      {count != null ? ` ${count}` : ""}
    </button>
  );
}

function JobCard({ group, selected, onSelect }: { group: QueueGroup; selected: boolean; onSelect: () => void }) {
  const state = jobStateFor(group);
  const lineCount = linesFor(group).length;
  const latest = group.messages?.[0]?.received_at ?? group.attachments?.[0]?.received_at;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "rounded-2xl border bg-white p-3 text-left shadow-sm transition",
        selected ? "border-slate-950 ring-2 ring-slate-100" : "border-slate-200 hover:border-slate-300",
        state === "ready" && "shadow-orange-100/70",
        state === "working" && "shadow-teal-100/70",
        (state === "review" || state === "waiting_car") && "shadow-rose-100/70"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-black tracking-normal">{titleFor(group)}</p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{descriptionFor(group)}</p>
        </div>
        <span className={cn("shrink-0 rounded-full border px-2 py-1 text-[11px] font-black", stateTone(state))}>{stateLabel(state)}</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <SmallInfo label="สั่ง" value={requesterFor(group)} />
        <SmallInfo label="รับ" value={assigneeFor(group)} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold text-slate-500">
        <span className="inline-flex items-center gap-1">
          <ClipboardList className="size-3.5" aria-hidden />
          {lineCount} งานย่อย
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageCircle className="size-3.5" aria-hidden />
          {group.messages?.length ?? 0} ข้อความ
        </span>
        <span className="inline-flex items-center gap-1">
          <Camera className="size-3.5" aria-hidden />
          {group.attachments?.length ?? 0} รูป
        </span>
        <span>{formatTime(latest)}</span>
      </div>
      <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs font-black text-slate-900">
        <span>เปิดงาน</span>
        <ChevronRight className="size-4" aria-hidden />
      </div>
    </button>
  );
}

function SmallInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-2 py-2">
      <p className="text-[11px] font-black text-slate-400">{label}</p>
      <p className="truncate font-black text-slate-900">{value}</p>
    </div>
  );
}

function JobDetail({
  group,
  copied,
  onCopy,
  lastUpdated,
}: {
  group: QueueGroup;
  copied: boolean;
  onCopy: () => void;
  lastUpdated: Date | null;
}) {
  const state = jobStateFor(group);
  const lines = linesFor(group);
  const messages = group.messages ?? [];
  const attachments = group.attachments ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 lg:hidden">
        <button type="button" className="inline-flex items-center gap-2 text-sm font-black text-slate-500" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <ArrowLeft className="size-4" aria-hidden />
          กลับรายการ
        </button>
        <span className="text-xs font-bold text-slate-400">{lastUpdated ? `อัปเดต ${formatTime(lastUpdated.toISOString())}` : ""}</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-wide text-teal-700">รายละเอียดงาน</p>
            <h2 className="mt-1 text-2xl font-black tracking-normal">{titleFor(group)}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{descriptionFor(group)}</p>
          </div>
          <span className={cn("shrink-0 rounded-full border px-2 py-1 text-[11px] font-black", stateTone(state))}>{stateLabel(state)}</span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <InfoChip icon={<MessageCircle className="size-4" aria-hidden />} label="ผู้สั่ง" value={requesterFor(group)} />
          <InfoChip icon={<UserCheck className="size-4" aria-hidden />} label="ผู้รับผิดชอบ" value={assigneeFor(group)} />
          <InfoChip icon={<Car className="size-4" aria-hidden />} label="รถ" value={clean(group.car_row_id) ? "ผูกแล้ว" : "รอตรวจ"} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" className="min-h-12 rounded-2xl font-black" onClick={onCopy}>
          <CheckCircle2 className="mr-2 size-4" aria-hidden />
          {copied ? "คัดลอกแล้ว" : "คัดลอกตอบ"}
        </Button>
        <Link href={reviewUrlFor(group)} className={cn(buttonVariants(), "min-h-12 rounded-2xl font-black")}>
          เปิด Order
          <ExternalLink className="ml-2 size-4" aria-hidden />
        </Link>
      </div>

      <div className="rounded-2xl border border-cyan-100 bg-cyan-50 p-3">
        <p className="text-xs font-black text-cyan-800">ข้อความตอบกลับใน LINE</p>
        <p className="mt-1 text-sm font-bold leading-6 text-cyan-950">{ackText(group)}</p>
        <p className="mt-1 text-xs text-cyan-800">แนบปุ่ม: ดูรายละเอียดงาน</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-3">
        <h3 className="flex items-center gap-2 text-base font-black">
          <ClipboardList className="size-5 text-teal-700" aria-hidden />
          ต้องทำ
        </h3>
        <div className="mt-3 flex flex-col gap-2">
          {lines.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm font-bold text-slate-500">
              ยังแยกรายการงานไม่ได้ ต้องอ่านจากข้อความต้นทางและบันทึกเอง
            </div>
          ) : (
            lines.map((line, index) => (
              <div key={`${lineKey(line)}-${index}`} className="grid grid-cols-[28px_1fr] gap-3 rounded-2xl bg-slate-50 p-3">
                <div className="mt-0.5 grid size-6 place-items-center rounded-lg border-2 border-slate-300 text-xs font-black text-slate-400">{index + 1}</div>
                <div className="min-w-0">
                  <p className="font-black">{clean(line.suggested_item_name) || clean(line.raw_text) || `งาน ${index + 1}`}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{clean(line.suggested_note) || clean(line.reason) || clean(line.raw_text) || "รอตรวจรายละเอียด"}</p>
                  {line.suggested_status ? <span className="mt-2 inline-flex rounded-full bg-white px-2 py-1 text-[11px] font-black text-slate-600">{line.suggested_status}</span> : null}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {attachments.length ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-3">
          <h3 className="flex items-center gap-2 text-base font-black">
            <Camera className="size-5 text-teal-700" aria-hidden />
            รูปจาก LINE
          </h3>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {attachments.slice(0, 9).map((attachment, index) => (
              <a key={attachment.inbox_id || attachment.url || index} href={attachment.url || "#"} target="_blank" rel="noreferrer" className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                {attachment.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- LINE/R2 images are dynamic user assets already served by the app.
                  <img src={attachment.url} alt={attachment.file_name || "LINE attachment"} className="aspect-square w-full object-cover" />
                ) : (
                  <div className="grid aspect-square place-items-center text-xs text-slate-400">ไม่มีรูป</div>
                )}
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-3">
        <h3 className="flex items-center gap-2 text-base font-black">
          <MessageCircle className="size-5 text-teal-700" aria-hidden />
          ข้อความต้นทาง
        </h3>
        <div className="mt-3 flex flex-col gap-2">
          {messages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm font-bold text-slate-500">ยังไม่มีข้อความต้นทาง</div>
          ) : (
            messages.map((message, index) => (
              <div key={message.inbox_id || index} className="rounded-2xl bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs font-bold text-slate-400">
                  <span>{message.source_label || requesterFor(group)}</span>
                  <span>{formatTime(message.received_at)}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{messageText(message)}</p>
                {message.manual_review_reason ? (
                  <div className="mt-2 flex gap-2 rounded-xl bg-amber-50 p-2 text-xs font-bold text-amber-900">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden />
                    {message.manual_review_reason}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function InfoChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-white p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-black text-slate-400">
        {icon}
        {label}
      </div>
      <p className="mt-1 truncate text-sm font-black">{value}</p>
    </div>
  );
}

function EmptyCard({ loading }: { loading: boolean }) {
  return (
    <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
      <div>
        <MessageCircle className="mx-auto mb-3 size-9 text-slate-300" aria-hidden />
        <p className="font-black text-slate-900">{loading ? "กำลังโหลดงานจาก LINE" : "ยังไม่มีงานในมุมนี้"}</p>
        <p className="mt-1 text-sm leading-6 text-slate-500">ถ้ามีข้อความใหม่จากกลุ่ม LINE งานจะเข้ามาแสดงอัตโนมัติ</p>
      </div>
    </div>
  );
}
