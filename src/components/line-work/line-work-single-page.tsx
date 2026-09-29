"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Camera, Car, CheckCircle2, ClipboardList, ExternalLink, ImageIcon, Loader2, MessageCircle, RefreshCcw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type QueueLine = {
  item_index?: number;
  raw_text?: string;
  suggested_item_name?: string;
  suggested_status?: string;
  suggested_note?: string;
  duplicate_status?: string;
  default_action?: "create" | "merge" | "skip";
};

type QueueAttachment = {
  inbox_id?: string;
  line_message_id?: string;
  url?: string;
  file_name?: string | null;
  received_at?: string;
};

type ManualCarCandidate = {
  car_row_id?: string;
  label?: string;
  plate?: string;
  spec?: string;
  chassis_short?: string;
  sale?: string;
};

type QueueMessage = {
  inbox_id?: string;
  received_at?: string;
  source_label?: string;
  plate_display?: string;
  car_title?: string;
  raw_text?: string;
  raw_text_preview?: string;
  rawTextPreview?: string;
  car_row_id?: string;
  sale?: string;
  booked_shipping?: string;
  bookedShipping?: string;
  manualCarSearchQuery?: string;
  manual_car_search_query?: string;
  manualCarCandidates?: ManualCarCandidate[];
  manual_car_candidates?: ManualCarCandidate[];
  action_lines?: QueueLine[];
  new_lines?: QueueLine[];
  attachments?: QueueAttachment[];
};

type QueueGroup = {
  group_key?: string;
  car_row_id?: string;
  plate_display?: string;
  car_title?: string;
  fallback_title?: string;
  fallbackTitle?: string;
  fallback_description?: string;
  fallbackDescription?: string;
  source_label?: string;
  sale?: string;
  booked_shipping?: string;
  bookedShipping?: string;
  total_action_lines?: number;
  total_new_lines?: number;
  manualCarCandidates?: ManualCarCandidate[];
  manual_car_candidates?: ManualCarCandidate[];
  attachments?: QueueAttachment[];
  messages?: QueueMessage[];
};

type QueueResponse = {
  groups?: QueueGroup[];
  error?: string;
};

type SaveResponse = {
  ok?: boolean;
  error?: string;
  results?: Array<{
    saved_count?: number;
    skipped?: boolean;
    reply_text?: string;
    copy_ready_reply_text?: string;
    copyReadyReplyText?: string;
  }>;
};

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function compact(value: unknown): string {
  return clean(value).replace(/[^0-9a-zA-Z\u0E00-\u0E7F]+/g, "").toLowerCase();
}

function plateFrom(value: unknown): string {
  return clean(value).match(/[0-9A-Z\u0E00-\u0E7F]+[-\u2013\u2014]\d{2,8}[A-Z]?/i)?.[0] ?? "";
}

