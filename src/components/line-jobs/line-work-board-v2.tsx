"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Car,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  MessageCircle,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  UserCheck,
  X,
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
  booked_shipping?: string;
  bookedShipping?: string;
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
type WorkStatus = "pending" | "checking" | "ordered" | "outside" | "to_send" | "working" | "done" | "blocked" | "cancelled";

type LineActor = {
  source: "line_liff" | "chatgpt_site";
  id: string;
  name: string;
  email?: string;
};

type LineLiffConfig = {
  liffId?: string;
};

type JobStatusRow = {
  item_key: string;
  status: WorkStatus;
  note?: string | null;
  updated_at: string;
  updated_by_name?: string | null;
  updated_by_email?: string | null;
  updated_by_source?: string | null;
};

type JobStatusEvent = {
  id: string;
  old_status?: string | null;
  new_status: WorkStatus;
  changed_at: string;
  changed_by_name?: string | null;
  changed_by_email?: string | null;
};

type GalleryImage = {
  id: string;
  url: string;
  name: string;
  local: boolean;
};

const WORK_STATUS_OPTIONS: { value: WorkStatus; label: string; tone: string }[] = [
  { value: "pending", label: "รอทำ", tone: "bg-slate-100 text-slate-700 border-slate-200" },
  { value: "checking", label: "เช็ค", tone: "bg-sky-50 text-sky-800 border-sky-200" },
  { value: "ordered", label: "สั่ง", tone: "bg-violet-50 text-violet-800 border-violet-200" },
  { value: "outside", label: "ช่างนอก", tone: "bg-amber-50 text-amber-900 border-amber-200" },
  { value: "to_send", label: "ต้องส่ง", tone: "bg-orange-50 text-orange-900 border-orange-200" },
  { value: "working", label: "กำลังทำ", tone: "bg-teal-50 text-teal-900 border-teal-200" },
  { value: "done", label: "เสร็จ", tone: "bg-emerald-50 text-emerald-900 border-emerald-200" },
  { value: "blocked", label: "ติดปัญหา", tone: "bg-rose-50 text-rose-900 border-rose-200" },
  { value: "cancelled", label: "ยกเลิก", tone: "bg-zinc-100 text-zinc-700 border-zinc-200" },
];

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

function bookedShippingFor(group: QueueGroup): string {
  return clean(group.bookedShipping ?? group.booked_shipping);
}

function lineKey(line: QueueLine): string {
  return [clean(line.suggested_item_name), clean(line.raw_text), clean(line.suggested_status)]
    .join("|")
    .toLowerCase();
}

function compactKeyPart(value: unknown): string {
  const text = clean(value).toLowerCase();
  if (!text) return "empty";
  return text.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "item";
}

function lineStatusKey(group: QueueGroup, line: QueueLine, index: number): string {
  return ["line-job", compactKeyPart(group.group_key), String(index), compactKeyPart(line.suggested_item_name || line.raw_text)].join(":");
}

function statusOptionFor(value: string | undefined): (typeof WORK_STATUS_OPTIONS)[number] {
  return WORK_STATUS_OPTIONS.find((option) => option.value === value) ?? WORK_STATUS_OPTIONS[0];
}

function statusLabel(value: string | undefined): string {
  return statusOptionFor(value).label;
}

function itemLabel(line: QueueLine, index: number): string {
  return clean(line.suggested_item_name) || clean(line.raw_text) || `งาน ${index + 1}`;
}

function galleryImagesFromAttachments(attachments: QueueAttachment[]): GalleryImage[] {
  return attachments.flatMap((attachment, index) => {
      const url = clean(attachment.url);
      if (!url) return [];
      const image: GalleryImage = {
        id: clean(attachment.inbox_id) || `${url}:${index}`,
        url,
        name: clean(attachment.file_name) || `LINE photo ${index + 1}`,
        local: false,
      };
      return [image];
    });
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
  const [shipFilter, setShipFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [jobStatuses, setJobStatuses] = useState<Record<string, JobStatusRow>>({});
  const [savingStatusKey, setSavingStatusKey] = useState("");
  const [actor, setActor] = useState<LineActor | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    async function loadLineActor() {
      try {
        const configRes = await fetch("/api/line/liff-config", { cache: "no-store" });
        const config = (await configRes.json()) as LineLiffConfig;
        const liffId = clean(config.liffId);
        if (!configRes.ok || !liffId) return;
        const mod = await import("@line/liff");
        const liff = mod.default;
        await liff.init({ liffId });
        if (!liff.isInClient() && !liff.isLoggedIn()) return;
        if (!liff.isLoggedIn()) return;
        const profile = await liff.getProfile();
        if (!cancelled) {
          setActor({
            source: "line_liff",
            id: profile.userId,
            name: profile.displayName || "LINE user",
          });
        }
      } catch {
        if (!cancelled) setActor(null);
      }
    }
    void loadLineActor();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => data?.groups ?? [], [data?.groups]);
  const statusItemKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const group of groups) {
      linesFor(group).forEach((line, index) => keys.add(lineStatusKey(group, line, index)));
    }
    return Array.from(keys);
  }, [groups]);

  useEffect(() => {
    if (!statusItemKeys.length) {
      setJobStatuses({});
      return;
    }
    let cancelled = false;
    async function loadStatuses() {
      try {
        const res = await fetch("/api/line-jobs/statuses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item_keys: statusItemKeys }),
        });
        const body = (await res.json()) as { statuses?: Record<string, JobStatusRow> };
        if (!cancelled && res.ok) setJobStatuses(body.statuses ?? {});
      } catch {
        if (!cancelled) setJobStatuses({});
      }
    }
    void loadStatuses();
    return () => {
      cancelled = true;
    };
  }, [statusItemKeys]);
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

  const shipOptions = useMemo(() => buildOptionCounts(searchedGroups.map(bookedShippingFor)), [searchedGroups]);
  const assigneeOptions = useMemo(() => buildOptionCounts(searchedGroups.map(assigneeFor)), [searchedGroups]);
  const visibleGroups = useMemo(
    () =>
      searchedGroups.filter((group) => {
        if (!groupMatchesTab(group, tab)) return false;
        if (shipFilter !== "all" && optionKey(bookedShippingFor(group)) !== shipFilter) return false;
        if (assigneeFilter !== "all" && optionKey(assigneeFor(group)) !== assigneeFilter) return false;
        return true;
      }),
    [assigneeFilter, searchedGroups, shipFilter, tab]
  );
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

  function selectGroup(groupKey: string) {
    setSelectedKey(groupKey);
    window.setTimeout(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
  }

  async function updateLineStatus(group: QueueGroup, line: QueueLine, index: number, status: WorkStatus) {
    const itemKey = lineStatusKey(group, line, index);
    const current = jobStatuses[itemKey];
    if (current?.status === status) return;
    setSavingStatusKey(itemKey);
    const optimistic: JobStatusRow = {
      item_key: itemKey,
      status,
      updated_at: new Date().toISOString(),
      updated_by_name: actor?.name ?? current?.updated_by_name ?? null,
      updated_by_email: actor?.email ?? current?.updated_by_email ?? null,
      updated_by_source: actor?.source ?? "chatgpt_site",
    };
    setJobStatuses((prev) => ({ ...prev, [itemKey]: optimistic }));
    try {
      const res = await fetch("/api/line-jobs/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_key: itemKey,
          group_key: group.group_key,
          car_row_id: clean(group.car_row_id),
          item_index: index,
          item_label: itemLabel(line, index),
          status,
          actor,
        }),
      });
      const body = (await res.json()) as { status?: JobStatusRow; error?: string };
      if (!res.ok || body.error || !body.status) throw new Error(body.error || "Cannot update status");
      setJobStatuses((prev) => ({ ...prev, [itemKey]: body.status as JobStatusRow }));
    } catch (e) {
      setJobStatuses((prev) => {
        const next = { ...prev };
        if (current) next[itemKey] = current;
        else delete next[itemKey];
        return next;
      });
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingStatusKey("");
    }
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

          <OptionFilterRow
            title="รอบเรือ"
            allLabel="ทุกรอบ"
            value={shipFilter}
            onChange={setShipFilter}
            options={shipOptions}
            emptyLabel="ยังไม่ระบุรอบ"
          />

          <OptionFilterRow
            title="ผู้รับผิดชอบ"
            allLabel="ทุกคน"
            value={assigneeFilter}
            onChange={setAssigneeFilter}
            options={assigneeOptions}
            emptyLabel="ยังไม่ระบุ"
          />

          {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-900">{error}</div> : null}

          <div className="flex flex-col gap-2">
            {visibleGroups.length === 0 ? (
              <EmptyCard loading={loading} />
            ) : (
              visibleGroups.map((group) => (
                <JobCard key={group.group_key} group={group} selected={selected?.group_key === group.group_key} onSelect={() => selectGroup(group.group_key)} />
              ))
            )}
          </div>
        </section>

        <section ref={detailRef} className="scroll-mt-3 min-h-[520px] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:p-5">
          {selected ? (
            <JobDetail
              group={selected}
              copied={copied}
              onCopy={() => void copyAck(selected)}
              lastUpdated={lastUpdated}
              statuses={jobStatuses}
              savingStatusKey={savingStatusKey}
              onStatusChange={updateLineStatus}
            />
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

type OptionCount = {
  key: string;
  label: string;
  count: number;
};

function optionKey(value: string): string {
  const cleanValue = clean(value);
  return cleanValue ? cleanValue.toLowerCase() : "__empty__";
}

function buildOptionCounts(values: string[]): OptionCount[] {
  const map = new Map<string, OptionCount>();
  for (const value of values) {
    const label = clean(value);
    const key = optionKey(label);
    const current = map.get(key);
    if (current) current.count += 1;
    else map.set(key, { key, label, count: 1 });
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.key === "__empty__") return 1;
    if (b.key === "__empty__") return -1;
    return b.count - a.count || a.label.localeCompare(b.label, "th", { numeric: true, sensitivity: "base" });
  });
}

function OptionFilterRow({
  title,
  allLabel,
  value,
  onChange,
  options,
  emptyLabel,
}: {
  title: string;
  allLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: OptionCount[];
  emptyLabel: string;
}) {
  if (options.length === 0) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="mb-2 text-xs font-black text-slate-500">{title}</p>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => onChange("all")}
          className={cn(
            "shrink-0 rounded-full border px-3 py-2 text-xs font-black",
            value === "all" ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-slate-50 text-slate-700"
          )}
        >
          {allLabel}
        </button>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-2 text-xs font-black",
              value === option.key ? "border-teal-700 bg-teal-700 text-white" : "border-slate-200 bg-slate-50 text-slate-700"
            )}
          >
            {option.label || emptyLabel} {option.count}
          </button>
        ))}
      </div>
    </div>
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

      <div className="mt-3 grid grid-cols-1 gap-2 text-xs">
        <SmallInfo label="รับผิดชอบ" value={assigneeFor(group)} />
      </div>

      {bookedShippingFor(group) ? (
        <div className="mt-2 rounded-xl bg-sky-50 px-3 py-2 text-xs font-black text-sky-900">
          รอบเรือ · {bookedShippingFor(group)}
        </div>
      ) : null}

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
  statuses,
  savingStatusKey,
  onStatusChange,
}: {
  group: QueueGroup;
  copied: boolean;
  onCopy: () => void;
  lastUpdated: Date | null;
  statuses: Record<string, JobStatusRow>;
  savingStatusKey: string;
  onStatusChange: (group: QueueGroup, line: QueueLine, index: number, status: WorkStatus) => void;
}) {
  const state = jobStateFor(group);
  const lines = linesFor(group);
  const messages = group.messages ?? [];
  const attachments = useMemo(() => group.attachments ?? [], [group.attachments]);
  const attachmentImages = useMemo(() => galleryImagesFromAttachments(attachments), [attachments]);
  const [hiddenImageIds, setHiddenImageIds] = useState<Set<string>>(() => new Set());
  const [addedImages, setAddedImages] = useState<GalleryImage[]>([]);
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const visibleImages = useMemo(
    () => [...attachmentImages.filter((image) => !hiddenImageIds.has(image.id)), ...addedImages],
    [addedImages, attachmentImages, hiddenImageIds]
  );

  useEffect(() => {
    setHiddenImageIds(new Set());
    setActiveImageIndex(null);
  }, [group.group_key]);

  useEffect(() => {
    return () => {
      for (const image of addedImages) {
        if (image.local) URL.revokeObjectURL(image.url);
      }
    };
  }, [addedImages]);

  function addGalleryFiles(files: FileList | null) {
    const nextFiles = Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
    if (!nextFiles.length) return;
    setAddedImages((current) => [
      ...current,
      ...nextFiles.map((file) => ({
        id: `local:${crypto.randomUUID()}`,
        url: URL.createObjectURL(file),
        name: file.name,
        local: true,
      })),
    ]);
  }

  function removeGalleryImage(index: number) {
    const image = visibleImages[index];
    if (!image) return;
    if (image.local) {
      URL.revokeObjectURL(image.url);
      setAddedImages((current) => current.filter((item) => item.id !== image.id));
    } else {
      setHiddenImageIds((current) => new Set([...current, image.id]));
    }
    setActiveImageIndex((current) => {
      const nextLength = Math.max(0, visibleImages.length - 1);
      if (!nextLength || current == null) return null;
      return Math.min(current, nextLength - 1);
    });
  }

  function moveActiveImage(delta: number) {
    setActiveImageIndex((current) => {
      if (current == null || visibleImages.length === 0) return null;
      return (current + delta + visibleImages.length) % visibleImages.length;
    });
  }

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

        <div className="mt-4 grid grid-cols-2 gap-2">
          <InfoChip icon={<UserCheck className="size-4" aria-hidden />} label="ผู้รับผิดชอบ" value={assigneeFor(group)} />
          <InfoChip icon={<Car className="size-4" aria-hidden />} label="รถ" value={clean(group.car_row_id) ? "ผูกแล้ว" : "รอตรวจ"} />
        </div>
        {bookedShippingFor(group) ? (
          <div className="mt-2 rounded-2xl bg-sky-50 px-3 py-3 text-sm font-black text-sky-900">
            รอบเรือ · {bookedShippingFor(group)}
          </div>
        ) : null}
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
                  <LineStatusControls
                    group={group}
                    line={line}
                    index={index}
                    status={statuses[lineStatusKey(group, line, index)]}
                    saving={savingStatusKey === lineStatusKey(group, line, index)}
                    onStatusChange={onStatusChange}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <LineImageGallery
        images={visibleImages}
        activeImageIndex={activeImageIndex}
        onAddFiles={addGalleryFiles}
        onOpenImage={setActiveImageIndex}
        onCloseImage={() => setActiveImageIndex(null)}
        onMoveImage={moveActiveImage}
        onRemoveImage={removeGalleryImage}
      />

      {false && attachments.length ? (
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

function LineImageGallery({
  images,
  activeImageIndex,
  onAddFiles,
  onOpenImage,
  onCloseImage,
  onMoveImage,
  onRemoveImage,
}: {
  images: GalleryImage[];
  activeImageIndex: number | null;
  onAddFiles: (files: FileList | null) => void;
  onOpenImage: (index: number) => void;
  onCloseImage: () => void;
  onMoveImage: (delta: number) => void;
  onRemoveImage: (index: number) => void;
}) {
  const touchStartX = useRef<number | null>(null);
  if (!images.length) return null;
  const activeImage = activeImageIndex == null ? null : images[activeImageIndex] ?? null;

  function handleTouchStart(event: React.TouchEvent) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: React.TouchEvent) {
    const startX = touchStartX.current;
    touchStartX.current = null;
    if (startX == null) return;
    const endX = event.changedTouches[0]?.clientX ?? startX;
    const delta = endX - startX;
    if (Math.abs(delta) < 45) return;
    onMoveImage(delta > 0 ? -1 : 1);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-black">
          <Camera className="size-5 text-teal-700" aria-hidden />
          รูปจาก LINE
        </h3>
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-black text-slate-700">
          <Plus className="size-4" aria-hidden />
          เพิ่ม
          <input type="file" accept="image/*" multiple className="sr-only" onChange={(event) => onAddFiles(event.target.files)} />
        </label>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {images.map((image, index) => (
          <div key={image.id} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
            <button type="button" className="block w-full" onClick={() => onOpenImage(index)}>
              {/* eslint-disable-next-line @next/next/no-img-element -- LINE/R2 images are dynamic user assets already served by the app. */}
              <img src={image.url} alt={image.name} className="aspect-square w-full object-cover" />
            </button>
            <button
              type="button"
              onClick={() => onRemoveImage(index)}
              className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-black/65 text-white shadow-sm"
              aria-label="Remove image"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>

      {activeImage ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
          <div className="flex min-h-14 items-center justify-between gap-2 px-3">
            <button type="button" className="grid size-10 place-items-center rounded-full bg-white/10" onClick={onCloseImage} aria-label="Close image">
              <X className="size-5" aria-hidden />
            </button>
            <div className="min-w-0 text-center">
              <p className="truncate text-sm font-black">{activeImage.name}</p>
              <p className="text-xs text-white/60">{(activeImageIndex ?? 0) + 1} / {images.length}</p>
            </div>
            <button type="button" className="grid size-10 place-items-center rounded-full bg-white/10" onClick={() => onRemoveImage(activeImageIndex ?? 0)} aria-label="Remove image">
              <Trash2 className="size-5" aria-hidden />
            </button>
          </div>
          <div className="relative grid min-h-0 flex-1 touch-pan-y place-items-center overflow-hidden" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
            <button type="button" className="absolute left-2 z-10 grid size-11 place-items-center rounded-full bg-black/45" onClick={() => onMoveImage(-1)} aria-label="Previous image">
              <ChevronLeft className="size-6" aria-hidden />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element -- Full-screen preview of selected LINE/R2 image. */}
            <img src={activeImage.url} alt={activeImage.name} className="max-h-full max-w-full object-contain" />
            <button type="button" className="absolute right-2 z-10 grid size-11 place-items-center rounded-full bg-black/45" onClick={() => onMoveImage(1)} aria-label="Next image">
              <ChevronRight className="size-6" aria-hidden />
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {images.map((image, index) => (
              <button
                key={image.id}
                type="button"
                onClick={() => onOpenImage(index)}
                className={cn("shrink-0 overflow-hidden rounded-xl border", index === activeImageIndex ? "border-white" : "border-white/20")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- Full-screen thumbnail strip. */}
                <img src={image.url} alt={image.name} className="size-16 object-cover" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function LineStatusControls({
  group,
  line,
  index,
  status,
  saving,
  onStatusChange,
}: {
  group: QueueGroup;
  line: QueueLine;
  index: number;
  status?: JobStatusRow;
  saving: boolean;
  onStatusChange: (group: QueueGroup, line: QueueLine, index: number, status: WorkStatus) => void;
}) {
  const currentStatus = status?.status ?? "pending";
  const updatedBy = clean(status?.updated_by_name) || clean(status?.updated_by_email);
  const currentTone = statusOptionFor(currentStatus).tone;
  const [chooserOpen, setChooserOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyEvents, setHistoryEvents] = useState<JobStatusEvent[]>([]);
  const itemKey = lineStatusKey(group, line, index);
  const updatedLine = status?.updated_at && updatedBy ? `${updatedBy} · ${formatTime(status.updated_at)}` : "";

  function chooseStatus(nextStatus: WorkStatus) {
    setChooserOpen(false);
    onStatusChange(group, line, index, nextStatus);
  }

  async function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const res = await fetch("/api/line-jobs/status-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_key: itemKey }),
      });
      const body = (await res.json()) as { events?: JobStatusEvent[]; error?: string };
      if (!res.ok || body.error) throw new Error(body.error || "Cannot load history");
      setHistoryEvents(body.events ?? []);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e));
      setHistoryEvents([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <>
      <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => setChooserOpen(true)}
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 text-left"
        >
          <span className={cn("rounded-full border px-2 py-1 text-[11px] font-black", currentTone)}>
            {saving ? "กำลังบันทึก" : statusLabel(currentStatus)}
          </span>
          <span className="min-w-0 flex-1 truncate text-right text-[11px] font-bold text-slate-400">
            {updatedLine || "แตะเพื่อเปลี่ยน"}
          </span>
          <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden />
        </button>
        {status?.updated_at ? (
          <button type="button" className="mt-2 px-1 text-[11px] font-black text-teal-700 underline underline-offset-2" onClick={() => void openHistory()}>
            ดูประวัติ
          </button>
        ) : null}
      </div>

      {chooserOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-3 sm:items-center sm:justify-center">
          <div className="w-full rounded-3xl bg-white p-4 shadow-2xl sm:max-w-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black text-slate-400">เลือกสถานะ</p>
                <p className="line-clamp-1 text-base font-black">{itemLabel(line, index)}</p>
              </div>
              <button type="button" className="grid size-10 place-items-center rounded-full bg-slate-100" onClick={() => setChooserOpen(false)} aria-label="Close status chooser">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {WORK_STATUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={saving}
                  onClick={() => chooseStatus(option.value)}
                  className={cn(
                    "min-h-12 rounded-2xl border px-3 text-sm font-black transition",
                    currentStatus === option.value ? option.tone : "border-slate-200 bg-slate-50 text-slate-700",
                    saving && "opacity-60"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {historyOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-3 sm:items-center sm:justify-center">
          <div className="max-h-[82dvh] w-full overflow-hidden rounded-3xl bg-white shadow-2xl sm:max-w-md">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4">
              <div>
                <p className="text-xs font-black text-slate-400">ประวัติสถานะ</p>
                <p className="line-clamp-1 text-base font-black">{itemLabel(line, index)}</p>
              </div>
              <button type="button" className="grid size-10 place-items-center rounded-full bg-slate-100" onClick={() => setHistoryOpen(false)} aria-label="Close status history">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <div className="max-h-[62dvh] overflow-y-auto p-4">
              {historyLoading ? <p className="text-sm font-bold text-slate-500">กำลังโหลดประวัติ...</p> : null}
              {historyError ? <p className="rounded-2xl bg-rose-50 p-3 text-sm font-bold text-rose-900">{historyError}</p> : null}
              {!historyLoading && !historyError && historyEvents.length === 0 ? (
                <p className="rounded-2xl bg-slate-50 p-3 text-sm font-bold text-slate-500">ยังไม่มีประวัติ</p>
              ) : null}
              <div className="flex flex-col gap-2">
                {historyEvents.map((event) => {
                  const by = clean(event.changed_by_name) || clean(event.changed_by_email) || "-";
                  return (
                    <div key={event.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn("rounded-full border px-2 py-1 text-[11px] font-black", statusOptionFor(event.new_status).tone)}>
                          {statusLabel(event.new_status)}
                        </span>
                        <span className="text-[11px] font-bold text-slate-400">{formatTime(event.changed_at)}</span>
                      </div>
                      <p className="mt-2 text-sm font-black text-slate-800">{by}</p>
                      {event.old_status ? <p className="mt-1 text-xs font-bold text-slate-500">จาก {statusLabel(event.old_status)} เป็น {statusLabel(event.new_status)}</p> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
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