function compactCandidateLabel(candidate: ManualCarCandidate, group?: QueueGroup): string {
  const plate = plateFrom(candidate.plate) || plateFrom(candidate.label) || plateFrom(candidate.spec) || plateFrom(group?.plate_display) || plateFrom(group?.car_title);
  const raw = clean([candidate.label, candidate.spec].filter(Boolean).join(" "));
  const plateIndex = plate ? raw.toLowerCase().lastIndexOf(plate.toLowerCase()) : -1;
  const source = plateIndex >= 0 ? raw.slice(plateIndex + plate.length) : raw;
  const words = source
    .replace(plate ? new RegExp(plate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi") : /$a/, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  const kept: string[] = [];
  for (const word of words) {
    if (kept.some((seen) => seen.toLowerCase() === word.toLowerCase())) continue;
    kept.push(word);
    if (kept.length >= 8) break;
  }
  return clean([plate, kept.join(" ")].filter(Boolean).join(" ")) || clean(candidate.car_row_id) || "รถที่ระบบจับคู่";
}

function titleFor(group: QueueGroup): string {
  return clean(group.plate_display) || clean(group.car_title) || clean(group.fallbackTitle ?? group.fallback_title) || "งานจาก LINE";
}

function descriptionFor(group: QueueGroup): string {
  const title = titleFor(group);
  const carTitle = clean(group.car_title);
  const fallback = clean(group.fallbackDescription ?? group.fallback_description);
  return [carTitle, fallback].find((value) => value && value !== title) || carTitle || fallback || "รอตรวจรายละเอียดจากข้อความ LINE";
}

function bookedShippingFor(group: QueueGroup): string {
  return clean(group.bookedShipping ?? group.booked_shipping) || clean(group.messages?.find((m) => clean(m.bookedShipping ?? m.booked_shipping))?.bookedShipping);
}

function sourceFor(group: QueueGroup): string {
  return clean(group.source_label) || clean(group.messages?.find((m) => clean(m.source_label))?.source_label) || "LINE";
}

function saleFor(group: QueueGroup): string {
  return clean(group.sale) || clean(group.messages?.find((m) => clean(m.sale))?.sale) || "-";
}

function lineLabel(line: QueueLine, index: number): string {
  return clean(line.suggested_item_name) || clean(line.raw_text) || `งาน ${index + 1}`;
}

function linesForMessage(message: QueueMessage): QueueLine[] {
  const source = message.action_lines?.length ? message.action_lines : message.new_lines ?? [];
  return source.filter((line, index) => lineLabel(line, index));
}

function linesFor(group: QueueGroup): Array<QueueLine & { inbox_id: string }> {
  const seen = new Set<string>();
  const out: Array<QueueLine & { inbox_id: string }> = [];
  for (const message of group.messages ?? []) {
    const inboxId = clean(message.inbox_id);
    if (!inboxId) continue;
    for (const line of linesForMessage(message)) {
      const key = `${inboxId}:${line.item_index ?? ""}:${lineLabel(line, 0).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...line, inbox_id: inboxId });
    }
  }
  return out;
}

function attachmentsFor(group: QueueGroup): QueueAttachment[] {
  const seen = new Set<string>();
  const out: QueueAttachment[] = [];
  for (const attachment of [...(group.attachments ?? []), ...(group.messages ?? []).flatMap((m) => m.attachments ?? [])]) {
    const url = clean(attachment.url);
    const key = clean(attachment.line_message_id) || url;
    if (!url || seen.has(key)) continue;
    seen.add(key);
    out.push(attachment);
  }
  return out;
}

function rawMessagesFor(group: QueueGroup): string[] {
  const out: string[] = [];
  for (const message of group.messages ?? []) {
    const text = clean(message.raw_text) || clean(message.raw_text_preview) || clean(message.rawTextPreview);
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

function candidatesFor(group: QueueGroup): ManualCarCandidate[] {
  const seen = new Set<string>();
  return [
    ...(group.manualCarCandidates ?? group.manual_car_candidates ?? []),
    ...(group.messages ?? []).flatMap((message) => message.manualCarCandidates ?? message.manual_car_candidates ?? []),
  ].filter((candidate) => {
    const rowId = clean(candidate.car_row_id);
    if (!rowId || seen.has(rowId)) return false;
    seen.add(rowId);
    return true;
  });
}

function carRowIdFor(group: QueueGroup, selectedCarRowId: string): string {
  return clean(group.car_row_id) || clean(group.messages?.find((message) => clean(message.car_row_id))?.car_row_id) || clean(selectedCarRowId);
}

function findTargetGroup(groups: QueueGroup[], job: string, search: string, focusCarRowId: string): QueueGroup | null {
  const jobKey = clean(job);
  const searchKey = compact(search);
  const carKey = clean(focusCarRowId);
  return (
    groups.find((group) => {
      if (jobKey && clean(group.group_key) === jobKey) return true;
      if (carKey && clean(group.car_row_id) === carKey) return true;
      return (group.messages ?? []).some((message) => {
        if (jobKey && clean(message.inbox_id) === jobKey) return true;
        if (carKey && clean(message.car_row_id) === carKey) return true;
        if (!searchKey) return false;
        return [
          message.plate_display,
          message.manualCarSearchQuery,
          message.manual_car_search_query,
          message.car_title,
          message.raw_text,
          group.plate_display,
          group.car_title,
        ].some((value) => compact(value).includes(searchKey));
      });
    }) ?? null
  );
}

function orderHref(group: QueueGroup, selectedCarRowId: string): string {
  const params = new URLSearchParams();
  params.set("load", "full");
  params.set("scope", "active");
  const rowId = carRowIdFor(group, selectedCarRowId);
  const search = clean(group.plate_display) || titleFor(group);
  if (rowId) params.set("focusCarRowId", rowId);
  if (search) params.set("search", search);
  return `/liff/orders?${params.toString()}`;
}

function saveBlocks(group: QueueGroup, selectedCarRowId: string) {
  const carRowId = carRowIdFor(group, selectedCarRowId);
  return (group.messages ?? [])
    .map((message) => {
      const inboxId = clean(message.inbox_id);
      if (!inboxId) return null;
      const actions = linesForMessage(message)
        .filter((line) => {
          const action = clean(line.default_action);
          const duplicate = clean(line.duplicate_status);
          return action !== "skip" && (!duplicate || duplicate === "new");
        })
        .map((line, fallbackIndex) => ({
          item_index: Number.isInteger(line.item_index) ? Number(line.item_index) : fallbackIndex,
          action: "create" as const,
          item_name: lineLabel(line, fallbackIndex),
          item_status: clean(line.suggested_status) || undefined,
          note: clean(line.suggested_note) || undefined,
          assignee_staff: clean(group.sale) || undefined,
        }));
      if (actions.length === 0) return null;
      return {
        inbox_message_id: inboxId,
        selected_car_row_id: carRowId || undefined,
        actions,
      };
    })
    .filter(Boolean);
}

export function LineWorkSinglePage() {
  const params = useSearchParams();
  const job = clean(params?.get("job"));
  const search = clean(params?.get("search"));
  const focusCarRowId = clean(params?.get("focusCarRowId"));
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedCarRowId, setSelectedCarRowId] = useState(focusCarRowId);

  const loadQueue = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/line-inbox/pending-queue?mode=full&filter=all", { cache: "no-store" });
      const body = (await res.json()) as QueueResponse;
      if (!res.ok || body.error) throw new Error(body.error || `โหลดงานจาก LINE ไม่สำเร็จ (${res.status})`);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const group = useMemo(() => findTargetGroup(data?.groups ?? [], job, search, focusCarRowId), [data?.groups, focusCarRowId, job, search]);
  const lines = useMemo(() => (group ? linesFor(group) : []), [group]);
  const photos = useMemo(() => (group ? attachmentsFor(group) : []), [group]);
  const messages = useMemo(() => (group ? rawMessagesFor(group) : []), [group]);
  const candidates = useMemo(() => (group ? candidatesFor(group) : []), [group]);
  const effectiveCarRowId = group ? carRowIdFor(group, selectedCarRowId) : "";
  const canSave = Boolean(group && effectiveCarRowId && lines.length > 0);
  const detailHref = group ? orderHref(group, selectedCarRowId) : `/liff/orders?search=${encodeURIComponent(search || job)}`;

  useEffect(() => {
    if (!group) return;
    const nextRowId = carRowIdFor(group, selectedCarRowId) || clean(candidates[0]?.car_row_id);
    if (nextRowId && nextRowId !== selectedCarRowId) setSelectedCarRowId(nextRowId);
  }, [candidates, group, selectedCarRowId]);

  async function saveToOrder() {
    if (!group) return;
    const saves = saveBlocks(group, selectedCarRowId);
    if (!canSave || saves.length === 0) {
      setError("ยังบันทึกไม่ได้ เพราะระบบยังจับคู่รถหรืองานที่ต้องทำไม่ครบ");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/line-inbox/pending-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ saves }),
      });
      const body = (await res.json().catch(() => ({}))) as SaveResponse;
      if (!res.ok || body.error) throw new Error(body.error || `บันทึกไม่สำเร็จ (${res.status})`);
      const count = body.results?.reduce((sum, result) => sum + Number(result.saved_count ?? 0), 0) ?? 0;
      setSaved(true);
      setNotice(`บันทึกเข้า Order แล้ว ${count} รายการ`);
      window.setTimeout(() => {
        window.location.href = detailHref;
      }, 650);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[#f6f8fb] px-3 pb-24 pt-3 text-slate-950">
      <div className="mx-auto flex w-full max-w-md flex-col gap-3">
        <header className="sticky top-0 z-10 -mx-3 border-b border-slate-200 bg-[#f6f8fb]/95 px-3 pb-3 pt-2 backdrop-blur">
          <div className="flex items-center gap-2">
            <Link href="/line-jobs-v2" className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-slate-700 shadow-sm ring-1 ring-slate-200" aria-label="กลับ">
              <ArrowLeft className="size-5" aria-hidden />
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-black">รายละเอียดงาน</h1>
              <p className="truncate text-xs font-semibold text-slate-500">ตรวจจาก LINE ก่อนบันทึกเข้า Order</p>
            </div>
            <Button type="button" variant="outline" size="icon" className="size-10 rounded-full bg-white" onClick={() => void loadQueue()} disabled={loading || saving} aria-label="โหลดใหม่">
              <RefreshCcw className={cn("size-4", loading ? "animate-spin" : "")} aria-hidden />
            </Button>
          </div>
        </header>
        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</div> : null}
        {notice ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{notice}</div> : null}

        {loading ? (
          <section className="grid min-h-80 place-items-center rounded-[22px] border border-slate-200 bg-white p-6 text-center">
            <div>
              <Loader2 className="mx-auto size-8 animate-spin text-teal-700" aria-hidden />
              <p className="mt-3 font-bold">กำลังโหลดงานจาก LINE</p>
            </div>
          </section>
        ) : group ? (
          <>
            <section className="rounded-[20px] border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-teal-50 text-teal-700">
                  <Car className="size-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-black leading-tight">{titleFor(group)}</h2>
                  <p className="mt-1 line-clamp-2 text-xs font-semibold text-slate-600">{descriptionFor(group)}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-sm">
                <div className="rounded-2xl bg-slate-50 p-2">
                  <p className="text-xs font-semibold text-slate-500">ผู้รับผิดชอบ</p>
                  <p className="mt-1 truncate font-black">{saleFor(group)}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-2">
                  <p className="text-xs font-semibold text-slate-500">รอบเรือ</p>
                  <p className="mt-1 truncate font-black">{bookedShippingFor(group) || "-"}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-2">
                  <p className="text-xs font-semibold text-slate-500">จาก</p>
                  <p className="mt-1 truncate font-black">{sourceFor(group)}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-2">
                  <p className="text-xs font-semibold text-slate-500">รูป</p>
                  <p className="mt-1 font-black">{photos.length} รูป</p>
                </div>
              </div>
              {candidates.length > 0 || effectiveCarRowId ? (
                <div className="mt-3 rounded-2xl border border-teal-100 bg-teal-50/80 p-2">
                  <p className="text-xs font-semibold text-teal-700">รถในระบบที่จะบันทึกเข้า</p>
                  {candidates.length > 0 ? (
                    <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                      {candidates.map((candidate) => {
                        const rowId = clean(candidate.car_row_id);
                        const active = rowId === effectiveCarRowId;
                        return (
                          <button
                            key={rowId}
                            type="button"
                            onClick={() => setSelectedCarRowId(rowId)}
                            className={cn(
                              "min-w-[180px] rounded-xl border px-3 py-2 text-left text-xs font-black",
                              active ? "border-teal-700 bg-white text-teal-950" : "border-teal-100 bg-teal-100/60 text-teal-800"
                            )}
                          >
                            {compactCandidateLabel(candidate, group)}
                            {clean(candidate.chassis_short) ? <span className="mt-1 block font-semibold text-slate-500">{clean(candidate.chassis_short)}</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-1 text-sm font-black text-teal-950">จับคู่รถแล้ว</p>
                  )}
                </div>
              ) : null}
            </section>

            <section className="rounded-[20px] border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <ClipboardList className="size-5 text-teal-700" aria-hidden />
                <h2 className="text-lg font-black">งานที่ต้องทำ</h2>
              </div>
              {lines.length > 0 ? (
                <div className="space-y-2">
                  {lines.map((line, index) => (
                    <div key={`${line.inbox_id}:${line.item_index ?? index}`} className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
                      <div className="flex gap-3">
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white text-sm font-black text-slate-500 ring-1 ring-slate-200">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[16px] font-black leading-snug">{lineLabel(line, index)}</p>
                          {clean(line.suggested_status) ? <p className="mt-1 text-xs font-bold text-teal-700">{clean(line.suggested_status)}</p> : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-2xl bg-amber-50 p-3 text-sm font-bold text-amber-900">ยังอ่านรายการงานไม่ได้ ต้องตรวจข้อความต้นทางก่อนบันทึก</p>
              )}
            </section>

            <section className="rounded-[20px] border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <Camera className="size-5 text-teal-700" aria-hidden />
                <h2 className="text-lg font-black">รูปจาก LINE</h2>
              </div>
              {photos.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {photos.map((photo, index) => (
                    <a key={clean(photo.line_message_id) || clean(photo.url) || index} href={clean(photo.url)} target="_blank" rel="noreferrer" className="block size-24 shrink-0 overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={clean(photo.url)} alt={clean(photo.file_name) || `LINE photo ${index + 1}`} className="size-full object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              ) : (
                <div className="grid h-24 place-items-center rounded-2xl bg-slate-50 text-slate-500">
                  <ImageIcon className="size-8" aria-hidden />
                </div>
              )}
            </section>

            <section className="rounded-[20px] border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <MessageCircle className="size-5 text-teal-700" aria-hidden />
                <h2 className="text-lg font-black">ข้อความต้นทาง</h2>
              </div>
              {messages.length > 0 ? (
                <div className="space-y-2">
                  {messages.slice(0, 3).map((message) => (
                    <p key={message} className="whitespace-pre-wrap rounded-2xl bg-slate-50 p-3 text-sm font-medium leading-6 text-slate-700">{message}</p>
                  ))}
                </div>
              ) : (
                <p className="rounded-2xl bg-slate-50 p-3 text-sm font-medium text-slate-500">ไม่มีข้อความต้นทาง อาจเป็นรูปหรือไฟล์อย่างเดียว</p>
              )}
            </section>
          </>
        ) : (
          <section className="rounded-[22px] border border-amber-200 bg-white p-5 text-center shadow-[0_10px_28px_rgba(15,23,42,0.08)]">
            <h2 className="text-xl font-black">ยังไม่เจองานนี้ในคิว</h2>
            <p className="mt-2 text-sm font-medium text-slate-600">อาจบันทึกเข้า Order ไปแล้ว หรือข้อความยังอยู่ระหว่างวิเคราะห์</p>
            <Link href={`/liff/orders?search=${encodeURIComponent(search || job)}`} className={cn(buttonVariants(), "mt-4 w-full")}>
              ค้นหาใน Order
            </Link>
          </section>
        )}
      </div>

      {group ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-3 py-3 shadow-[0_-10px_30px_rgba(15,23,42,0.12)] backdrop-blur">
          <div className="mx-auto flex max-w-md gap-2">
            <Link href={detailHref} className={cn(buttonVariants({ variant: "outline" }), "h-12 flex-1 rounded-2xl font-black")}>
              เปิด Order
              <ExternalLink className="ml-2 size-4" aria-hidden />
            </Link>
            <Button type="button" className="h-12 flex-[1.2] rounded-2xl font-black" onClick={() => void saveToOrder()} disabled={!canSave || saving || saved}>
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : <CheckCircle2 className="mr-2 size-4" aria-hidden />}
              {saved ? "บันทึกแล้ว" : "บันทึกเข้า Order"}
            </Button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
