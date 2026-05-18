"use client";

import React, {
  Fragment,
  useId,
  useMemo,
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  startTransition,
} from "react";
import { flushSync } from "react-dom";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Car } from "@/types/car";
import type { OrderTrackingSaleStatusSummary, OrderTrackingSummarySnapshot } from "@/lib/data/cars";
import { ORDER_ITEMS_TABLE_NAME, ORDER_TASK_UPDATES_TABLE_NAME } from "@/lib/data/orders";
import {
  ORDER_TRACKING_SALE_CODES,
  normalizeSaleAssigneesMap,
  resolveSaleStaffForOrder,
} from "@/lib/orders/sale-assignees-shared";
import { isStaffRosterNameExcluded, normalizeStaffRosterNames } from "@/lib/orders/staff-roster-shared";
import { buildOrderTrackingShareOpenUrl } from "@/lib/line/order-tracking-share-url";
import { LineInboxAiToolbar } from "@/components/orders/mobile-v2/line-inbox-ai-toolbar";
import {
  ORDER_ITEM_REF_PIC_EN,
  ORDER_ITEM_TAM_ROOP_TOKEN,
  orderItemLabelContainsTamRoop,
  parseEnglishPhotoRefMarkers,
  stripEnglishPhotoRefMarkers,
} from "@/lib/orders/order-item-tam-roop-token";
import {
  ORDER_TRACKING_ITEM_STATUSES,
  DEFAULT_STORE_DEPOSIT_MAX_DAYS,
  defaultItemStatusPoliciesNormalized,
  normalizeItemStatusPoliciesRaw,
  normalizedItemPoliciesToStoredJson,
  arrivalDueCalendarDaysUntilBangkok,
  matchesDueTodayChip,
  storeDepositEffectiveMaxDays,
  storeDepositRemainingLabel,
  storeDepositTone,
  slaExceededInStatus,
  type ItemStatusPoliciesNormalized,
  type ResolvedItemRowStatusPolicy,
} from "@/lib/orders/item-status-policies";

/** alias — ฟังก์ชันใน lib เดียวกับเดิมที่เคยฮาร์ดโค้ดไว้ข้างล่าง */
const calendarDaysUntilDueBangkok = arrivalDueCalendarDaysUntilBangkok;

const ORDER_ITEM_TAM_ROOP_TOKEN_REGEX =
  /(ตามรูป|ตามภาพ|ref\s*pic|as\s+photo|see\s+photo)/gi;

const SALE_STATUSES = ["ทั้งหมด", "จอง", "รอส่ง", "ส่งแล้ว", "ว่าง"] as const;
const ITEM_STATUSES = ORDER_TRACKING_ITEM_STATUSES;
const WAITING = ["เช็ค", "ต้องสั่ง", "สั่ง"] as const;
const DONE = ["มี", "มา", "รถนอก", "ช่างนอก", "จบ"] as const;
const STATUS_ACTION_NOTE = "__NOTE__";
/** ความกว้างปุ่มต่อช่องเมื่อปัดซ้ายเปิด (px) — สามช่อง = เพิ่มงาน · เพิ่มแถว · ลบ */
const SWIPE_ROW_ACTION_PX = 80;
/** ระยะเปิดเต็มเมื่อปัดซ้าย (สามปุ่มเท่ากัน) */
const SWIPE_ROW_LEFT_OPEN_PX = SWIPE_ROW_ACTION_PX * 3;
/** จากปิด → ปัดซ้ายเกินสัดส่วนนี้แล้วปล่อย = สแนปเปิด (ต่ำ = ปัดนิดเดียวก็ล็อกได้) */
const SWIPE_ROW_SNAP_RATIO = 0.09;
/** แยกทิศทางลากแนวนอน vs เลื่อนหน้าแนวตั้ง — ลดการแย่งสกอร์ล */
const SWIPE_TOUCH_SLOP_PX = 12;
/** แถวร่าง intake ที่อยู่หลังแถวสุดท้ายของการ์ด (ปุ่มเพิ่มแถวว่างในฟอร์ม) */
const INLINE_INSERT_AFTER_END = "__inline_after_last__";

type InlineDraftRow = {
  id: string;
  name: string;
  duplicate: boolean;
  /** ติ๊กเพื่อส่งเข้าเพิ่มงานจริง */
  selected: boolean;
  assignee: string;
  status: ItemStatusValue;
  insertAfterUid: string;
};
type UiLang = "th" | "en";
/** ดึงลงรีเฟรช — ระยะดึง (หลังลดแรง) ที่ปล่อยแล้วให้ refresh */
const PTR_RELEASE_DAMPED_PX = 28;
const STAFF_ROSTER_STORAGE_KEY = "vigo4u.orderTracking.staffRoster";
const SALE_ASSIGNEES_STORAGE_KEY = "vigo4u.orderTracking.saleAssignees";
const ITEM_STATUS_ROSTER_STORAGE_KEY = "vigo4u.orderTracking.itemStatusRoster";
const ITEM_STATUS_LABELS_STORAGE_KEY = "vigo4u.orderTracking.itemStatusLabels";
const ITEM_STATUS_POLICIES_STORAGE_KEY = "vigo4u.orderTracking.itemStatusPolicies.v1";
const STAFF_ROSTER_API_PATH = "/api/m/order-tracking/staff-roster";
/** ชิปกรองรายการที่ยังไม่มีชื่อพนักงาน — ค่าภายใน ไม่ชนกับชื่อจริง */
const STAFF_FILTER_UNASSIGNED = "__UNASSIGNED__";
const STAFF_FILTER_UNASSIGNED_LABEL = "ไม่ระบุชื่อ";
/** กรองตามรอบส่ง (ค่า booked_shipping) — token = prefix + shipGroupKey(ship) */
const STAFF_FILTER_BOOKED_SHIP_PREFIX = "__BOOKED_SHIP__";
/** กรองตามชื่อลูกค้า (สถานะขาย จอง) — token = prefix + buyerGroupKey(buyer) */
const STAFF_FILTER_BOOKED_BUYER_PREFIX = "__BOOKED_BUYER__";
/** ส่งแล้ว: กรองตาม cars.shipped (ว่าง = ไม่มีข้อความ) */
const STAFF_FILTER_SOLD_SHIPPED_EMPTY = "__SOLD_SHIPPED_EMPTY__";
const STAFF_FILTER_SOLD_SHIPPED_PREFIX = "__SOLD_SHIP__";
/** ส่งแล้ว: กรองตาม model year (ว่าง = ไม่มีปีในระบบ) */
const STAFF_FILTER_SOLD_MODEL_YEAR_EMPTY = "__SOLD_MY_EMPTY__";
const STAFF_FILTER_SOLD_MODEL_YEAR_PREFIX = "__SOLD_MY__";
/** สถานะขาย ว่าง: กรองตาม model year (แยกจากชุดส่งแล้ว) */
const STAFF_FILTER_VACANT_MODEL_YEAR_EMPTY = "__VAC_MY_EMPTY__";
const STAFF_FILTER_VACANT_MODEL_YEAR_PREFIX = "__VAC_MY__";
/** legacy ชิปรวม (เดิม) — ยังรองรับใน state แต่ UI ใช้ชิปต่อรอบ */
const STAFF_FILTER_BOOKED_SHIPPING = "__BOOKED_SHIPPING__";
const ITEM_STATUS_PREFS_API_PATH = "/api/m/order-tracking/item-status-prefs";
const ORDER_PHOTOS_LIST_API_PATH = "/api/m/order-photos/list";
const ORDER_PHOTOS_UPLOAD_API_PATH = "/api/m/order-photos/upload";
const ORDER_PHOTOS_DELETE_API_PATH = "/api/m/order-photos/delete";
/** ดึงรูปจาก URL บนเซิร์ฟเวอร์ — ใช้เมื่อลากจาก LINE เดสก์ท็อปได้แต่เป็นลิงก์ ไม่ใช่ไฟล์ */
const ORDER_PHOTOS_FETCH_URL_API_PATH = "/api/m/order-photos/fetch-url";
const ORDER_ITEMS_TRANSLATE_CARD_API_PATH = "/api/m/order-items/translate-card";
const ORDER_ITEMS_TRANSLATE_ALL_API_PATH = "/api/m/order-items/translate-all";
const ORDER_TRACKING_TRANSLATE_CAR_SUMMARY_API_PATH = "/api/m/order-tracking/translate-car-summary";
const ORDER_TRACKING_UI_LANG_STORAGE_KEY = "vigo4u.orderTracking.uiLang";

/** LINE / Chrome หลายกรณีให้เป็น URL ใน text ไม่ใช่ File */
function extractImageUrlsFromDataTransfer(dt: DataTransfer | null): string[] {
  if (!dt) return [];
  const out = new Set<string>();
  const tryAddHttps = (raw: string) => {
    const m = raw.match(/https:\/\/[^\s"'<>`)\]]+/i);
    if (!m?.[0]) return;
    let u = m[0].replace(/[,);]+$/g, "");
    u = u.replace(/&amp;/g, "&");
    try {
      if (new URL(u).protocol !== "https:") return;
      out.add(u);
    } catch {
      /* ignore */
    }
  };

  try {
    const types = dt.types ? Array.from(dt.types as Iterable<string>) : [];
    for (const type of types) {
      if (!type || type === "Files") continue;
      let data = "";
      try {
        data = dt.getData(type);
      } catch {
        continue;
      }
      if (!data) continue;
      const tl = type.toLowerCase();
      /** Chrome บางแหล่ง เช่น ลากจากแอป/เว็บ */
      if (tl.includes("downloadurl")) {
        const lines = data.split(/\n/).map((s) => s.trim()).filter(Boolean);
        const last = lines[lines.length - 1];
        if (last) tryAddHttps(last);
        tryAddHttps(data);
      }
      if (type === "text/uri-list" || tl.includes("uri-list")) {
        for (const line of data.split(/\r?\n/)) {
          const u = line.trim();
          if (!u || u.startsWith("#")) continue;
          tryAddHttps(u.split("\t")[0] ?? u);
        }
      }
      if (type === "text/plain") {
        const matches = data.match(/https:\/\/[^\s<>"']+/gi) ?? [];
        for (const x of matches) tryAddHttps(x);
      }
      if (type === "text/html") {
        const matches = data.match(/https:\/\/[^"'\\s>]+/gi) ?? [];
        for (const x of matches) {
          /** ลด false positive — ยอมผูกเครือข่ายยอดนิยม + นามสกุลรูป */
          const clean = x.replace(/&amp;/g, "&");
          if (
            /line-scdn|line\.me|line-apps|obs\.line|imgur|fbcdn|instagram|googleusercontent/i.test(clean) ||
            /\.(jpe?g|png|webp|gif)(\?|#|$|[&])/i.test(clean)
          ) {
            tryAddHttps(clean);
          }
        }
      }
    }
    /** ถ้ายังไม่ได้ URL — โหลดทุก type แล้วดึง https ที่น่าจะเป็นรูป (หลายแอประบุ MIME ประหลาด) */
    if (out.size === 0) {
      for (const type of types) {
        if (!type || type === "Files") continue;
        try {
          const data = dt.getData(type);
          if (!data || !data.includes("https://")) continue;
          const ms = data.match(/https:\/\/[^\s"'<>`)\]]+/gi) ?? [];
          for (const x of ms) {
            if (/line-scdn|obs\.line|line\.me|line-apps/i.test(x)) tryAddHttps(x);
            else if (/\.(jpe?g|png|webp|gif)(\?|#|$|[&])/i.test(x)) tryAddHttps(x);
          }
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }

  return Array.from(out);
}

function isUnauthorizedApiError(message: string): boolean {
  const m = message.trim();
  return m === "Unauthorized" || m.startsWith("Unauthorized");
}

function parseStaffRosterJson(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const names = normalizeStaffRosterNames(parsed);
    return names.length ? names : null;
  } catch {
    return null;
  }
}

function readStaffRosterFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  return parseStaffRosterJson(localStorage.getItem(STAFF_ROSTER_STORAGE_KEY)) ?? [];
}

function writeStaffRosterToStorage(names: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STAFF_ROSTER_STORAGE_KEY, JSON.stringify(names));
  } catch {
    /* ignore quota / private mode */
  }
}

function readSaleAssigneesFromStorage(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SALE_ASSIGNEES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return normalizeSaleAssigneesMap(parsed) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeSaleAssigneesToStorage(map: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SALE_ASSIGNEES_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}
/** เลือกเซลล์เพิ่มจากชีต — ALL + รหัสจาก sale-assignees-shared */
const ALL_SALES = ["ALL", ...ORDER_TRACKING_SALE_CODES] as const;
const ORDERS_PAGE_SIZE = 40;
/** ความยาวสูงสุดช่องค้นหา (พิมพ์ / วางจาก LINE / คลิปบอร์ด) */
const VEHICLE_SEARCH_MAX = 48;
const SALE_STATUS_PRIORITY: Record<SaleStatusValue, number> = {
  รอส่ง: 0,
  จอง: 1,
  ว่าง: 2,
  ส่งแล้ว: 3,
};

type SaleValue = string;
type SaleStatusValue = Exclude<(typeof SALE_STATUSES)[number], "ทั้งหมด">;
type SaleStatusFilterValue = (typeof SALE_STATUSES)[number];
type ItemStatusValue = (typeof ITEM_STATUSES)[number];
const ITEM_STATUS_DUE_TODAY = "มาวันนี้" as const;
type ItemStatusFilterValue = ItemStatusValue | typeof ITEM_STATUS_DUE_TODAY;
const ITEM_STATUS_ORDER: ItemStatusValue[] = [
  "เช็ค",
  "มี",
  "ต้องสั่ง",
  "สั่ง",
  "มา",
  "รถนอก",
  "ช่างนอก",
  "ฝากสโตร์",
  "ฝากกับรถ",
  "จบ",
];

/** roster ว่าง = ยังไม่กำหนดเอง → แสดงชิปครบตามลำดับมาตรฐาน */
function effectiveItemStatusRoster(roster: ItemStatusValue[]): ItemStatusValue[] {
  return roster.length > 0 ? roster : [...ITEM_STATUS_ORDER];
}

/** ว่างใน input = ปิดค่าที่ต้องการ (null); อย่านับ NaN */
function parseOptionalPolicyDay(raw: string): number | null {
  const t = String(raw).trim();
  if (!t) return null;
  const n = Math.round(Number(t));
  if (!Number.isFinite(n)) return null;
  return Math.min(730, Math.max(1, n));
}

const ITEM_STATUS_EN_LABELS: Record<ItemStatusValue, string> = {
  เช็ค: "Check",
  มี: "In stock",
  ต้องสั่ง: "Need order",
  สั่ง: "Ordered",
  มา: "Received",
  รถนอก: "Outsource car",
  ช่างนอก: "Outsource garage",
  ฝากสโตร์: "Store hold",
  ฝากกับรถ: "Hold with car",
  จบ: "Done",
};

const SALE_STATUS_EN_LABELS: Record<SaleStatusFilterValue, string> = {
  ทั้งหมด: "All",
  จอง: "Booked",
  รอส่ง: "Waiting Ship",
  ส่งแล้ว: "Shipped",
  ว่าง: "Available",
};

function displayItemStatusLabel(st: ItemStatusValue, uiLang: UiLang): string {
  return uiLang === "en" ? ITEM_STATUS_EN_LABELS[st] ?? st : st;
}

function displaySaleStatusLabel(st: SaleStatusFilterValue, uiLang: UiLang): string {
  return uiLang === "en" ? SALE_STATUS_EN_LABELS[st] ?? st : st;
}

/** ชิปกรองรายการที่ยังไม่มีชื่อพนักงาน — แสดง EN เมื่อ UI เป็นอังกฤษ (คีย์ภายในใช้ STAFF_FILTER_UNASSIGNED) */
function displayStaffFilterUnassignedLabel(uiLang: UiLang): string {
  return uiLang === "en" ? "Unassigned" : STAFF_FILTER_UNASSIGNED_LABEL;
}

/** ลำดับชิปในตัวกรองสถานะรายการ — คงที่ตามแถวด้านบน (ไม่ตามลำดับลากในจัดการสถานะ) */
function sortItemStatusesForFilterToolbar(statuses: ItemStatusValue[]): ItemStatusValue[] {
  const rank = (s: ItemStatusValue) => {
    const i = ITEM_STATUS_ORDER.indexOf(s);
    return i >= 0 ? i : ITEM_STATUS_ORDER.length + 1;
  };
  return [...statuses].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "th"));
}

/**
 * โทนชิปตัวกรองสถานะรายการ
 * เช็ค เหลือง · มี เขียว · สั่ง ส้ม · มา = รับแล้ว (เขียวอีกโทน) · จบ ฟ้า · รถนอก/ช่างนอก เขียวเข้ม · ฝากสโตร์ เทา
 */
function toolbarItemStatusFilterChipClasses(s: ItemStatusFilterValue, active: boolean): string {
  if (s === ITEM_STATUS_DUE_TODAY) {
    return active
      ? "bg-red-600 text-white shadow-sm ring-1 ring-red-500/40"
      : "bg-rose-100 text-red-800 ring-1 ring-rose-300/90 hover:bg-rose-200/90";
  }
  if (s === "เช็ค") {
    return active
      ? "bg-amber-500 text-white shadow-sm ring-1 ring-amber-600/45"
      : "bg-amber-100 text-amber-950 ring-1 ring-amber-300/90 hover:bg-amber-200/90";
  }
  if (s === "มี") {
    return active
      ? "bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-500/40"
      : "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300/85 hover:bg-emerald-200/90";
  }
  if (s === "สั่ง") {
    return active
      ? "bg-orange-600 text-white shadow-sm ring-1 ring-orange-500/40"
      : "bg-orange-100 text-orange-950 ring-1 ring-orange-300/90 hover:bg-orange-200/90";
  }
  // ความหมายทางร้าน ≈ 「รับแล้ว」 — โค้ดสถานะคือ 「มา」
  if (s === "มา") {
    return active
      ? "bg-green-600 text-white shadow-sm ring-1 ring-green-600/35"
      : "bg-green-100 text-green-900 ring-1 ring-green-300/85 hover:bg-green-200/90";
  }
  if (s === "จบ") {
    return active
      ? "bg-sky-600 text-white shadow-sm ring-1 ring-sky-500/35"
      : "bg-sky-100 text-sky-900 ring-1 ring-sky-300/85 hover:bg-sky-200/90";
  }
  if (s === "รถนอก" || s === "ช่างนอก") {
    return active
      ? "bg-emerald-900 text-white shadow-sm ring-1 ring-emerald-950/50"
      : "bg-emerald-200 text-emerald-950 ring-1 ring-emerald-700/35 hover:bg-emerald-300/90";
  }
  if (s === "ฝากสโตร์") {
    return active
      ? "bg-gray-700 text-white shadow-sm ring-1 ring-gray-800/45"
      : "bg-gray-200 text-gray-900 ring-1 ring-gray-400/75 hover:bg-gray-300/90";
  }
  return active ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200/70";
}

const ALLOWED_ITEM_STATUS_SET = new Set<string>(ITEM_STATUSES);
type ItemStatusLabelMap = Partial<Record<ItemStatusValue, string>>;

function normalizeItemStatusRoster(input: unknown): ItemStatusValue[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<ItemStatusValue>();
  const unique: ItemStatusValue[] = [];
  for (const x of input) {
    const s = String(x).trim();
    if (!ALLOWED_ITEM_STATUS_SET.has(s)) continue;
    const st = s as ItemStatusValue;
    if (seen.has(st)) continue;
    seen.add(st);
    unique.push(st);
  }
  if (!unique.length) return [];
  const ordered = [...ITEM_STATUS_ORDER].filter((s) => seen.has(s));
  const extras = unique.filter((s) => !ordered.includes(s));
  return [...ordered, ...extras];
}

function parseItemStatusRosterJson(raw: string | null): ItemStatusValue[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeItemStatusRoster(parsed);
  } catch {
    return null;
  }
}

/** ชิปกรองสถานะรายการ — เหมือน roster พนักงาน · เก็บ localStorage เครื่องนี้ */
function readItemStatusRosterFromStorage(): ItemStatusValue[] {
  if (typeof window === "undefined") return [];
  const parsed = parseItemStatusRosterJson(localStorage.getItem(ITEM_STATUS_ROSTER_STORAGE_KEY)) ?? [];
  if (
    parsed.length === ITEM_STATUS_ORDER.length &&
    ITEM_STATUS_ORDER.every((s, i) => parsed[i] === s)
  ) {
    return [];
  }
  return parsed;
}

function writeItemStatusRosterToStorage(roster: ItemStatusValue[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ITEM_STATUS_ROSTER_STORAGE_KEY, JSON.stringify(roster));
  } catch {
    /* ignore */
  }
}

function parseItemStatusLabelsJson(raw: string | null): ItemStatusLabelMap | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const out: ItemStatusLabelMap = {};
    for (const status of ITEM_STATUSES) {
      const value = (parsed as Record<string, unknown>)[status];
      if (value == null) continue;
      const label = String(value).trim();
      if (!label || label === status) continue;
      out[status] = label;
    }
    return out;
  } catch {
    return null;
  }
}

function readItemStatusLabelsFromStorage(): ItemStatusLabelMap {
  if (typeof window === "undefined") return {};
  return parseItemStatusLabelsJson(localStorage.getItem(ITEM_STATUS_LABELS_STORAGE_KEY)) ?? {};
}

function writeItemStatusLabelsToStorage(labels: ItemStatusLabelMap) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ITEM_STATUS_LABELS_STORAGE_KEY, JSON.stringify(labels));
  } catch {
    /* ignore */
  }
}

function writeItemStatusPoliciesSparseToStorage(policiesSparse: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ITEM_STATUS_POLICIES_STORAGE_KEY, JSON.stringify(policiesSparse));
  } catch {
    /* ignore */
  }
}

function readItemStatusPoliciesFromStorageNormalized(): ItemStatusPoliciesNormalized | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ITEM_STATUS_POLICIES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return normalizeItemStatusPoliciesRaw(parsed);
  } catch {
    return null;
  }
}

function normalizeItemStatusLabels(input: unknown): ItemStatusLabelMap {
  if (!input || typeof input !== "object") return {};
  const row = input as Record<string, unknown>;
  const next: ItemStatusLabelMap = {};
  for (const status of ITEM_STATUSES) {
    const value = row[status];
    if (value == null) continue;
    const label = String(value).trim();
    if (!label || label === status) continue;
    next[status] = label;
  }
  return next;
}

const WAITING_SET = new Set<ItemStatusValue>(WAITING);
const DONE_SET = new Set<ItemStatusValue>(DONE);

type OrderItem = {
  id?: string | null;
  orderTaskId?: string | null;
  name: string;
  nameEn?: string;
  status: ItemStatusValue;
  assignee: string;
  dueDate?: string;
  /** ฝากสโตร์: วันเริ่มนับ 30 วัน (yyyy-mm-dd กทม.) จาก updated_at/created_at ใน DB */
  clockStartYmd?: string;
  /** วันที่เปลี่ยนสถานะล่าสุด (yyyy-mm-dd กทม.) จาก status_changed_at ใน DB */
  statusChangedAtYmd?: string;
  note?: string;
  /** แปลอัตโนมัติของหมายเหตุ (note_en) — แสดงเมื่อ UI เป็นภาษาอังกฤษ */
  noteEn?: string;
  good?: boolean;
  supplier?: string;
  eta?: string;
  price?: string;
  overdue?: boolean;
};

type OrderPhotoEntry = { id: string; url: string; created_at?: string | null };

type Order = {
  id: string;
  carRowId: string | null;
  carId: number | null;
  sale: string;
  modelYear: string;
  saleStatus: SaleStatusValue;
  /** ข้อความ shipped จาก cars.shipped — สถานะส่งแล้วใช้กรอง/แสดงแยกตามนี้ (ไม่ใช่ booked_shipping) */
  shipped: string;
  ship: string;
  link: string;
  fullPlate: string;
  plate: string;
  car: string;
  chassis: string;
  buyer: string;
  salePrice: string;
  cost: string;
  costBreakdown: string;
  /** ชื่อเดียวกับ mock — ถ้ามีจะใช้แทน costBreakdown ในการ์ด */
  costDetail?: string;
  expense: string;
  /** สรุปเอกสาร/เล่ม (จาก cars เมื่อมี) */
  documentDetail: string;
  repairDetails: string;
  repairDetail?: string;
  partAccessoriesRaw: string;
  photo: string;
  expensePdf: string | null;
  updates: Array<{
    id?: string | null;
    actionType: string;
    oldValue: string;
    newValue: string;
    note: string;
    updatedBy: string;
    createdAt: string;
  }>;
  items: OrderItem[];
};

/**
 * จัดเรียงการ์ดในลิสต์: มีงานค้าง (มีรายการและยังไม่จบ) → มีรายการจบแล้ว → ยังไม่มีรายการ
 */
function orderCardWorkPresenceRank(order: Order): number {
  const list = order.items ?? [];
  if (list.length === 0) return 2;
  const hasOpenWork = list.some((it) => !(it.good ?? false) && !DONE_SET.has(it.status));
  return hasOpenWork ? 0 : 1;
}

/** รูปที่ใส่ใน LINE / ลิงก์การ์ดได้ — ต้องเป็น http(s) เท่านั้น (ไม่สร้างลิงก์ถ้าเป็น `#` หรือไม่ใช่ URL) */
function orderPhotoHttpUrl(photo: string | undefined): string | null {
  const t = String(photo ?? "").trim();
  if (!t || t === "#" || !/^https?:\/\//i.test(t)) return null;
  return t;
}

type MobileOrderTrackingHomeProps = {
  carsData?: Car[];
  orderItemsByCar?: Record<
    string,
    Array<{
      id?: string | null;
      order_task_id?: string | null;
      label: string;
      label_en?: string | null;
      status: string;
      assignee_staff: string | null;
      due_date?: string | null;
      note?: string | null;
      note_en?: string | null;
      outside_supplier: string | null;
      outside_eta_date: string | null;
      outside_price: number | null;
      clock_start_ymd?: string | null;
      status_changed_at?: string | null;
    }>
  >;
  orderUpdatesByCar?: Record<
    string,
    Array<{
      id?: string | null;
      order_task_id?: string | null;
      role?: string | null;
      message?: string | null;
      created_at?: string | null;
    }>
  >;
  dataWarnings?: string[];
  /** จาก `/m/orders?order=...` — เลื่อนไปการ์ดและกรองทะเบียนให้โผล่ */
  initialFocusedOrderId?: string | null;
  /** origin จาก request (เซิร์ฟเวอร์) — ให้ลิงก์แชร์ LINE มี URL เต็มแม้ยังไม่ hydrate */
  shareBaseUrl?: string | null;
  /** locale เริ่มต้นจาก cookie ฝั่งเซิร์ฟเวอร์ */
  initialUiLang?: UiLang;
  /** สรุปสถานะขายจากรถทั้งหมด (ไม่โดน cap รายการรอบแรก) */
  saleStatusSummaryAllCars?: OrderTrackingSaleStatusSummary | null;
  /** snapshot สรุปทุกกล่องจาก cache table */
  summarySnapshotAllCars?: OrderTrackingSummarySnapshot | null;
  /** ถ้า true: ห้าม fallback ไปข้อมูล demo ในไฟล์ */
  disableDemoFallback?: boolean;
  /** โหลดสรุปก่อน แล้วค่อย hydrate รายการรถอัตโนมัติ */
  deferCarsHydration?: boolean;
};

const ORDERS: Order[] = [
  {
    id: "OT-1024",
    carRowId: null,
    carId: null,
    sale: "WAN",
    saleStatus: "จอง",
    shipped: "",
    ship: "2-6.2",
    link: "https://vigo4u-os.com/m/orders/OT-1024",
    fullPlate: "71331",
    plate: "71331",
    car: "ROCCO 4WD 2.8 OVERLAND Plus AT Double_Cab GRAY Jan26",
    chassis: "MR0YA3AV803071331",
    modelYear: "",
    buyer: "RIZWAN ABID",
    salePrice: "$47,200",
    cost: "$45,218",
    costBreakdown:
      "27,422(32.47) --> 890,500(Total Cost) = 880,000(Car Price) + 10,500(Expense) [กำไร] --> kie10000 kie860000 เล่มพร้อม +10000 kie5000คอมเอเย่นเอ็ม รับรถเชียงราย เติมน้ำมัน จ้างคนขับ เช่ารถ5500",
    costDetail:
      "27,422(32.47) --> 890,500(Total Cost) = 880,000(Car Price) + 10,500(Expense) [กำไร] --> kie10000 kie860000 เล่มพร้อม +10000 kie5000คอมเอเย่นเอ็ม รับรถเชียงราย เติมน้ำมัน จ้างคนขับ เช่ารถ5500",
    expense: "177,343",
    photo: "#photos-1024",
    expensePdf: "#expenses-1024",
    documentDetail: "เล่มพร้อม / เอกสารครบ / รอโอนหลังจ่ายครบ",
    repairDetails: "ซ่อมสีกันชนหน้า / เช็คช่วงล่าง / เก็บงานไฟหน้า",
    repairDetail: "ซ่อมสีกันชนหน้า / เช็คช่วงล่าง / เก็บงานไฟหน้า",
    partAccessoriesRaw: "",
    updates: [],
    items: [
      { name: "ล้อแม็ก 17 นิ้ว", status: "มี", assignee: "", good: true },
      { name: "ไฟ LED", status: "มี", assignee: "", good: true },
      { name: "โรบาร์", status: "สั่ง", assignee: "", supplier: "ถาวร", eta: "29 Apr", price: "฿3,800" },
      { name: "กันชนหน้า", status: "เช็ค", assignee: "" },
      { name: "ยาง AT", status: "เช็ค", assignee: "" },
    ],
  },
  {
    id: "OT-1025",
    carRowId: null,
    carId: null,
    sale: "FAH",
    saleStatus: "รอส่ง",
    shipped: "",
    ship: "เรือ 2 May",
    link: "https://vigo4u-os.com/m/orders/OT-1025",
    fullPlate: "ขข 9021",
    plate: "9021",
    car: "FORTUNER 2.4 4WD 2020",
    chassis: "MR0DB8FS700889912",
    modelYear: "2020",
    buyer: "Premier / Barbados",
    salePrice: "$41,200",
    cost: "34,600",
    costBreakdown: "1,105,000(Total Cost) = 1,070,000(Car Price) + 35,000(Expense) [กำไรน้อย] --> Premier Barbados",
    expense: "฿9,800",
    photo: "#photos-1025",
    expensePdf: "#expenses-1025",
    documentDetail: "เอกสารรอเช็คเล่ม / สำเนาผู้ขายครบ",
    repairDetails: "เปลี่ยนบันไดข้าง / เก็บรอยรอบคัน",
    partAccessoriesRaw: "",
    updates: [],
    items: [
      { name: "บันไดข้าง", status: "จบ", assignee: "", good: true },
      { name: "กล้องหลัง", status: "จบ", assignee: "", good: true },
      { name: "ฟิล์ม", status: "จบ", assignee: "", good: true },
    ],
  },
  {
    id: "OT-1026",
    carRowId: null,
    carId: null,
    sale: "GOOD",
    saleStatus: "ส่งแล้ว",
    shipped: "เรือออก 12 May 2025",
    ship: "",
    link: "https://vigo4u-os.com/m/orders/OT-1026",
    fullPlate: "ป้ายแดง 12345",
    plate: "12345",
    car: "TRAVO 2.8 4WD 2025",
    chassis: "MR0NEWTRAVO12345",
    modelYear: "2025",
    buyer: "New stock",
    salePrice: "$38,500",
    cost: "31,200",
    costBreakdown: "995,000(Total Cost) = 980,000(Car Price) + 15,000(Expense) [รอปิดงาน] --> New stock",
    expense: "฿24,000",
    photo: "#photos-1026",
    expensePdf: "#expenses-1026",
    documentDetail: "รถใหม่ / เอกสารรอใบกำกับ",
    repairDetails: "ติดตั้งชุดแต่ง / ตรวจระบบไฟ",
    partAccessoriesRaw: "",
    updates: [],
    items: [
      { name: "โรบาร์", status: "เช็ค", assignee: "" },
      { name: "ฟิล์ม", status: "มี", assignee: "", good: true },
      { name: "ชุดแต่ง", status: "สั่ง", assignee: "", supplier: "ร้านแต่ง", eta: "เลย 2 วัน", price: "฿12,000", overdue: true },
    ],
  },
];

const cn = (...v: Array<string | false | null | undefined>) => v.filter(Boolean).join("\n");
const norm = (v: unknown) => String(v || "").replace(/\s+/g, "").toLowerCase();

const TOOLBAR_FLAG_SVG_BASE = "h-[1.375rem] shrink-0 rounded-[3px] shadow-sm ring-1 ring-black/10";

/** ธงเล็กสำหรับปุ่มสลับภาษา — ใช้ SVG แทนอีโมจิ (Windows มักไม่เรนเดอร์ธงเป็นภาพ) */
function OrderTrackingToolbarFlagTh({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 900 600"
      className={cn(TOOLBAR_FLAG_SVG_BASE, "w-[2.0625rem]", className)}
      aria-hidden
      focusable="false"
    >
      <rect width="900" height="100" fill="#ED1C24" />
      <rect y="100" width="900" height="100" fill="#fff" />
      <rect y="200" width="900" height="200" fill="#241468" />
      <rect y="400" width="900" height="100" fill="#fff" />
      <rect y="500" width="900" height="100" fill="#ED1C24" />
    </svg>
  );
}

function OrderTrackingToolbarFlagGb({ className }: { className?: string }) {
  const clipId = useId().replace(/:/g, "_");
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 60 30"
      className={cn(TOOLBAR_FLAG_SVG_BASE, "w-[2.5625rem]", className)}
      aria-hidden
      focusable="false"
    >
      <defs>
        <clipPath id={clipId}>
          <rect width="60" height="30" rx="0.8" ry="0.8" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width="60" height="30" fill="#012169" />
        <path stroke="#fff" strokeWidth="10" d="M0 0 L60 30 M60 0 L0 30" />
        <path stroke="#C8102E" strokeWidth="6" d="M0 0 L60 30 M60 0 L0 30" />
        <path stroke="#fff" strokeWidth="12" d="M30 0 V30 M0 15 H60" />
        <path stroke="#C8102E" strokeWidth="8" d="M30 0 V30 M0 15 H60" />
      </g>
    </svg>
  );
}

/**
 * สีต่อพนักงาน (แฮชชื่อ) — ใช้ทั้งช่องเลือกในการ์ดและชิปกรองด้านบนให้ตรงกัน
 * ชุดสียาว (~28 โทน) + FNV-1a ลดการชนเมื่อมีชิปเยอะ — ชื่อเดิมได้สีคงที่
 * surface = แบบใน card · active = ชิปตอนเลือกกรอง
 */
const ASSIGNEE_PALETTE = [
  { surface: "bg-rose-200 text-rose-950 ring-rose-600/50", active: "bg-rose-700 text-white ring-rose-900/55" },
  { surface: "bg-red-200 text-red-950 ring-red-600/50", active: "bg-red-700 text-white ring-red-900/55" },
  { surface: "bg-orange-200 text-orange-950 ring-orange-600/50", active: "bg-orange-700 text-white ring-orange-900/55" },
  { surface: "bg-amber-200 text-amber-950 ring-amber-600/50", active: "bg-amber-700 text-white ring-amber-900/55" },
  { surface: "bg-yellow-200 text-yellow-950 ring-yellow-600/45", active: "bg-yellow-700 text-white ring-yellow-900/50" },
  { surface: "bg-lime-200 text-lime-950 ring-lime-600/50", active: "bg-lime-700 text-white ring-lime-900/55" },
  { surface: "bg-green-200 text-green-950 ring-green-600/50", active: "bg-green-700 text-white ring-green-900/55" },
  { surface: "bg-emerald-200 text-emerald-950 ring-emerald-600/50", active: "bg-emerald-700 text-white ring-emerald-900/55" },
  { surface: "bg-teal-200 text-teal-950 ring-teal-600/50", active: "bg-teal-700 text-white ring-teal-900/55" },
  { surface: "bg-cyan-200 text-cyan-950 ring-cyan-600/50", active: "bg-cyan-700 text-white ring-cyan-900/55" },
  { surface: "bg-sky-200 text-sky-950 ring-sky-600/50", active: "bg-sky-700 text-white ring-sky-900/55" },
  { surface: "bg-blue-200 text-blue-950 ring-blue-600/50", active: "bg-blue-700 text-white ring-blue-900/55" },
  { surface: "bg-indigo-200 text-indigo-950 ring-indigo-600/50", active: "bg-indigo-700 text-white ring-indigo-900/55" },
  { surface: "bg-violet-200 text-violet-950 ring-violet-600/50", active: "bg-violet-700 text-white ring-violet-900/55" },
  { surface: "bg-purple-200 text-purple-950 ring-purple-600/50", active: "bg-purple-700 text-white ring-purple-900/55" },
  { surface: "bg-fuchsia-200 text-fuchsia-950 ring-fuchsia-600/50", active: "bg-fuchsia-700 text-white ring-fuchsia-900/55" },
  { surface: "bg-pink-200 text-pink-950 ring-pink-600/50", active: "bg-pink-700 text-white ring-pink-900/55" },
  { surface: "bg-stone-200 text-stone-900 ring-stone-600/45", active: "bg-stone-700 text-white ring-stone-900/50" },
  { surface: "bg-zinc-200 text-zinc-900 ring-zinc-600/45", active: "bg-zinc-700 text-white ring-zinc-900/50" },
  { surface: "bg-neutral-200 text-neutral-900 ring-neutral-600/45", active: "bg-neutral-700 text-white ring-neutral-900/50" },
  { surface: "bg-slate-200 text-slate-900 ring-slate-600/45", active: "bg-slate-700 text-white ring-slate-900/50" },
  /* โทนเข้มขึ้นเล็กน้อย — แยกจากแถว -200 เดิมเมื่อมีชิปเยอะ */
  { surface: "bg-orange-300 text-orange-950 ring-orange-700/45", active: "bg-orange-800 text-white ring-orange-950/55" },
  { surface: "bg-lime-300 text-lime-950 ring-lime-700/45", active: "bg-lime-800 text-white ring-lime-950/55" },
  { surface: "bg-sky-300 text-sky-950 ring-sky-700/45", active: "bg-sky-800 text-white ring-sky-950/55" },
  { surface: "bg-violet-300 text-violet-950 ring-violet-700/45", active: "bg-violet-800 text-white ring-violet-950/55" },
  { surface: "bg-amber-300 text-amber-950 ring-amber-700/45", active: "bg-amber-800 text-white ring-amber-950/55" },
  { surface: "bg-teal-300 text-teal-950 ring-teal-700/45", active: "bg-teal-800 text-white ring-teal-950/55" },
  { surface: "bg-fuchsia-300 text-fuchsia-950 ring-fuchsia-700/45", active: "bg-fuchsia-800 text-white ring-fuchsia-950/55" },
] as const;

function assigneeStablePaletteIndex(assigneeLabel: string): number {
  const s = assigneeLabel.trim();
  /** FNV-1a 32-bit — กระจายดีกว่า hash*31 เมื่อโมดูโลชุดสียาว */
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % ASSIGNEE_PALETTE.length;
}

function assigneeSelectSurfaceClasses(assignee: string): string {
  const name = String(assignee ?? "").trim();
  if (!name) return "bg-white text-slate-800 ring-slate-200/75";
  return ASSIGNEE_PALETTE[assigneeStablePaletteIndex(name)]!.surface;
}

/**
 * ชิปแถบพนักงาน — จัด index ไม่ซ้ำในรอบเดียวกัน (ชื่อชุดเดียวกันได้สีคงที่จากแฮชจนกว่าจะชน)
 */
function buildStaffToolbarAssigneePaletteIndexMap(names: readonly string[]): Map<string, number> {
  const sorted = [...names].sort((a, b) => a.localeCompare(b, "en"));
  const used = new Set<number>();
  const map = new Map<string, number>();
  const L = ASSIGNEE_PALETTE.length;
  for (const name of sorted) {
    let idx = assigneeStablePaletteIndex(name) % L;
    if (used.size < L) {
      let tries = 0;
      while (used.has(idx) && tries < L) {
        idx = (idx + 1) % L;
        tries += 1;
      }
      used.add(idx);
    }
    map.set(name, idx);
  }
  return map;
}

/** ชิปกรองชื่อพนักงาน — ใช้สีเดียวกับฟิลด์พนักงานในการ์ด · paletteIndexOverride = สีคงที่จากแถบ (ไม่ซ้ำในกลุ่มชิป) */
function assigneeStaffFilterChipClasses(staffLabel: string, selected: boolean, paletteIndexOverride?: number): string {
  const name = String(staffLabel ?? "").trim();
  if (!name) {
    return selected ? "bg-slate-950 text-white ring-slate-800/40" : "bg-slate-100 text-slate-700 ring-slate-200/80 hover:bg-slate-200/70";
  }
  const idx =
    paletteIndexOverride !== undefined && paletteIndexOverride >= 0
      ? paletteIndexOverride % ASSIGNEE_PALETTE.length
      : assigneeStablePaletteIndex(name);
  const { surface, active } = ASSIGNEE_PALETTE[idx]!;
  if (selected) return active;
  return cn(surface, "hover:brightness-[0.97]");
}

/** ใช้สร้างลิงก์ `/m/orders?order=…` — ลำดับ: จากเซิร์ฟเวอร์ → window → env */
function resolveShareAppBase(publicOriginProp: string | undefined | null): string {
  const fromServer = String(publicOriginProp ?? "").trim().replace(/\/$/, "");
  if (fromServer) return fromServer;
  if (typeof window !== "undefined" && window.location?.origin && window.location.origin !== "null") {
    return window.location.origin.replace(/\/$/, "");
  }
  const pub = String(process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
  if (pub) return pub;
  const vc = String(process.env.VERCEL_URL ?? "").trim();
  if (vc) return (vc.startsWith("http") ? vc : `https://${vc}`).replace(/\/$/, "");
  return "";
}

/** คำค้นเดียวจับทั้งเลขทะเบียน (และป้ายเต็ม) เลขตัวถัง และรุ่นรถ */
function matchesVehicleSearch(order: Order, raw: string): boolean {
  const q = raw.trim();
  if (!q) return true;
  const n = norm(q);
  return (
    order.plate.includes(q) ||
    order.fullPlate.includes(q) ||
    norm(order.chassis).includes(n) ||
    order.car.toLowerCase().includes(q.toLowerCase())
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

function itemMatchesStaffFilter(assignee: string | undefined | null, staffSelection: string): boolean {
  if (isBookedShipStaffFilter(staffSelection)) return false;
  if (isBookedBuyerStaffFilter(staffSelection)) return false;
  if (isSoldShippedStaffFilter(staffSelection)) return false;
  if (isSoldModelYearStaffFilter(staffSelection)) return false;
  if (isVacantSaleModelYearStaffFilter(staffSelection)) return false;
  if (staffSelection === "ทั้งหมด") return true;
  if (staffSelection === STAFF_FILTER_UNASSIGNED) return !String(assignee ?? "").trim();
  return String(assignee ?? "").trim() === staffSelection;
}

/** บรรทัดแรกจากการวาง — ไทย / A–Z / เลข / ช่องว่าง */
function sanitizeVehicleSearchPaste(raw: string): string {
  const line = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean) ?? "";
  const cleaned = line
    .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9 \-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, VEHICLE_SEARCH_MAX);
}

/** ขณะพิมพ์ในช่องค้นหา — อนุญาตไทย / A–Z / เลข / ช่องว่าง / - (ไม่รวมบรรทัดใหม่) */
function sanitizeVehicleSearchInput(raw: string): string {
  return raw.replace(/[^\u0E00-\u0E7Fa-zA-Z0-9 \-]/g, "").slice(0, VEHICLE_SEARCH_MAX);
}

function formatDueDateLabel(isoDate: string): string {
  const v = String(isoDate ?? "").trim();
  if (!v) return "";
  const date = new Date(`${v}T00:00:00`);
  if (Number.isNaN(date.getTime())) return v;
  return date.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

/** ชื่อเดียวกับ mock — รับค่า yyyy-mm-dd */
function formatDateInput(value: string): string {
  if (!value) return "";
  return formatDueDateLabel(value);
}

/** LINE share — จำกัดความยาว URL โดยประมาณ */
const LINE_SHARE_MAX_CHARS = 2200;

function sortOrderItemsForShare(rows: OrderItem[]): OrderItem[] {
  return [...rows].sort((a, b) => {
    const ai = ITEM_STATUS_ORDER.indexOf(a.status);
    const bi = ITEM_STATUS_ORDER.indexOf(b.status);
    const orderDiff = (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    if (orderDiff !== 0) return orderDiff;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""), "en", { sensitivity: "base" });
  });
}

/** ไม่ซ้ำป้ายเมื่อ spec ขึ้นต้นด้วยเลขทะเบียนเดียวกับ fullPlate */
function carHeadlineForShare(fullPlate: string, carSpec: string): string {
  const p = fullPlate.trim();
  const c = carSpec.trim();
  if (!c) return p && p !== "-" ? p : "รายละเอียดรถ";
  if (!p || p === "-") return c;
  if (c.startsWith(p)) return c;
  return `${p} ${c}`.trim();
}

function orderItemShareLine(item: OrderItem, norms: ItemStatusPoliciesNormalized): string {
  const name = String(item.name ?? "").trim() || "(ไม่มีชื่อ)";
  const bits: string[] = [name, item.status];
  const asg = String(item.assignee ?? "").trim();
  if (asg) bits.push(asg);
  const rowPol = norms.byStatus[item.status as ItemStatusValue];
  if (rowPol?.storeDepositClock) {
    const cap = storeDepositEffectiveMaxDays(rowPol);
    if (item.clockStartYmd?.trim()) {
      bits.push(
        `ลงข้อมูล ${formatDateInput(item.clockStartYmd)} · ${storeDepositRemainingLabel(item.clockStartYmd, cap)}`
      );
    } else {
      bits.push(storeDepositRemainingLabel(undefined, cap));
    }
  } else if (rowPol?.arrivalDueDate && item.dueDate?.trim()) {
    bits.push(`มา ${formatDateInput(item.dueDate)}`);
  } else if (item.dueDate?.trim()) {
    bits.push(`มา ${formatDateInput(item.dueDate)}`);
  }
  if (item.statusChangedAtYmd?.trim()) {
    bits.push(`สถานะ ${formatDateInput(item.statusChangedAtYmd)}`);
  }
  const note = item.note?.trim();
  if (note) bits.push(`หมายเหตุ: ${note}`);
  return `▫️ ${bits.join(" · ")}`;
}

const BANGKOK_TZ = "Asia/Bangkok";

function todayBangkokYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: BANGKOK_TZ });
}

/** timestamptz จาก DB → yyyy-mm-dd (ปฏิทินกทม.) สำหรับแสดงวันที่เปลี่ยนสถานะ */
function statusChangedAtYmdFromDbIso(iso: string | null | undefined): string | undefined {
  const s = String(iso ?? "").trim();
  if (!s) return undefined;
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00+07:00` : s);
  if (Number.isNaN(parsed)) return undefined;
  const ymd = new Date(parsed).toLocaleDateString("en-CA", { timeZone: BANGKOK_TZ });
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : undefined;
}

/** วันที่เปลี่ยนสถานะ: แสดงเฉพาะกรณีผ่านมาเกิน 1 วัน (>= 2 วัน) */
function statusChangedElapsedLabel(statusChangedYmd: string | undefined): string | null {
  const raw = String(statusChangedYmd ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const todayYmd = todayBangkokYmd();
  const t0 = new Date(`${todayYmd}T12:00:00+07:00`).getTime();
  const s0 = new Date(`${raw}T12:00:00+07:00`).getTime();
  if (Number.isNaN(t0) || Number.isNaN(s0)) return null;
  const elapsed = Math.round((t0 - s0) / (24 * 60 * 60 * 1000));
  if (elapsed <= 1) return null;
  return `${elapsed} วัน`;
}

/** เหลือง = เหลือ 1 วันก่อนวันมา · แดง = วันนี้ครบหรือเลยกำหนด */
function dueDateArrivalButtonTone(dueYmd: string | undefined): "amber" | "red" | "sky" {
  const days = calendarDaysUntilDueBangkok(dueYmd);
  if (days == null) return "sky";
  if (days <= 0) return "red";
  if (days === 1) return "amber";
  return "sky";
}

/** ตัวกรองสถานะรายการบนแถบเครื่องมือ — ใช้คู่กับกรองพนักงานเพื่อซ่อนแถวในการ์ด */
function itemMatchesToolbarStatusFilter(
  item: Pick<OrderItem, "status" | "good" | "dueDate">,
  statusFilter: ItemStatusFilterValue | "",
  dueTodayChip: ItemStatusPoliciesNormalized["dueToday"]
): boolean {
  if (!statusFilter) return true;
  if (statusFilter === ITEM_STATUS_DUE_TODAY) return matchesDueTodayChip(item, dueTodayChip);
  if (statusFilter === "จบ") return item.status === "จบ" || Boolean(item.good);
  return item.status === statusFilter;
}

function toggleSetMember<T>(prev: Set<T>, key: T): Set<T> {
  const next = new Set(prev);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function orderMatchesSaleFilters(order: Order, saleFilters: Set<string>): boolean {
  if (saleFilters.size === 0) return true;
  const up = String(order.sale).toUpperCase();
  for (const code of Array.from(saleFilters)) {
    if (up === String(code).toUpperCase()) return true;
  }
  return false;
}

function orderMatchesSaleStatusFilters(order: Order, saleStatusFilters: Set<SaleStatusFilterValue>): boolean {
  if (saleStatusFilters.size === 0) return true;
  return saleStatusFilters.has(order.saleStatus);
}

function splitStaffFilters(staffFilters: Set<string>): {
  itemStaffFilters: Set<string>;
  bookedShipKeys: Set<string>;
  bookedBuyerKeys: Set<string>;
  soldShippedTokens: Set<string>;
  soldModelYearTokens: Set<string>;
  vacantModelYearTokens: Set<string>;
  anyBookedShippingLegacy: boolean;
} {
  const itemStaffFilters = new Set<string>();
  const bookedShipKeys = new Set<string>();
  const bookedBuyerKeys = new Set<string>();
  const soldShippedTokens = new Set<string>();
  const soldModelYearTokens = new Set<string>();
  const vacantModelYearTokens = new Set<string>();
  let anyBookedShippingLegacy = false;
  for (const f of Array.from(staffFilters)) {
    if (f === STAFF_FILTER_BOOKED_SHIPPING) {
      anyBookedShippingLegacy = true;
      continue;
    }
    const sk = bookedShipKeyFromFilterToken(f);
    if (sk !== null) {
      bookedShipKeys.add(sk);
      continue;
    }
    const bk = bookedBuyerKeyFromFilterToken(f);
    if (bk !== null) {
      bookedBuyerKeys.add(bk);
      continue;
    }
    if (isSoldShippedStaffFilter(f)) {
      soldShippedTokens.add(f);
      continue;
    }
    if (isSoldModelYearStaffFilter(f)) {
      soldModelYearTokens.add(f);
      continue;
    }
    if (isVacantSaleModelYearStaffFilter(f)) {
      vacantModelYearTokens.add(f);
      continue;
    }
    itemStaffFilters.add(f);
  }
  return {
    itemStaffFilters,
    bookedShipKeys,
    bookedBuyerKeys,
    soldShippedTokens,
    soldModelYearTokens,
    vacantModelYearTokens,
    anyBookedShippingLegacy,
  };
}

/** พนักงานหลายชิป — OR ภายในชุด · ว่าง = ไม่จำกัด */
function itemMatchesStaffFilters(assignee: string | undefined | null, staffFilters: Set<string>): boolean {
  if (staffFilters.size === 0) return true;
  for (const f of Array.from(staffFilters)) {
    if (itemMatchesStaffFilter(assignee, f)) return true;
  }
  return false;
}

/** สถานะรายการหลายชิป — OR · ว่าง = ไม่จำกัด */
function itemMatchesToolbarStatusFilters(
  item: Pick<OrderItem, "status" | "good" | "dueDate">,
  statusFilters: Set<ItemStatusFilterValue | typeof ITEM_STATUS_DUE_TODAY>,
  dueTodayChip: ItemStatusPoliciesNormalized["dueToday"]
): boolean {
  if (statusFilters.size === 0) return true;
  for (const f of Array.from(statusFilters)) {
    if (itemMatchesToolbarStatusFilter(item, f, dueTodayChip)) return true;
  }
  return false;
}

function itemMatchesToolbarLineFiltersMulti(
  item: Pick<OrderItem, "status" | "good" | "dueDate" | "assignee">,
  staffFilters: Set<string>,
  statusFilters: Set<ItemStatusFilterValue | typeof ITEM_STATUS_DUE_TODAY>,
  dueTodayChip: ItemStatusPoliciesNormalized["dueToday"]
): boolean {
  return itemMatchesStaffFilters(item.assignee, staffFilters) && itemMatchesToolbarStatusFilters(item, statusFilters, dueTodayChip);
}

function orderMatchesToolbarFilters(
  order: Order,
  staffFilters: Set<string>,
  statusFilters: Set<ItemStatusFilterValue | typeof ITEM_STATUS_DUE_TODAY>,
  dueTodayChip: ItemStatusPoliciesNormalized["dueToday"]
): boolean {
  const {
    itemStaffFilters,
    bookedShipKeys,
    bookedBuyerKeys,
    soldShippedTokens,
    soldModelYearTokens,
    vacantModelYearTokens,
    anyBookedShippingLegacy,
  } = splitStaffFilters(staffFilters);
  if (anyBookedShippingLegacy || bookedShipKeys.size > 0) {
    if (order.saleStatus !== "รอส่ง") return false;
    const shipK = shipGroupKey(order.ship);
    if (bookedShipKeys.size > 0) {
      if (!bookedShipKeys.has(shipK)) return false;
    } else if (anyBookedShippingLegacy) {
      if (!order.ship.trim()) return false;
    }
  }
  if (bookedBuyerKeys.size > 0) {
    if (order.saleStatus !== "จอง") return false;
    const buyerK = buyerGroupKey(order.buyer);
    if (!bookedBuyerKeys.has(buyerK)) return false;
  }
  if (soldShippedTokens.size > 0) {
    if (!orderMatchesSoldShippedStaffDim(order, soldShippedTokens)) return false;
  }
  if (soldModelYearTokens.size > 0) {
    if (!orderMatchesSoldModelYearStaffDim(order, soldModelYearTokens)) return false;
  }
  if (vacantModelYearTokens.size > 0) {
    if (!orderMatchesVacantSaleModelYearStaffDim(order, vacantModelYearTokens)) return false;
  }
  const useLineScope = itemStaffFilters.size > 0 || statusFilters.size > 0;
  if (!useLineScope) return true;
  if (order.items.length === 0) return itemStaffFilters.size === 0;
  return order.items.some((item) => itemMatchesToolbarLineFiltersMulti(item, itemStaffFilters, statusFilters, dueTodayChip));
}

function firstNumber(raw: string): string {
  const m = raw.match(/[0-9][0-9,]*(\.[0-9]+)?/);
  return m ? m[0] : "-";
}

function formatUsd(raw: string): string {
  const text = raw.trim();
  if (!text) return "-";
  if (text.includes("$") && text.includes(",")) return text;
  const numeric = Number(text.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(numeric)) return text;
  return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(numeric)}`;
}

function buildLineShareMessage(order: Order, shareItems: OrderItem[], cardUrl: string, norms: ItemStatusPoliciesNormalized): string {
  const carLine = carHeadlineForShare(order.fullPlate, order.car);
  const headerLines: string[] = [];
  headerLines.push(`🚗 ${carLine}`);
  const chassis = String(order.chassis ?? "").trim();
  if (chassis) headerLines.push(`🔖 เลขถัง · ${chassis}`);
  headerLines.push(`📌 Sale · ${order.sale} · ${order.saleStatus}`);
  headerLines.push(`👤 ลูกค้า · ${order.buyer}`);
  const shipT = order.ship?.trim() ?? "";
  if (shipT) headerLines.push(`🚢 รอบเรือ · ${shipT}`);
  const sp = String(order.salePrice ?? "").trim();
  if (sp && sp !== "-") headerLines.push(`💵 ราคาขาย · ${formatUsd(sp)}`);

  const header = headerLines.join("\n");
  const sorted = sortOrderItemsForShare(shareItems);
  const baseLines = sorted.map((it) => orderItemShareLine(it, norms));
  const cardUrlT = cardUrl.trim();
  const workLinkT = String(order.link ?? "").trim();
  const linkBlock = cardUrlT
    ? `\n────────\n🔗 เปิดการ์ดในแอป\n${cardUrlT}`
    : workLinkT && workLinkT !== "#"
      ? `\n────────\n🔗 ลิงก์งาน\n${workLinkT}`
      : "";

  let lines = [...baseLines];
  const makeBody = (cur: string[]) => {
    if (cur.length === 0) return `\n────────\n📋 รายการงาน\nยังไม่มี`;
    const omitted = baseLines.length - cur.length;
    if (omitted > 0) {
      return `\n────────\n📋 รายการงาน (${sorted.length}) · แสดง ${cur.length} รายการ\n${cur.join("\n")}\n… และอีก ${omitted} รายการ (ดูครบในแอป)`;
    }
    return `\n────────\n📋 รายการงาน (${sorted.length})\n${cur.join("\n")}`;
  };

  let body = makeBody(lines);
  let msg = header + body + linkBlock;
  while (msg.length > LINE_SHARE_MAX_CHARS && lines.length > 1) {
    lines = lines.slice(0, -1);
    body = makeBody(lines);
    msg = header + body + linkBlock;
  }
  if (msg.length > LINE_SHARE_MAX_CHARS) {
    msg = `${msg.slice(0, LINE_SHARE_MAX_CHARS - 24).trimEnd()}\n…ตัดข้อความ`;
  }
  return msg;
}

function normalizeDocumentLink(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (urlMatch?.[0]) return urlMatch[0];
  const flowAccountMatch = text.match(/(?:www\.)?share\.flowaccount\.com\/[^\s]+/i);
  if (flowAccountMatch?.[0]) return `https://${flowAccountMatch[0].replace(/^https?:\/\//i, "")}`;
  return null;
}

function shipGroupKey(ship: string): string {
  return ship.trim().toLowerCase();
}

function bookedShipFilterTokenFromKey(shipKey: string): string {
  return `${STAFF_FILTER_BOOKED_SHIP_PREFIX}${shipKey}`;
}

function bookedShipKeyFromFilterToken(f: string): string | null {
  if (!f.startsWith(STAFF_FILTER_BOOKED_SHIP_PREFIX)) return null;
  return f.slice(STAFF_FILTER_BOOKED_SHIP_PREFIX.length);
}

function isBookedShipStaffFilter(f: string): boolean {
  return f.startsWith(STAFF_FILTER_BOOKED_SHIP_PREFIX) || f === STAFF_FILTER_BOOKED_SHIPPING;
}

function buyerGroupKey(buyer: string): string {
  return buyer.trim().toLowerCase();
}

function bookedBuyerFilterTokenFromKey(buyerKey: string): string {
  return `${STAFF_FILTER_BOOKED_BUYER_PREFIX}${buyerKey}`;
}

function bookedBuyerKeyFromFilterToken(f: string): string | null {
  if (!f.startsWith(STAFF_FILTER_BOOKED_BUYER_PREFIX)) return null;
  return f.slice(STAFF_FILTER_BOOKED_BUYER_PREFIX.length);
}

function isBookedBuyerStaffFilter(f: string): boolean {
  return f.startsWith(STAFF_FILTER_BOOKED_BUYER_PREFIX);
}

function soldShippedLineGroupKey(line: string): string {
  return line.trim().toLowerCase();
}

function soldShippedLineTokenFromKey(key: string): string {
  return `${STAFF_FILTER_SOLD_SHIPPED_PREFIX}${key}`;
}

function soldShippedLineKeyFromFilterToken(f: string): string | null {
  if (!f.startsWith(STAFF_FILTER_SOLD_SHIPPED_PREFIX)) return null;
  return f.slice(STAFF_FILTER_SOLD_SHIPPED_PREFIX.length);
}

function isSoldShippedStaffFilter(f: string): boolean {
  return f === STAFF_FILTER_SOLD_SHIPPED_EMPTY || f.startsWith(STAFF_FILTER_SOLD_SHIPPED_PREFIX);
}

function soldModelYearGroupKey(my: string): string {
  return my.trim().toLowerCase();
}

function soldModelYearTokenFromKey(key: string): string {
  return `${STAFF_FILTER_SOLD_MODEL_YEAR_PREFIX}${key}`;
}

function soldModelYearKeyFromFilterToken(f: string): string | null {
  if (!f.startsWith(STAFF_FILTER_SOLD_MODEL_YEAR_PREFIX)) return null;
  return f.slice(STAFF_FILTER_SOLD_MODEL_YEAR_PREFIX.length);
}

function isSoldModelYearStaffFilter(f: string): boolean {
  return f === STAFF_FILTER_SOLD_MODEL_YEAR_EMPTY || f.startsWith(STAFF_FILTER_SOLD_MODEL_YEAR_PREFIX);
}

function stripSoldShippedStaffFilters(prev: Set<string>): Set<string> {
  const next = new Set(prev);
  for (const f of Array.from(next)) {
    if (isSoldShippedStaffFilter(f)) next.delete(f);
  }
  return next;
}

function stripSoldModelYearStaffFilters(prev: Set<string>): Set<string> {
  const next = new Set(prev);
  for (const f of Array.from(next)) {
    if (isSoldModelYearStaffFilter(f)) next.delete(f);
  }
  return next;
}

/** OR ภายในมิติเดียว — ส่งแล้ว + ชุดชิป shipped */
function orderMatchesSoldShippedStaffDim(order: Order, tokens: Set<string>): boolean {
  if (order.saleStatus !== "ส่งแล้ว") return false;
  if (tokens.size === 0) return true;
  const raw = String(order.shipped ?? "").trim();
  const gk = soldShippedLineGroupKey(raw);
  let ok = false;
  if (tokens.has(STAFF_FILTER_SOLD_SHIPPED_EMPTY) && !raw) ok = true;
  for (const t of Array.from(tokens)) {
    const k = soldShippedLineKeyFromFilterToken(t);
    if (k !== null && raw && k === gk) ok = true;
  }
  return ok;
}

function orderMatchesSoldModelYearStaffDim(order: Order, tokens: Set<string>): boolean {
  if (order.saleStatus !== "ส่งแล้ว") return false;
  if (tokens.size === 0) return true;
  const rawMy = String(order.modelYear ?? "").trim();
  const gk = soldModelYearGroupKey(rawMy);
  let ok = false;
  if (tokens.has(STAFF_FILTER_SOLD_MODEL_YEAR_EMPTY) && !rawMy) ok = true;
  for (const t of Array.from(tokens)) {
    const k = soldModelYearKeyFromFilterToken(t);
    if (k !== null && rawMy && k === gk) ok = true;
  }
  return ok;
}

function vacantSaleModelYearTokenFromKey(key: string): string {
  return `${STAFF_FILTER_VACANT_MODEL_YEAR_PREFIX}${key}`;
}

function vacantSaleModelYearKeyFromFilterToken(f: string): string | null {
  if (!f.startsWith(STAFF_FILTER_VACANT_MODEL_YEAR_PREFIX)) return null;
  return f.slice(STAFF_FILTER_VACANT_MODEL_YEAR_PREFIX.length);
}

function isVacantSaleModelYearStaffFilter(f: string): boolean {
  return f === STAFF_FILTER_VACANT_MODEL_YEAR_EMPTY || f.startsWith(STAFF_FILTER_VACANT_MODEL_YEAR_PREFIX);
}

function stripVacantSaleModelYearStaffFilters(prev: Set<string>): Set<string> {
  const next = new Set(prev);
  for (const f of Array.from(next)) {
    if (isVacantSaleModelYearStaffFilter(f)) next.delete(f);
  }
  return next;
}

/** OR ภายในมิติ — สถานะขาย ว่าง + model year */
function orderMatchesVacantSaleModelYearStaffDim(order: Order, tokens: Set<string>): boolean {
  if (order.saleStatus !== "ว่าง") return false;
  if (tokens.size === 0) return true;
  const rawMy = String(order.modelYear ?? "").trim();
  const gk = soldModelYearGroupKey(rawMy);
  let ok = false;
  if (tokens.has(STAFF_FILTER_VACANT_MODEL_YEAR_EMPTY) && !rawMy) ok = true;
  for (const t of Array.from(tokens)) {
    const k = vacantSaleModelYearKeyFromFilterToken(t);
    if (k !== null && rawMy && k === gk) ok = true;
  }
  return ok;
}

function modelYearSortValue(value: string): number {
  const text = value.trim();
  if (!text) return 0;
  const y4 = text.match(/\b(19|20)\d{2}\b/);
  if (y4) return Number(y4[0]);
  const y2 = text.match(/\b\d{2}\b/);
  if (y2) {
    const yy = Number(y2[0]);
    if (!Number.isFinite(yy)) return 0;
    return yy >= 80 ? 1900 + yy : 2000 + yy;
  }
  return 0;
}

function normalizeItemStatus(value: string): ItemStatusValue {
  const text = value.trim();
  if (!text) return "เช็ค";
  if (text === "requested") return "เช็ค";
  if (text === "ordered") return "สั่ง";
  if (text === "ready") return "มี";
  if (text === "received") return "มา";
  if (text === "deposit_store" || text === "ฝากสโตร์" || text === "ฝากสโสร์") return "ฝากสโตร์";
  if (
    text === "deposit_in_car" ||
    text === "in_car_storage" ||
    text === "ฝากรถ" ||
    text === "ฝากกับรถ"
  ) {
    return "ฝากกับรถ";
  }
  if (text === "deposit" || text === "stored" || text === "ฝาก") return "เช็ค";
  if (text === "done" || text === "completed") return "จบ";
  if (ITEM_STATUSES.includes(text as ItemStatusValue)) return text as ItemStatusValue;
  return "เช็ค";
}

function normalizeAssignee(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ตัดช่วงท้าย spec เมื่อมีคำ (ยาวพอ) ซ้ำเป็นบล็อกที่สอง — เช่น … FORTUNER … Dec15 FORTUNER … 15 */
function trimDuplicateTrailingModelWordRun(spec: string): string {
  const s = spec.trim();
  const re = /\b([A-Z][A-Za-z0-9]{5,})\b/g;
  const indicesBy = new Map<string, number[]>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const word = m[1].toUpperCase();
    const arr = indicesBy.get(word) ?? [];
    arr.push(m.index);
    indicesBy.set(word, arr);
  }
  let cutFrom = s.length;
  indicesBy.forEach((arr) => {
    if (arr.length < 2) return;
    const first = arr[0];
    const lastStart = arr[arr.length - 1];
    if (lastStart - first < 16) return;
    cutFrom = Math.min(cutFrom, lastStart);
  });
  return cutFrom < s.length ? s.slice(0, cutFrom).trimEnd() : s;
}

/** ตัดปีท้าย spec ที่ซ้ำกับ model_year/c_year (เช่น … AT SUV 15) — ไม่แตะคำแบบ Dec15 เพราะต้องมีช่องว่างนำหน้าปี */
function stripTrailingModelYearFromSpec(spec: string, modelYearRaw: string): string {
  let s = spec.trim();
  const raw = modelYearRaw.trim();
  if (!s || !raw) return s;
  const tokens = new Set<string>([raw]);
  const m4 = raw.match(/\b(19|20)(\d{2})\b/);
  if (m4) {
    tokens.add(m4[0]);
    tokens.add(m4[2]);
  } else if (/^\d{2}$/.test(raw)) {
    tokens.add(raw);
  }
  for (const t of Array.from(tokens).sort((a, b) => b.length - a.length)) {
    if (!t) continue;
    const spaced = new RegExp(`\\s${escapeRegExp(t)}$`, "i");
    if (spaced.test(s)) {
      s = s.replace(spaced, "").trimEnd();
      break;
    }
  }
  return s;
}

function parseUpdateMessage(message: string | null | undefined): {
  actionType: string;
  oldValue: string;
  newValue: string;
  note: string;
  updatedBy: string;
} {
  const text = String(message ?? "").trim();
  const actionMatch = text.match(/^\[([^\]]+)\]/);
  const actionType = actionMatch?.[1] ?? "unknown";
  const oldMatch = text.match(/(?:^|\s)\bold=(.*?)(?:\s\|\s(?:new=|note=|by=)|$)/);
  const newMatch = text.match(/(?:^|\s)\bnew=(.*?)(?:\s\|\s(?:note=|by=)|$)/);
  const noteMatch = text.match(/(?:^|\s)\bnote=(.*?)(?:\s\|\s(?:by=)|$)/);
  const byMatch = text.match(/(?:^|\s)\bby=(.*)$/);
  return {
    actionType,
    oldValue: (oldMatch?.[1] ?? "-").trim(),
    newValue: (newMatch?.[1] ?? "-").trim(),
    note: (noteMatch?.[1] ?? "").trim(),
    updatedBy: (byMatch?.[1] ?? "").trim(),
  };
}

function toOrderFromCar(
  car: Car,
  index: number,
  orderItemsByCar: NonNullable<MobileOrderTrackingHomeProps["orderItemsByCar"]>,
  orderUpdatesByCar: NonNullable<MobileOrderTrackingHomeProps["orderUpdatesByCar"]>
): Order {
  const row = car as Car & {
    total_cost?: string | number | null;
    sale_price_usd?: string | number | null;
    repair_cost?: string | number | null;
    part_accessories?: string | number | null;
    repair_details?: string | number | null;
    doc_fee?: string | number | null;
  };
  const sale = (car.sale_support ?? "").trim() || "ALL";
  const shipped = (car.shipped ?? "").trim();
  /** Header badge / ship line: mockup → `cars.booked_shipping` only (not `shipped`) */
  const bookedShipping = (car.booked_shipping ?? "").trim();
  const buyer = (car.buyer ?? "").trim() || "-";
  const totalCostRaw = String(row.total_cost ?? "").trim();
  const buyPriceRaw = String(car.buy_price ?? "").trim() || "0";
  const expenseRaw = String(row.repair_cost ?? "").trim() || "0";
  const repairDetailsRaw = String(row.repair_details ?? "").trim();
  const partAccessoriesRaw = String(row.part_accessories ?? "").trim();
  const partAccessoriesLink = normalizeDocumentLink(partAccessoriesRaw);
  const docFeeRaw = String(row.doc_fee ?? "").trim();
  const documentDetail = [String(car.document_status ?? "").trim(), String(car.initial_document ?? "").trim(), docFeeRaw]
    .filter(Boolean)
    .join(" · ");
  const costLine =
    totalCostRaw || `${buyPriceRaw}(Total Cost) = ${buyPriceRaw}(Car Price) + ${expenseRaw}(Expense)`;
  /** Primary cost text for card: raw total_cost / buy_price line (DB source of truth on `cars`) */
  const costDetailResolved = totalCostRaw || costLine;
  const hasShipped = Boolean(shipped);
  const hasBookedShipping = Boolean(bookedShipping);
  const hasBuyer = Boolean((car.buyer ?? "").trim());
  // Order Tracking status rules:
  // ส่งแล้ว = shipped มีข้อมูล
  // รอส่ง = booked_shipping มีข้อมูล
  // จอง = buyer มีข้อมูล แต่ shipped/booked_shipping ว่าง
  // ว่าง = ไม่มีข้อมูลทั้ง buyer/shipped/booked_shipping
  const saleStatus: SaleStatusValue = hasShipped
    ? "ส่งแล้ว"
    : hasBookedShipping
      ? "รอส่ง"
      : hasBuyer
        ? "จอง"
        : "ว่าง";
  const rowId = String(car.row_id ?? "").trim();
  const chassisFallback = String(car.chassis_number ?? "").trim();
  const itemKeyByRowId = `row:${rowId}`;
  const itemKeyByCarId = `id:${String(car.id ?? "").trim()}`;
  const sourceItems = [...(orderItemsByCar[itemKeyByRowId] ?? []), ...(orderItemsByCar[itemKeyByCarId] ?? [])];
  const sourceUpdates = [...(orderUpdatesByCar[itemKeyByRowId] ?? []), ...(orderUpdatesByCar[itemKeyByCarId] ?? [])];
  const seen = new Set<string>();
  const items: OrderItem[] = [];
  for (const item of sourceItems) {
    const status = normalizeItemStatus(item.status);
    const assignee = normalizeAssignee(item.assignee_staff);
    const dbId = String((item as { id?: unknown }).id ?? "").trim();
    /** อย่าตัดหมายเหตุ/แถวต่างข้ามเมื่อมีหลาย order_items เหมือนชื่อ (คีย์เดิมทำให้เหลือแถวเดียว) */
    const key = dbId ? `id:${dbId}` : `${item.label}__${status}__${assignee}__${item.outside_supplier ?? ""}__${item.outside_eta_date ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: String((item as { id?: unknown }).id ?? "").trim() || null,
      orderTaskId: String((item as { order_task_id?: unknown }).order_task_id ?? "").trim() || null,
      name: item.label,
      nameEn: String((item as { label_en?: unknown }).label_en ?? "").trim() || undefined,
      status,
      assignee,
      /** fetchOrderItemsByCars รวม due_date + outside_eta_date, note + outside_note แล้ว */
      dueDate: item.due_date?.trim() ? item.due_date.trim().slice(0, 10) : undefined,
      clockStartYmd: (() => {
        const raw = String((item as { clock_start_ymd?: unknown }).clock_start_ymd ?? "").trim().slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
      })(),
      statusChangedAtYmd: statusChangedAtYmdFromDbIso(String((item as { status_changed_at?: unknown }).status_changed_at ?? "").trim()),
      note: item.note?.trim() || undefined,
      noteEn: String((item as { note_en?: unknown }).note_en ?? "").trim() || undefined,
      good: DONE_SET.has(status),
      supplier: item.outside_supplier ?? undefined,
      eta: item.outside_eta_date ?? undefined,
      price: item.outside_price == null ? undefined : String(item.outside_price),
    });
  }

  const updatesDedup = new Set<string>();
  const updates = sourceUpdates
    .map((rowUpdate) => {
      const parsed = parseUpdateMessage(String(rowUpdate.message ?? ""));
      return {
        id: String(rowUpdate.id ?? "").trim() || null,
        actionType: parsed.actionType,
        oldValue: parsed.oldValue,
        newValue: parsed.newValue,
        note: parsed.note,
        updatedBy: parsed.updatedBy || String(rowUpdate.role ?? "").trim() || "-",
        createdAt: String(rowUpdate.created_at ?? "").trim() || "-",
      };
    })
    .filter((u) => {
      const key = `${u.id ?? ""}|${u.actionType}|${u.createdAt}|${u.oldValue}|${u.newValue}`;
      if (updatesDedup.has(key)) return false;
      updatesDedup.add(key);
      return true;
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const modelYear = String(car.model_year ?? car.c_year ?? "").trim();
  const specRaw = (car.spec ?? "").trim() || `${car.brand ?? ""} ${car.model ?? ""}`.trim() || "Unknown Spec";
  const carHeading = stripTrailingModelYearFromSpec(trimDuplicateTrailingModelWordRun(specRaw), modelYear);

  return {
    id: `OT-${rowId || car.id || chassisFallback || index + 1}`,
    carRowId: rowId || null,
    carId: Number.isFinite(Number(car.id)) ? Number(car.id) : null,
    sale: sale as SaleValue,
    modelYear,
    saleStatus,
    shipped: shipped || "",
    ship: bookedShipping || "ว่าง",
    link: "#",
    fullPlate: String(car.plate_number ?? "").trim() || "-",
    plate: String(car.plate_number ?? "").replace(/\D/g, ""),
    car: carHeading,
    chassis: String(car.chassis_number ?? "").trim() || "-",
    buyer,
    salePrice: String(row.sale_price_usd ?? "-"),
    cost: firstNumber(totalCostRaw),
    costBreakdown: costLine,
    costDetail: costDetailResolved,
    expense: expenseRaw,
    documentDetail,
    repairDetails: repairDetailsRaw,
    repairDetail: repairDetailsRaw,
    partAccessoriesRaw,
    photo: String(car.picture ?? "").trim() || "#",
    expensePdf: partAccessoriesLink,
    updates,
    items,
  };
}

type OrderItemRow = OrderItem & { uid: string };

/** บรรทัดหัวข้อย่อยในแผงรูปตามรายการ — โหมด EN ใช้ name_en ถ้ามี */
function formatTamRoopSheetItemSubtitle(item: OrderItemRow | null | undefined, uiLang: UiLang): string {
  if (!item) return "—";
  const th = String(item.name ?? "").trim();
  if (uiLang === "en") {
    const en = stripEnglishPhotoRefMarkers(String(item.nameEn ?? "").trim()).trim();
    return en || th || "—";
  }
  return th || "—";
}

/** ซิงก์ขึ้นแม่เพื่อนับชิปพนักงาน / สถานะรายการ — ไม่รวม uid */
function orderItemRowsToLiveOrderItems(rows: OrderItemRow[]): OrderItem[] {
  return rows.map((row) => ({
    id: row.id,
    orderTaskId: row.orderTaskId,
    name: row.name,
    nameEn: row.nameEn,
    status: row.status,
    assignee: row.assignee,
    dueDate: row.dueDate,
    clockStartYmd: row.clockStartYmd,
    statusChangedAtYmd: row.statusChangedAtYmd,
    note: row.note,
    noteEn: row.noteEn,
    good: row.good,
    supplier: row.supplier,
    eta: row.eta,
    price: row.price,
    overdue: row.overdue,
  }));
}

/** สรุปเฉพาะฟิลด์ที่มีผลต่อชิปแถบเครื่องมือ — ลด setState ซ้ำ */
function orderItemsLiveToolbarSignature(items: OrderItem[]): string {
  return `${items.length}\x1d${items
    .map((i) =>
      [
        String(i.id ?? ""),
        i.status,
        String(i.assignee ?? "").trim(),
        String(i.dueDate ?? "").slice(0, 10),
        i.good ? "1" : "0",
        String(i.clockStartYmd ?? "").slice(0, 10),
        String(i.statusChangedAtYmd ?? "").slice(0, 10),
        String(i.name ?? "").trim(),
      ].join("\x1f")
    )
    .join("\x1e")}`;
}

/** ฟิลด์ที่ส่ง `/api/m/order-items/update` — ใช้ตัดสินใจว่าต้องยิง API หรือไม่ */
function orderItemPersistSignature(row: Pick<OrderItemRow, "name" | "status" | "assignee" | "dueDate" | "note">): string {
  return JSON.stringify({
    name: String(row.name ?? "").trim(),
    status: row.status,
    assignee: String(row.assignee ?? "").trim(),
    due: String(row.dueDate ?? "").trim().slice(0, 10),
    note: String(row.note ?? "").trim(),
  });
}

/** หลังบันทึก intake สำเร็จ — แทรกแถวเข้า state ในการ์ดทันที (ไม่ต้องรอ refresh) */
function mergeInlineCleanedIntoItemRows(
  existing: OrderItemRow[],
  cleaned: Pick<InlineDraftRow, "id" | "name" | "status" | "assignee" | "insertAfterUid">[],
  orderTaskIdFromApi: string | null,
  saved?: Array<{ order_item_id: string; label: string; label_en: string | null }> | null
): OrderItemRow[] {
  const taskResolved =
    String(orderTaskIdFromApi ?? "").trim() ||
    existing.map((r) => String(r.orderTaskId ?? "").trim()).find(Boolean) ||
    null;
  const next = [...existing];
  for (let i = 0; i < cleaned.length; i++) {
    const draft = cleaned[i];
    const name = draft.name.trim();
    const assignee = String(draft.assignee ?? "").trim();
    const status = draft.status;
    const pack = saved?.[i];
    const idFromApi = pack?.order_item_id ? String(pack.order_item_id).trim() : "";
    const nameEnFromApi = String(pack?.label_en ?? "").trim();
    const row: OrderItemRow = {
      id: idFromApi || null,
      orderTaskId: taskResolved,
      name,
      status,
      assignee,
      good: DONE_SET.has(status),
      uid: `intake-${draft.id}`,
      ...(nameEnFromApi ? { nameEn: nameEnFromApi } : {}),
    };
    if (draft.insertAfterUid === INLINE_INSERT_AFTER_END) {
      next.push(row);
      continue;
    }
    const idx = next.findIndex((r) => r.uid === draft.insertAfterUid);
    if (idx >= 0) next.splice(idx + 1, 0, row);
    else next.push(row);
  }
  return next;
}

/** EN ที่เก็บ [[ref]]…[[/ref]] + คำว่า see photo / ตามรูป — ลิงก์ไปแผงรูปรายการ */
function OrderItemEnglishWithPhotoRefs({
  text,
  item,
  onTamRoopClick,
  linkClass,
  rowScrollClass,
  ariaLabel,
}: {
  text: string;
  item: OrderItemRow;
  onTamRoopClick: (row: OrderItemRow) => void;
  linkClass: string;
  rowScrollClass?: string;
  ariaLabel?: string;
}) {
  const wrapScroll = (inner: React.ReactNode) =>
    rowScrollClass ? (
      <div className={rowScrollClass} role="group" aria-label={ariaLabel}>
        {inner}
      </div>
    ) : (
      <>{inner}</>
    );

  const photoBtn = (key: string, label: string, btnClass = linkClass) => (
    <button
      key={key}
      type="button"
      data-tam-roop-link=""
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onTamRoopClick(item);
      }}
      className={btnClass}
      title="Upload/view photos for this item"
    >
      {label}
    </button>
  );

  const markerSegs = parseEnglishPhotoRefMarkers(text);
  const hasMarkers = markerSegs.some((s) => s.kind === "photo");

  const legacySplit = (chunk: string, keyPrefix: string) => {
    const parts = chunk.split(ORDER_ITEM_TAM_ROOP_TOKEN_REGEX);
    if (parts.length === 1) {
      return <span className="whitespace-pre-wrap break-words">{chunk}</span>;
    }
    return parts.map((part, i) => (
      <Fragment key={`${keyPrefix}-${i}`}>
        {i % 2 === 0 ? (
          <span className="whitespace-pre-wrap break-words">{part}</span>
        ) : (
          photoBtn(`${keyPrefix}-leg-${i}`, ORDER_ITEM_REF_PIC_EN)
        )}
      </Fragment>
    ));
  };

  if (hasMarkers) {
    return wrapScroll(
      <>
        {markerSegs.map((seg, i) =>
          seg.kind === "photo" ? (
            photoBtn(`mk-${i}`, seg.label)
          ) : (
            <Fragment key={`tx-${i}`}>{legacySplit(seg.text, `tx-${i}`)}</Fragment>
          )
        )}
      </>
    );
  }

  const enParts = text.split(ORDER_ITEM_TAM_ROOP_TOKEN_REGEX);
  const hasPhotoTokenInTranslation = enParts.length > 1;

  if (hasPhotoTokenInTranslation) {
    return wrapScroll(
      <>
        {enParts.map((part, i) => (
          <Fragment key={`en-${i}`}>
            {i % 2 === 0 ? (
              <span className="whitespace-pre-wrap break-words">{part}</span>
            ) : (
              photoBtn(`split-${i}`, ORDER_ITEM_REF_PIC_EN)
            )}
          </Fragment>
        ))}
      </>
    );
  }

  /** ชื่อ/note แปลแล้ว — มีลิงก์รูปเฉพาะเมื่อข้อความมี ref / คำว่า ตามรูป・ตามภาพ・see photo … (ไม่แปะ see photo ท้ายเมื่อไม่เกี่ยว) */
  return wrapScroll(<span className="whitespace-pre-wrap break-words">{text}</span>);
}

function OrderItemNameFieldWithTamRoop({
  item,
  showNoteRow,
  uiLang,
  patchItem,
  flushPendingNamePersist,
  onTamRoopClick,
  onAfterNameBlur,
}: {
  item: OrderItemRow;
  showNoteRow: boolean;
  uiLang: UiLang;
  patchItem: (target: OrderItemRow, patch: Partial<OrderItem>) => void;
  flushPendingNamePersist: (uid: string) => void | Promise<void>;
  onTamRoopClick: (row: OrderItemRow) => void;
  /** หลัง blur ชื่อ — ได้ข้อความล่าสุดจากช่อง (สำหรับปิดแผงรูปเมื่อไม่มี 「ตามรูป」) */
  onAfterNameBlur?: (uid: string, nextName: string) => void;
}) {
  const name = item.name ?? "";
  const nameEn = String(item.nameEn ?? "").trim();
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasTamRoopToken = orderItemLabelContainsTamRoop(name);

  useLayoutEffect(() => {
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

  const singleInputClass = cn(
    "min-w-0 rounded-xl bg-transparent px-1.5 py-1.5 text-sm font-medium text-slate-900 outline-none focus:bg-white focus:ring-2 focus:ring-slate-300/80 sm:text-[15px]",
    showNoteRow ? "w-full flex-1 basis-0 sm:min-w-[40%]" : "flex-1 basis-0"
  );
  const previewShellClass = cn(
    "flex min-w-0 cursor-text items-baseline rounded-xl bg-transparent px-1.5 py-1.5 text-sm font-medium text-slate-900 outline-none ring-1 ring-transparent hover:bg-slate-50/80 sm:text-[15px]",
    showNoteRow ? "w-full flex-1 basis-0 sm:min-w-[40%]" : "min-w-0 flex-1 basis-0"
  );
  const rowScrollClass = showNoteRow
    ? "inline-flex max-w-full min-w-0 flex-1 flex-nowrap items-baseline gap-0 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch]"
    : "inline-flex max-w-full min-w-0 flex-nowrap items-baseline gap-0";
  const linkClass =
    "inline shrink-0 cursor-pointer border-0 bg-transparent p-0 align-baseline font-inherit font-medium text-sky-600 underline decoration-sky-400 decoration-2 underline-offset-2 hover:text-sky-700 touch-manipulation active:text-sky-800";

  if (!hasTamRoopToken && uiLang === "en" && nameEn && !editing) {
    return (
      <div
        className={previewShellClass}
        data-order-item-name-preview=""
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-tam-roop-link]")) return;
          setEditing(true);
        }}
      >
        <OrderItemEnglishWithPhotoRefs
          text={nameEn}
          item={item}
          onTamRoopClick={onTamRoopClick}
          linkClass={linkClass}
          rowScrollClass={rowScrollClass}
          ariaLabel="Task name - tap to edit"
        />
      </div>
    );
  }

  if (!hasTamRoopToken) {
    return (
      <input
        ref={inputRef}
        id={`order-item-name-${item.uid}`}
        value={name}
        onChange={(e) => patchItem(item, { name: e.target.value })}
        onBlur={() => {
          const next = String(inputRef.current?.value ?? name);
          void flushPendingNamePersist(item.uid);
          setEditing(false);
          onAfterNameBlur?.(item.uid, next);
        }}
        placeholder={uiLang === "en" ? "Task name" : "ชื่องาน"}
        className={singleInputClass}
      />
    );
  }

  if (!editing) {
    if (uiLang === "en" && nameEn) {
      return (
        <div
          className={previewShellClass}
          data-order-item-name-preview=""
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setEditing(true);
            }
          }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("[data-tam-roop-link]")) return;
            setEditing(true);
          }}
        >
          <OrderItemEnglishWithPhotoRefs
            text={nameEn}
            item={item}
            onTamRoopClick={onTamRoopClick}
            linkClass={linkClass}
            rowScrollClass={rowScrollClass}
            ariaLabel="Task name - tap to edit"
          />
        </div>
      );
    }
    const parts = name.split(ORDER_ITEM_TAM_ROOP_TOKEN_REGEX);
    return (
      <div
        className={previewShellClass}
        data-order-item-name-preview=""
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-tam-roop-link]")) return;
          setEditing(true);
        }}
      >
        <div className={rowScrollClass} role="group" aria-label={uiLang === "en" ? "Task name - tap to edit" : "ชื่องาน — แตะเพื่อแก้ไข"}>
          {parts.map((part, i) => (
            <Fragment key={`${item.uid}-tam-${i}`}>
              {i % 2 === 0 ? <span className="whitespace-pre-wrap break-words">{part}</span> : null}
              {i % 2 === 1 ? (
                <button
                  type="button"
                  data-tam-roop-link=""
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTamRoopClick(item);
                  }}
                  className={linkClass}
                  title={uiLang === "en" ? "Upload/view photos for this item" : "เพิ่มรูปและดูรูปตามรายการนี้"}
                >
                  {uiLang === "en" ? ORDER_ITEM_REF_PIC_EN : (part || ORDER_ITEM_TAM_ROOP_TOKEN)}
                </button>
              ) : null}
            </Fragment>
          ))}
        </div>
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      id={`order-item-name-${item.uid}`}
      value={name}
      onChange={(e) => patchItem(item, { name: e.target.value })}
      onBlur={() => {
        const next = String(inputRef.current?.value ?? name);
        void flushPendingNamePersist(item.uid);
        setEditing(false);
        onAfterNameBlur?.(item.uid, next);
      }}
      placeholder={uiLang === "en" ? "Task name" : "ชื่องาน"}
      className={singleInputClass}
    />
  );
}

function OrderItemNoteField({
  item,
  uiLang,
  patchItem,
  flushPendingNotePersist,
  onTamRoopClick,
  onTranslateCard,
  translateCardBusy,
  translateCardDisabled,
}: {
  item: OrderItemRow;
  uiLang: UiLang;
  patchItem: (target: OrderItemRow, patch: Partial<OrderItem>) => void;
  flushPendingNotePersist: (uid: string) => void | Promise<void>;
  onTamRoopClick: (row: OrderItemRow) => void;
  /** ปุ่มเดียวกับแถบด้านบนการ์ด — วางใกล้หมายเหตุเพราะแถบบนถูก scroll ตัดบ่อย */
  onTranslateCard?: () => void;
  translateCardBusy?: boolean;
  translateCardDisabled?: boolean;
}) {
  const thaiNote = item.note ?? "";
  const noteEn = String(item.noteEn ?? "").trim();
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
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

  const previewShellClass =
    "flex min-w-0 cursor-text items-start rounded-lg bg-white px-2 py-1.5 text-xs font-medium text-slate-800 outline-none ring-1 ring-slate-200/80 hover:bg-slate-50/80";
  const inputClass =
    "min-h-[2.25rem] min-w-0 flex-1 rounded-lg bg-white px-2 py-1.5 text-xs font-medium text-slate-800 outline-none ring-1 ring-slate-200/80 placeholder:text-slate-400 sm:min-w-[12rem]";
  const noteLinkClass =
    "inline shrink-0 cursor-pointer border-0 bg-transparent p-0 align-baseline font-inherit font-medium text-sky-600 underline decoration-sky-400 decoration-2 underline-offset-2 hover:text-sky-700 touch-manipulation active:text-sky-800 text-xs";

  if (uiLang === "en" && noteEn && !editing) {
    return (
      <div
        className={previewShellClass}
        tabIndex={0}
        role="group"
        aria-label="Note — tap to edit Thai text"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-tam-roop-link]")) return;
          setEditing(true);
        }}
      >
        <OrderItemEnglishWithPhotoRefs
          text={noteEn}
          item={item}
          onTamRoopClick={onTamRoopClick}
          linkClass={noteLinkClass}
        />
      </div>
    );
  }

  const thaiInNote = /[\u0E00-\u0E7F]/.test(thaiNote);
  if (uiLang === "en" && !noteEn && thaiInNote && !editing) {
    const busy = Boolean(translateCardBusy);
    const tOff = Boolean(translateCardDisabled);
    return (
      <div className="min-w-0 space-y-1.5">
        <input
          ref={inputRef}
          value={thaiNote}
          onChange={(e) => patchItem(item, { note: e.target.value })}
          onBlur={() => {
            void flushPendingNotePersist(item.uid);
            setEditing(false);
          }}
          onFocus={() => setEditing(true)}
          placeholder="Type…"
          className={inputClass}
        />
        <div className="flex flex-wrap items-center gap-2 px-0.5">
          <button
            type="button"
            onClick={() => onTranslateCard?.()}
            disabled={busy || tOff || !onTranslateCard}
            title={uiLang === "en" ? "Translate item names, notes, and cost summary on this card" : undefined}
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold touch-manipulation",
              busy || tOff || !onTranslateCard
                ? "cursor-not-allowed bg-slate-200 text-slate-500"
                : "bg-blue-100 text-blue-900 ring-1 ring-blue-200/80 active:bg-blue-200"
            )}
          >
            {busy ? "Translating…" : "Translate EN"}
          </button>
          <p className="min-w-0 flex-1 text-[10px] leading-snug text-amber-800">
            English fills here after this runs, or after you blur the note to save. Same action as the{" "}
            <span className="font-semibold">Translate EN</span> pill in the scroll bar above the task list.
          </p>
        </div>
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      value={thaiNote}
      onChange={(e) => patchItem(item, { note: e.target.value })}
      onBlur={() => {
        void flushPendingNotePersist(item.uid);
        setEditing(false);
      }}
      onFocus={() => setEditing(true)}
      placeholder={uiLang === "en" ? "Type…" : "พิมพ์…"}
      className={inputClass}
    />
  );
}

/** ข้อความสรุปต้นทุน/ซ่อม/เอกสาร — ตรวจว่ามีอักษรไทยสำหรับขั้นแปล */
function orderCarSummaryFieldsHaveThai(order: Order): boolean {
  const cost = String(order.costDetail || order.costBreakdown || order.cost || "").trim();
  const repair = String(order.repairDetail || order.repairDetails || "").trim();
  const doc = String(order.documentDetail || "").trim();
  return /[\u0E00-\u0E7F]/.test(`${cost}\n${repair}\n${doc}`);
}

function OrderCard({
  order,
  uiLang,
  staffRosterNames,
  saleAssigneesBySale,
  shareBaseUrl,
  itemStatusLabels,
  itemPoliciesNorm,
  itemStatusRosterForCard,
  toolbarStaffFilters,
  toolbarStatusFilters,
  onLiveItemsChange,
}: {
  order: Order;
  uiLang: UiLang;
  staffRosterNames: string[];
  /** เซลล์ → พนักงานรับผิดชอบ — ใช้ตั้งค่าเริ่มตอนเพิ่มงาน */
  saleAssigneesBySale: Record<string, string>;
  shareBaseUrl?: string | null;
  itemStatusLabels?: ItemStatusLabelMap;
  /** default + จาก「จัดการสถานะ」— ควบคุม due / ชิปมาวันนี้ / ฝาก / SLA */
  itemPoliciesNorm: ItemStatusPoliciesNormalized;
  itemStatusRosterForCard: ItemStatusValue[];
  /** ตัวกรองแถบเครื่องมือ — ซ่อนแถวในการ์ดที่ไม่ตรงพนักงาน/สถานะ (หลายชิปต่อแถว = OR) */
  toolbarStaffFilters: Set<string>;
  toolbarStatusFilters: Set<ItemStatusFilterValue | typeof ITEM_STATUS_DUE_TODAY>;
  /** แจ้งแม่ให้รวมรายการล่าสุดใน mappedOrders — ชิปนับอัปเดตทันที */
  onLiveItemsChange?: (orderId: string, items: OrderItem[]) => void;
}) {
  const router = useRouter();
  const pathname = usePathname() || "/m/orders";
  const [items, setItems] = useState<OrderItemRow[]>(() =>
    (order.items || []).map((item, index) => ({
      ...item,
      uid: String(item.id ?? "").trim() ? String(item.id) : `row-${order.id}-${index}-${norm(item.name)}`,
    }))
  );
  const [showAllItems, setShowAllItems] = useState(false);
  /** ขยายดูแถวที่ไม่ตรงตัวกรองพนักงาน/สถานะ (โหมดเดิมชั่วคราว) */
  const [toolbarOthersExpanded, setToolbarOthersExpanded] = useState(false);
  const [showCost, setShowCost] = useState(false);
  const [saveError, setSaveError] = useState("");
  /** คำแนะนำเมื่อแปลชื่อ EN ไม่ได้ (มีไทยในชื่อแต่ไม่ได้ label_en) */
  const [translationNotice, setTranslationNotice] = useState("");
  const [savingItemUid, setSavingItemUid] = useState<string | null>(null);
  const [showInlineIntake, setShowInlineIntake] = useState(false);
  const [inlineText, setInlineText] = useState("");
  const [inlineItems, setInlineItems] = useState<InlineDraftRow[]>([]);
  const [inlineSaving, setInlineSaving] = useState(false);
  /** บันทึกทีละแถวจากฟอร์มปัดซ้าย */
  const [inlineRowSavingId, setInlineRowSavingId] = useState<string | null>(null);
  const [inlineMessage, setInlineMessage] = useState("");
  const [inlineAiBusy, setInlineAiBusy] = useState(false);
  const [translateCardBusy, setTranslateCardBusy] = useState(false);
  /** แปลจากปุ่ม Translate EN — แสดงเมื่อ uiLang=en */
  const [carSummaryEn, setCarSummaryEn] = useState<{ cost: string; repair: string; document: string } | null>(null);
  /** โหลดแปลตอนเปิด COST (EN) */
  const [carSummaryTranslating, setCarSummaryTranslating] = useState(false);
  const carSummaryRequestInFlightRef = useRef(false);
  const carSummaryEnRef = useRef(carSummaryEn);
  carSummaryEnRef.current = carSummaryEn;
  const carSummarySourceKey = useMemo(
    () =>
      `${order.costDetail ?? ""}\x1e${order.repairDetail ?? order.repairDetails ?? ""}\x1e${order.documentDetail ?? ""}`,
    [order.costDetail, order.documentDetail, order.repairDetail, order.repairDetails]
  );
  const [inlineCompareEnabled, setInlineCompareEnabled] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [carPhotos, setCarPhotos] = useState<OrderPhotoEntry[]>([]);
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  const [photoViewerIndex, setPhotoViewerIndex] = useState(0);
  const photoViewerStripRef = useRef<HTMLDivElement | null>(null);
  const [noteOpenUid, setNoteOpenUid] = useState<string | null>(null);
  const [datePickerUid, setDatePickerUid] = useState<string | null>(null);
  const [tamRoopSheetUid, setTamRoopSheetUid] = useState<string | null>(null);
  const [tamRoopItemPhotos, setTamRoopItemPhotos] = useState<OrderPhotoEntry[]>([]);
  const [tamRoopPhotosFetchedForDbId, setTamRoopPhotosFetchedForDbId] = useState<string | null>(null);
  const [tamRoopLoadingPhotos, setTamRoopLoadingPhotos] = useState(false);
  const [tamRoopViewerOpen, setTamRoopViewerOpen] = useState(false);
  const [tamRoopViewerIndex, setTamRoopViewerIndex] = useState(0);
  const tamRoopViewerStripRef = useRef<HTMLDivElement | null>(null);
  const tamRoopOverlayRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef<OrderItemRow[]>(items);
  const noteDebounceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const nameDebounceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const rowSwipeGestureRef = useRef<{
    uid: string;
    startX: number;
    startY: number;
    base: number;
    lastOffset: number;
    startedOpen: boolean;
    phase: "pending" | "dragging";
  } | null>(null);
  const [rowSwipePx, setRowSwipePx] = useState<Record<string, number>>({});
  const rowSwipePxRef = useRef(rowSwipePx);
  rowSwipePxRef.current = rowSwipePx;
  const swipeDragRafRef = useRef<number | null>(null);

  const flushSwipeDragRaf = () => {
    if (swipeDragRafRef.current != null) {
      cancelAnimationFrame(swipeDragRafRef.current);
      swipeDragRafRef.current = null;
    }
  };
  const lastPersistedSigByUidRef = useRef<Record<string, string>>({});
  const canAttachPhotos = Boolean(String(order.carRowId ?? "").trim() || order.carId != null);

  const onLiveItemsChangeRef = useRef(onLiveItemsChange);
  onLiveItemsChangeRef.current = onLiveItemsChange;

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    setCarSummaryEn(null);
  }, [carSummarySourceKey]);

  useEffect(() => {
    const fn = onLiveItemsChangeRef.current;
    if (!fn) return;
    const t = window.setTimeout(() => {
      fn(order.id, orderItemRowsToLiveOrderItems(itemsRef.current));
    }, 80);
    return () => {
      clearTimeout(t);
    };
  }, [items, order.id]);

  useEffect(() => {
    const oid = order.id;
    return () => {
      const fn = onLiveItemsChangeRef.current;
      if (!fn) return;
      fn(oid, orderItemRowsToLiveOrderItems(itemsRef.current));
    };
  }, [order.id]);

  const toolbarFiltersSig = `${Array.from(toolbarStaffFilters).sort().join("\u0001")}\u0000${Array.from(toolbarStatusFilters).sort().join("\u0001")}`;
  useEffect(() => {
    setToolbarOthersExpanded(false);
  }, [toolbarFiltersSig]);

  useEffect(() => {
    const noteTimers = noteDebounceTimersRef.current;
    const nameTimers = nameDebounceTimersRef.current;
    return () => {
      for (const t of Object.values(noteTimers)) {
        if (t) clearTimeout(t);
      }
      for (const t of Object.values(nameTimers)) {
        if (t) clearTimeout(t);
      }
    };
  }, []);

  useLayoutEffect(() => {
    setItems((prev) => {
      const mapped = (order.items || []).map((item, index) => ({
        ...item,
        uid: String(item.id ?? "").trim() ? String(item.id) : `row-${order.id}-${index}-${norm(item.name)}`,
      }));
      /** หลัง router.refresh บางครั้งรอบโหลดไม่มี note_en/label_en (fallback select / replica ช้า) — อย่าเผา EN ที่เพิ่งแปล */
      const prevById = new Map<string, OrderItemRow>();
      const prevByUid = new Map<string, OrderItemRow>();
      for (const r of prev) {
        prevByUid.set(r.uid, r);
        const id = String(r.id ?? "").trim();
        if (id) prevById.set(id, r);
      }
      const merged = mapped.map((row) => {
        const id = String(row.id ?? "").trim();
        const old = id ? prevById.get(id) : prevByUid.get(row.uid);
        if (!old) return row;
        const serverNe = String(row.noteEn ?? "").trim();
        const serverLe = String(row.nameEn ?? "").trim();
        return {
          ...row,
          ...(!serverLe && String(old.nameEn ?? "").trim() ? { nameEn: old.nameEn } : {}),
          ...(!serverNe && String(old.noteEn ?? "").trim() ? { noteEn: old.noteEn } : {}),
        };
      });

      const nextSigs: Record<string, string> = {};
      for (const row of merged) {
        nextSigs[row.uid] = orderItemPersistSignature(row);
      }
      lastPersistedSigByUidRef.current = nextSigs;
      return merged;
    });
  }, [order.items, order.id]);

  const reloadPhotos = React.useCallback(async () => {
    if (!canAttachPhotos) {
      setCarPhotos([]);
      return;
    }
    const p = new URLSearchParams();
    if (order.carRowId) p.set("car_row_id", order.carRowId);
    if (order.carId != null) p.set("car_id", String(order.carId));
    try {
      const res = await fetch(`${ORDER_PHOTOS_LIST_API_PATH}?${p.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as {
        carPhotos?: OrderPhotoEntry[];
      };
      if (!res.ok) return;
      setCarPhotos(Array.isArray(json.carPhotos) ? json.carPhotos : []);
    } catch {
      /* ignore */
    }
  }, [canAttachPhotos, order.carId, order.carRowId]);

  useEffect(() => {
    void reloadPhotos();
  }, [reloadPhotos]);

  const uploadPhotos = async (files: FileList | null) => {
    if (!files?.length || !canAttachPhotos) return;
    setPhotoBusy(true);
    setSaveError("");
    try {
      const form = new FormData();
      form.append("target_type", "car");
      if (order.carRowId) form.append("car_row_id", order.carRowId);
      if (order.carId != null) form.append("car_id", String(order.carId));
      for (const file of Array.from(files)) form.append("files", file);
      const res = await fetch(ORDER_PHOTOS_UPLOAD_API_PATH, { method: "POST", body: form });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? res.statusText);
      await reloadPhotos();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "อัปโหลดรูปไม่สำเร็จ");
    } finally {
      setPhotoBusy(false);
    }
  };

  const deletePhoto = async (photoId: string) => {
    if (!photoId) return;
    setPhotoBusy(true);
    setSaveError("");
    try {
      const res = await fetch(ORDER_PHOTOS_DELETE_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_id: photoId }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? res.statusText);
      await reloadPhotos();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "ลบรูปไม่สำเร็จ");
    } finally {
      setPhotoBusy(false);
    }
  };

  const translateCarSummaryViaApi = React.useCallback(
    async (opts?: { panelLoading?: boolean }): Promise<boolean> => {
      const costSrc = String(order.costDetail || order.costBreakdown || order.cost || "").trim();
      const repairSrc = String(order.repairDetail || order.repairDetails || "").trim();
      const docSrc = String(order.documentDetail || "").trim();
      if (!/[\u0E00-\u0E7F]/.test(`${costSrc}\n${repairSrc}\n${docSrc}`)) return false;
      if (carSummaryRequestInFlightRef.current) return false;
      carSummaryRequestInFlightRef.current = true;
      const showPanel = opts?.panelLoading === true;
      if (showPanel) setCarSummaryTranslating(true);
      try {
        const sumRes = await fetch(ORDER_TRACKING_TRANSLATE_CAR_SUMMARY_API_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cost_detail: costSrc,
            repair_detail: repairSrc,
            document_detail: docSrc,
          }),
        });
        const sumPayload = (await sumRes.json()) as {
          ok?: boolean;
          cost_detail_en?: string;
          repair_detail_en?: string;
          document_detail_en?: string;
        };
        if (sumRes.ok && sumPayload.ok !== false) {
          setCarSummaryEn({
            cost: String(sumPayload.cost_detail_en ?? "").trim(),
            repair: String(sumPayload.repair_detail_en ?? "").trim(),
            document: String(sumPayload.document_detail_en ?? "").trim(),
          });
          return true;
        }
      } catch {
        /* ignore */
      } finally {
        carSummaryRequestInFlightRef.current = false;
        if (showPanel) setCarSummaryTranslating(false);
      }
      return false;
    },
    [
      order.costDetail,
      order.costBreakdown,
      order.cost,
      order.repairDetail,
      order.repairDetails,
      order.documentDetail,
    ]
  );

  const translateCardItemsToEnglish = async () => {
    if (translateCardBusy) return;
    if (orderTaskIdsForCard.length === 0) {
      setSaveError(
        uiLang === "en"
          ? "Cannot translate this card yet: items are not linked to an order task. Try saving a row or reloading."
          : "ยังแปลการ์ดนี้ไม่ได้: รายการยังไม่ผูก order task — ลองบันทึกแถวหรือรีเฟรชหน้า"
      );
      return;
    }
    setTranslateCardBusy(true);
    setSaveError("");
    try {
      const translatedById: Record<string, string> = {};
      const noteTranslatedById: Record<string, string> = {};
      for (const taskId of orderTaskIdsForCard) {
        const res = await fetch(ORDER_ITEMS_TRANSLATE_CARD_API_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ order_task_id: taskId }),
        });
        const payload = (await res.json()) as {
          error?: string;
          updated?: number;
          translatedById?: Record<string, string>;
          noteTranslatedById?: Record<string, string>;
        };
        if (!res.ok) throw new Error(payload.error ?? res.statusText);
        Object.assign(translatedById, payload.translatedById ?? {});
        Object.assign(noteTranslatedById, payload.noteTranslatedById ?? {});
      }
      if (Object.keys(translatedById).length > 0 || Object.keys(noteTranslatedById).length > 0) {
        setItems((prev) =>
          prev.map((row) => {
            const id = String(row.id ?? "").trim();
            const nameEn = id ? String(translatedById[id] ?? "").trim() : "";
            const noteEn = id ? String(noteTranslatedById[id] ?? "").trim() : "";
            if (!nameEn && !noteEn) return row;
            return {
              ...row,
              ...(nameEn ? { nameEn } : {}),
              ...(noteEn ? { noteEn } : {}),
            };
          })
        );
      }

      try {
        await translateCarSummaryViaApi();
      } catch {
        /* summary EN optional — item labels still updated */
      }

      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "แปลรายการไม่สำเร็จ");
    } finally {
      setTranslateCardBusy(false);
    }
  };

  const openPhotoViewer = (index: number) => {
    if (index < 0 || index >= carPhotos.length) return;
    setPhotoViewerIndex(index);
    setPhotoViewerOpen(true);
  };

  const closePhotoViewer = () => setPhotoViewerOpen(false);

  useEffect(() => {
    if (!photoViewerOpen) return;
    const el = photoViewerStripRef.current;
    if (!el) return;
    const left = photoViewerIndex * el.clientWidth;
    el.scrollTo({ left, behavior: "auto" });
  }, [photoViewerOpen, photoViewerIndex]);

  useEffect(() => {
    if (!tamRoopViewerOpen) return;
    const el = tamRoopViewerStripRef.current;
    if (!el) return;
    const left = tamRoopViewerIndex * el.clientWidth;
    el.scrollTo({ left, behavior: "auto" });
  }, [tamRoopViewerOpen, tamRoopViewerIndex]);

  const staffOptions = useMemo(() => {
    const names = new Set<string>();
    for (const n of staffRosterNames) {
      const t = String(n).trim();
      if (t && !isStaffRosterNameExcluded(t)) names.add(t);
    }
    for (const row of items) {
      const n = String(row.assignee ?? "").trim();
      if (n && !isStaffRosterNameExcluded(n)) names.add(n);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "en"));
  }, [items, staffRosterNames]);

  /** เพิ่มงาน (LINE intake): จับคู่ตามเซลล์ของรถ → ไม่มีค่อยใช้ชื่อแรกในรายชื่อพนักงาน */
  const defaultIntakeAssignee = useMemo(() => {
    const mapped = resolveSaleStaffForOrder(order.sale, saleAssigneesBySale);
    if (mapped && staffRosterNames.some((n) => n === mapped)) return mapped;
    for (const n of staffRosterNames) {
      const t = String(n).trim();
      if (t && !isStaffRosterNameExcluded(t)) return t;
    }
    return "";
  }, [order.sale, saleAssigneesBySale, staffRosterNames]);

  const { itemStaffFilters: toolbarItemStaffFilters } = useMemo(
    () => splitStaffFilters(toolbarStaffFilters),
    [toolbarStaffFilters]
  );
  const toolbarLineFilterActive =
    toolbarItemStaffFilters.size > 0 || toolbarStatusFilters.size > 0;
  const toolbarDueTodayChipPolicy = itemPoliciesNorm.dueToday;
  const itemsScoped = useMemo(() => {
    if (!toolbarLineFilterActive) return items;
    return items.filter((row) =>
      itemMatchesToolbarLineFiltersMulti(row, toolbarItemStaffFilters, toolbarStatusFilters, toolbarDueTodayChipPolicy)
    );
  }, [
    items,
    toolbarLineFilterActive,
    toolbarItemStaffFilters,
    toolbarStatusFilters,
    toolbarDueTodayChipPolicy,
  ]);

  const itemsOutsideToolbarFilter = useMemo(() => {
    if (!toolbarLineFilterActive) return [] as OrderItemRow[];
    return items.filter(
      (row) =>
        !itemMatchesToolbarLineFiltersMulti(row, toolbarItemStaffFilters, toolbarStatusFilters, toolbarDueTodayChipPolicy)
    );
  }, [
    items,
    toolbarLineFilterActive,
    toolbarItemStaffFilters,
    toolbarStatusFilters,
    toolbarDueTodayChipPolicy,
  ]);

  const suppressToolbarOthers =
    toolbarLineFilterActive && !toolbarOthersExpanded && itemsOutsideToolbarFilter.length > 0;
  const itemsEffective = suppressToolbarOthers ? itemsScoped : items;

  const { waiting, done, activeItems, hiddenDoneItems } = useMemo(() => {
    const nextWaiting: OrderItemRow[] = [];
    const nextDone: OrderItemRow[] = [];
    const nextActiveItems: OrderItemRow[] = [];
    const nextHiddenDoneItems: OrderItemRow[] = [];

    for (const item of itemsEffective) {
      if (WAITING_SET.has(item.status)) nextWaiting.push(item);
      if (item.good || DONE_SET.has(item.status)) nextDone.push(item);
      if (item.status === "จบ") nextHiddenDoneItems.push(item);
      else nextActiveItems.push(item);
    }

    return {
      waiting: nextWaiting,
      done: nextDone,
      activeItems: nextActiveItems,
      hiddenDoneItems: nextHiddenDoneItems,
    };
  }, [itemsEffective]);
  /** เลือกพนักงาน / หรือกรองสถานะเป็น「จบ」 — แสดงแถวจบในรายการหลัก ไม่ซ่อนหลังปุ่มซ่อนงานจบ */
  const showDoneRowsInMainList =
    toolbarItemStaffFilters.size > 0 || toolbarStatusFilters.has("จบ");
  /** คงลำดับแถวตามข้อมูลเดิม — ไม่เรียงตามสถานะเวลาเปลี่ยนสถานะในการ์ด */
  const compareItems =
    showDoneRowsInMainList || showAllItems ? itemsEffective : activeItems;
  const allDone = done.length >= itemsEffective.length && itemsEffective.length > 0;
  const shareCardUrl = useMemo(() => {
    const base = resolveShareAppBase(shareBaseUrl);
    return buildOrderTrackingShareOpenUrl(order.id, base);
  }, [order.id, shareBaseUrl]);
  const lineShareText = useMemo(
    () => buildLineShareMessage(order, items, shareCardUrl, itemPoliciesNorm),
    [order, items, shareCardUrl, itemPoliciesNorm]
  );
  const lineShareUrl = useMemo(
    () => `https://line.me/R/msg/text/?${encodeURIComponent(lineShareText)}`,
    [lineShareText]
  );
  const orderTaskIdsForCard = useMemo(() => {
    const ids = new Set<string>();
    for (const row of items) {
      const id = String(row.orderTaskId ?? "").trim();
      if (id) ids.add(id);
    }
    return Array.from(ids);
  }, [items]);
  const statusLabelInCard = (st: ItemStatusValue): string => {
    if (uiLang === "en") {
      return displayItemStatusLabel(st, uiLang);
    }
    const custom = String(itemStatusLabels?.[st] ?? "").trim();
    if (custom && custom !== st) return custom;
    return displayItemStatusLabel(st, uiLang);
  };
  const statusOptionsForValue = (value: ItemStatusValue): ItemStatusValue[] => {
    const base = itemStatusRosterForCard.length ? itemStatusRosterForCard : [...ITEM_STATUS_ORDER];
    return base.includes(value) ? base : [value, ...base];
  };

  const clearNoteDebounce = (uid: string) => {
    const timers = noteDebounceTimersRef.current;
    const t = timers[uid];
    if (t) clearTimeout(t);
    delete timers[uid];
  };

  const clearNameDebounce = (uid: string) => {
    const timers = nameDebounceTimersRef.current;
    const t = timers[uid];
    if (t) clearTimeout(t);
    delete timers[uid];
  };

  const closeSwipeRows = () => {
    flushSwipeDragRaf();
    rowSwipeGestureRef.current = null;
    setRowSwipePx({});
  };

  const persistItem = async (prevItem: OrderItemRow, nextItem: OrderItemRow) => {
    const sig = orderItemPersistSignature(nextItem);
    const prevSig = lastPersistedSigByUidRef.current[nextItem.uid];
    const nameTrim = String(nextItem.name ?? "").trim();
    const noteTrim = String(nextItem.note ?? "").trim();
    /** การแปล EN อยู่ที่ปุ่ม Translate EN / ภาษา UI — save อย่างเดียวไม่ยิงซ้ำถ้าข้อมูลเหมือนเดิม */
    if (prevSig !== undefined && prevSig === sig) return;
    setSavingItemUid(nextItem.uid);
    setSaveError("");
    setTranslationNotice("");
    try {
      const res = await fetch("/api/m/order-items/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          order_item_id: nextItem.id ?? null,
          order_task_id: nextItem.orderTaskId ?? null,
          car_row_id: order.carRowId,
          car_id: order.carId,
          item_name: nextItem.name,
          item_status: nextItem.status,
          assignee_staff: nextItem.assignee || null,
          due_date: nextItem.dueDate || null,
          note: nextItem.note || null,
          updated_by: "mobile-card",
          /** false = save เร็ว; ให้เรียก API แปลแยก (Translate EN / translate-card / translate-all) */
          translate: false,
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
        order_item_id?: string | null;
        order_task_id?: string | null;
        status_changed_at?: string | null;
        label_en?: string | null;
        note_en?: string | null;
        translation_status?: "no_keys" | "failed";
        note_translation_status?: "no_keys" | "failed";
      };
      if (!res.ok) throw new Error(payload.error ?? res.statusText);
      lastPersistedSigByUidRef.current[nextItem.uid] = sig;
      const todayY = todayBangkokYmd();
      const prevPolClock = itemPoliciesNorm.byStatus[prevItem.status as ItemStatusValue];
      const nextPolClock = itemPoliciesNorm.byStatus[nextItem.status as ItemStatusValue];
      const enteredStoreDepositClock =
        Boolean(nextPolClock?.storeDepositClock) && !Boolean(prevPolClock?.storeDepositClock);
      const nameEnFromServer = String(payload.label_en ?? "").trim();
      const noteEnFromServer =
        payload.note_en !== undefined
          ? payload.note_en != null && String(payload.note_en).trim()
            ? String(payload.note_en).trim()
            : undefined
          : undefined;
      const ts = payload.translation_status;
      const nts = payload.note_translation_status;
      const labelOk = Boolean(nameEnFromServer || !nameTrim || !/[\u0E00-\u0E7F]/.test(nameTrim));
      const noteOk = Boolean(noteEnFromServer || !noteTrim || !/[\u0E00-\u0E7F]/.test(noteTrim));
      if (labelOk && noteOk) {
        setTranslationNotice("");
      } else if (ts === "no_keys" || nts === "no_keys") {
        setTranslationNotice(
          uiLang === "en"
            ? "English names/notes need GEMINI_API_KEY or GROQ_API_KEY on the server (.env.local or Vercel env)."
            : "ตั้ง GEMINI_API_KEY หรือ GROQ_API_KEY บนเซิร์ฟเวอร์ (.env.local / Vercel) ถึงจะแปลชื่อและหมายเหตุเป็นภาษาอังกฤษได้"
        );
      } else if (ts === "failed" || nts === "failed") {
        setTranslationNotice(
          uiLang === "en"
            ? "Could not translate this label or note. Retry or check API quota / server logs."
            : "แปลชื่อหรือหมายเหตุไม่สำเร็จ — ลองใหม่หรือเช็คโควตา API / log เซิร์ฟเวอร์"
        );
      } else {
        setTranslationNotice("");
      }
      setItems((current) =>
        current.map((candidate) => {
          if (candidate.uid !== nextItem.uid) return candidate;
          let merged: OrderItemRow = {
            ...candidate,
            id: payload.order_item_id ?? candidate.id ?? null,
            orderTaskId: payload.order_task_id ?? candidate.orderTaskId ?? null,
            ...(nameEnFromServer ? { nameEn: nameEnFromServer } : {}),
            ...(payload.note_en !== undefined
              ? { noteEn: noteEnFromServer }
              : {}),
          };
          const statusIso = String(payload.status_changed_at ?? "").trim();
          if (statusIso) {
            const ymd = statusChangedAtYmdFromDbIso(statusIso);
            if (ymd) merged = { ...merged, statusChangedAtYmd: ymd };
          } else if (prevItem.status !== nextItem.status) {
            merged = { ...merged, statusChangedAtYmd: merged.statusChangedAtYmd ?? todayBangkokYmd() };
          } else if (!String(prevItem.id ?? "").trim() && String(payload.order_item_id ?? "").trim()) {
            merged = { ...merged, statusChangedAtYmd: merged.statusChangedAtYmd ?? todayBangkokYmd() };
          }
          if (!nextPolClock?.storeDepositClock) return merged;
          const nextClock = enteredStoreDepositClock ? todayY : merged.clockStartYmd ?? todayY;
          return { ...merged, clockStartYmd: nextClock };
        })
      );
    } catch (error) {
      setItems((current) => current.map((candidate) => (candidate.uid === prevItem.uid ? prevItem : candidate)));
      setSaveError(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSavingItemUid((current) => (current === nextItem.uid ? null : current));
    }
  };

  /** flush ระหว่างพิมพ์หมายเหตุ (debounce / blur / ปิดแถบ) */
  const flushPendingNotePersist = async (uid: string) => {
    clearNoteDebounce(uid);
    const live = itemsRef.current.find((row) => row.uid === uid);
    if (!live) return;
    await persistItem(live, live);
  };

  /** flush ระหว่างพิมพ์ชื่องาน (debounce / blur) */
  const flushPendingNamePersist = async (uid: string) => {
    clearNameDebounce(uid);
    const live = itemsRef.current.find((row) => row.uid === uid);
    if (!live) return;
    await persistItem(live, live);
  };

  const patchItem = (target: OrderItemRow, patch: Partial<OrderItem>) => {
    closeSwipeRows();
    const uid = target.uid;
    const patchKeys = Object.keys(patch);
    const isNoteOnlySave = patchKeys.length === 1 && patchKeys[0] === "note";
    const isNameOnlySave = patchKeys.length === 1 && patchKeys[0] === "name";

    if (isNoteOnlySave) {
      clearNoteDebounce(uid);
      setItems((prev) => {
        const base = prev.find((r) => r.uid === uid) ?? target;
        const nextStatus = (patch.status ?? base.status) as ItemStatusValue;
        const next: OrderItemRow = {
          ...base,
          ...patch,
          status: nextStatus,
          good: DONE_SET.has(nextStatus),
          ...(patch.status != null && patch.status !== base.status ? { statusChangedAtYmd: todayBangkokYmd() } : {}),
        };
        return prev.map((item) => (item.uid === uid ? next : item));
      });
      noteDebounceTimersRef.current[uid] = setTimeout(() => {
        delete noteDebounceTimersRef.current[uid];
        const live = itemsRef.current.find((row) => row.uid === uid);
        if (live) void persistItem(live, live);
      }, 280);
      return;
    }

    if (isNameOnlySave) {
      clearNameDebounce(uid);
      setItems((prev) => {
        const base = prev.find((r) => r.uid === uid) ?? target;
        const nextStatus = (patch.status ?? base.status) as ItemStatusValue;
        const next: OrderItemRow = {
          ...base,
          ...patch,
          status: nextStatus,
          good: DONE_SET.has(nextStatus),
          ...(patch.status != null && patch.status !== base.status ? { statusChangedAtYmd: todayBangkokYmd() } : {}),
        };
        return prev.map((item) => (item.uid === uid ? next : item));
      });
      nameDebounceTimersRef.current[uid] = setTimeout(() => {
        delete nameDebounceTimersRef.current[uid];
        const live = itemsRef.current.find((row) => row.uid === uid);
        if (live) void persistItem(live, live);
      }, 280);
      return;
    }

    clearNameDebounce(uid);
    clearNoteDebounce(uid);
    const baseEarly = itemsRef.current.find((r) => r.uid === uid) ?? target;
    const nextStatusEarly = (patch.status ?? baseEarly.status) as ItemStatusValue;
    const nextHypoEarly: OrderItemRow = {
      ...baseEarly,
      ...patch,
      status: nextStatusEarly,
      good: DONE_SET.has(nextStatusEarly),
      ...(patch.status != null && patch.status !== baseEarly.status ? { statusChangedAtYmd: todayBangkokYmd() } : {}),
    };
    if (orderItemPersistSignature(baseEarly) === orderItemPersistSignature(nextHypoEarly)) {
      return;
    }
    let prevSnap: OrderItemRow | null = null;
    let nextRow: OrderItemRow | null = null;
    /** บังคับให้ updater รันทันที — ไม่งั้น prevSnap/nextRow อาจยัง null แล้ว persist ไม่ถูกเรียก (React 18 batching) */
    flushSync(() => {
      setItems((prev) => {
        const base = prev.find((r) => r.uid === uid) ?? target;
        const nextStatus = (patch.status ?? base.status) as ItemStatusValue;
        const next: OrderItemRow = {
          ...base,
          ...patch,
          status: nextStatus,
          good: DONE_SET.has(nextStatus),
          ...(patch.status != null && patch.status !== base.status ? { statusChangedAtYmd: todayBangkokYmd() } : {}),
        };
        prevSnap = { ...base };
        nextRow = next;
        return prev.map((item) => (item.uid === uid ? next : item));
      });
    });
    if (prevSnap && nextRow) void persistItem(prevSnap, nextRow);
  };

  const updateStatus = (uid: string, status: string) => {
    if (status === STATUS_ACTION_NOTE) {
      void flushPendingNamePersist(uid);
      setNoteOpenUid(uid);
      return;
    }
    const current = items.find((item) => item.uid === uid);
    if (!current) return;
    patchItem(current, { status: status as ItemStatusValue });
  };

  const handleDueDatePicked = (uid: string, isoValue: string) => {
    const row = items.find((item) => item.uid === uid);
    if (!row) {
      setDatePickerUid(null);
      return;
    }
    const normalized = isoValue.slice(0, 10);
    if (row.dueDate?.slice(0, 10) === normalized) {
      setDatePickerUid(null);
      return;
    }
    patchItem(row, { dueDate: normalized, eta: normalized });
    setDatePickerUid(null);
  };

  const tamRoopSheetItem = useMemo(() => {
    if (!tamRoopSheetUid) return null;
    return items.find((r) => r.uid === tamRoopSheetUid) ?? null;
  }, [items, tamRoopSheetUid]);

  const closeTamRoopSheet = React.useCallback(() => {
    setTamRoopSheetUid(null);
    setTamRoopItemPhotos([]);
    setTamRoopPhotosFetchedForDbId(null);
    setTamRoopViewerOpen(false);
    setTamRoopLoadingPhotos(false);
  }, []);

  const loadTamRoopItemPhotos = React.useCallback(async () => {
    const itemId = String(tamRoopSheetItem?.id ?? "").trim();
    if (!itemId || !canAttachPhotos) return;
    setTamRoopLoadingPhotos(true);
    setSaveError("");
    try {
      const p = new URLSearchParams();
      if (order.carRowId) p.set("car_row_id", order.carRowId);
      if (order.carId != null) p.set("car_id", String(order.carId));
      const res = await fetch(`${ORDER_PHOTOS_LIST_API_PATH}?${p.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as {
        carPhotos?: OrderPhotoEntry[];
        itemPhotosByItemId?: Record<string, OrderPhotoEntry[]>;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      const list = json.itemPhotosByItemId?.[itemId] ?? [];
      setTamRoopItemPhotos(Array.isArray(list) ? list : []);
      setTamRoopPhotosFetchedForDbId(itemId);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "โหลดรูปไม่สำเร็จ");
    } finally {
      setTamRoopLoadingPhotos(false);
    }
  }, [tamRoopSheetItem, order.carRowId, order.carId, canAttachPhotos]);

  useEffect(() => {
    if (!tamRoopSheetUid || !canAttachPhotos) return;
    const itemId = String(tamRoopSheetItem?.id ?? "").trim();
    if (!itemId) return;
    void loadTamRoopItemPhotos();
  }, [tamRoopSheetUid, tamRoopSheetItem?.id, canAttachPhotos, loadTamRoopItemPhotos]);

  const isLikelyImageFile = (f: File): boolean =>
    typeof f.size === "number" &&
    f.size > 0 &&
    (/^image\//i.test(f.type) ||
      /\.(png|jpeg|jpg|webp|gif|heic|heif|bmp)$/i.test(String(f.name ?? "")));

  /** เวลามีจาก Files ธรรมดา และกรณีลากจากที่มาเหลือเฉพาะ DataTransfer.items */
  const gatherImageFilesFromDataTransfer = (dt: DataTransfer | null): File[] => {
    if (!dt) return [];
    const fromFiles = Array.from(dt.files ?? []).filter(isLikelyImageFile);
    if (fromFiles.length > 0) return fromFiles;
    const viaItems: File[] = [];
    const items = dt.items;
    if (!items?.length) return [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind !== "file") continue;
      const f = it.getAsFile();
      if (!f?.size) continue;
      const mimeHint = `${it.type || ""} ${f.type || ""}`;
      if (isLikelyImageFile(f) || /^image\//i.test(mimeHint.trim())) viaItems.push(f);
    }
    return viaItems;
  };

  const gatherImageFilesFromClipboard = (cd: DataTransfer | null): File[] => {
    if (!cd) return [];
    const fromFiles = Array.from(cd.files ?? []).filter(isLikelyImageFile);
    if (fromFiles.length > 0) return fromFiles;
    const out: File[] = [];
    const items = cd.items;
    if (!items?.length) return [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind !== "file") continue;
      const f = it.getAsFile();
      if (!f?.size) continue;
      if (isLikelyImageFile(f) || /^image\//i.test(`${it.type || ""}`.trim())) out.push(f);
    }
    return out;
  };

  const uploadTamRoopItemPhotos = async (files: Iterable<File> | FileList | null | undefined) => {
    const itemId = String(tamRoopSheetItem?.id ?? "").trim();
    const list = files == null ? [] : Array.from(files as Iterable<File>);
    const picked = list.filter(isLikelyImageFile);
    if (!picked.length || !itemId || !canAttachPhotos) return;
    setPhotoBusy(true);
    setSaveError("");
    try {
      const form = new FormData();
      form.append("target_type", "item");
      form.append("order_item_id", itemId);
      if (order.carRowId) form.append("car_row_id", order.carRowId);
      if (order.carId != null) form.append("car_id", String(order.carId));
      for (const file of picked) form.append("files", file);
      const res = await fetch(ORDER_PHOTOS_UPLOAD_API_PATH, { method: "POST", body: form });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? res.statusText);
      await loadTamRoopItemPhotos();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "อัปโหลดรูปไม่สำเร็จ");
    } finally {
      setPhotoBusy(false);
    }
  };

  /** เมื่อลากจาก LINE ได้ลิงก์รูปแทนไฟล์ — ให้เซิร์ฟเวอร์ดึง (หลบ CORS) */
  const uploadTamRoopItemPhotosFromUrls = async (urls: string[]) => {
    const itemId = String(tamRoopSheetItem?.id ?? "").trim();
    const list = Array.from(new Set(urls.map((u) => u.trim()).filter(Boolean)));
    if (!list.length || !itemId || !canAttachPhotos) return;
    setPhotoBusy(true);
    setSaveError("");
    try {
      const res = await fetch(ORDER_PHOTOS_FETCH_URL_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_type: "item",
          order_item_id: itemId,
          car_row_id: order.carRowId,
          car_id: order.carId,
          urls: list,
        }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? res.statusText);
      await loadTamRoopItemPhotos();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "โหลดรูปจากลิงก์ไม่สำเร็จ");
    } finally {
      setPhotoBusy(false);
    }
  };

  const uploadTamRoopPhotosLatestRef = useRef(uploadTamRoopItemPhotos);
  uploadTamRoopPhotosLatestRef.current = uploadTamRoopItemPhotos;

  /** จับวางรูปแม้ focus ไม่อยู่ในกล่อง — ใช้ capture + ลากวางทั้งจอมืด */
  useEffect(() => {
    if (!tamRoopSheetUid) return;
    const itemId = String(tamRoopSheetItem?.id ?? "").trim();
    if (!itemId || !canAttachPhotos) return;

    const onCapturePaste = (ev: ClipboardEvent) => {
      const list = gatherImageFilesFromClipboard(ev.clipboardData);
      if (!list.length) return;
      ev.preventDefault();
      ev.stopPropagation();
      void uploadTamRoopPhotosLatestRef.current(list);
    };

    document.addEventListener("paste", onCapturePaste, true);
    queueMicrotask(() => {
      tamRoopOverlayRef.current?.focus({ preventScroll: true });
    });

    return () => document.removeEventListener("paste", onCapturePaste, true);
  }, [tamRoopSheetUid, tamRoopSheetItem?.id, canAttachPhotos]);

  const onTamRoopSheetDragOver = (e: React.DragEvent) => {
    const itemId = String(tamRoopSheetItem?.id ?? "").trim();
    if (!itemId || !canAttachPhotos || photoBusy) return;
    /** ให้เปิดรับการ drop เมื่อเป็นไฟล์ (ผู้ใช้ลากจากเดสก์ท็อป/แท็บอื่น) */
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = "copy";
    } catch {
      /* ignore */
    }
  };

  const onTamRoopSheetDrop = (e: React.DragEvent) => {
    const itemId = String(tamRoopSheetItem?.id ?? "").trim();
    if (!itemId || !canAttachPhotos || photoBusy) return;
    e.preventDefault();
    const files = gatherImageFilesFromDataTransfer(e.dataTransfer);
    if (files.length) {
      void uploadTamRoopItemPhotos(files);
      return;
    }
    const urls = extractImageUrlsFromDataTransfer(e.dataTransfer);
    if (urls.length) {
      void uploadTamRoopItemPhotosFromUrls(urls);
    }
  };

  const deleteTamRoopItemPhoto = async (photoId: string) => {
    if (!photoId) return;
    setPhotoBusy(true);
    setSaveError("");
    try {
      const res = await fetch(ORDER_PHOTOS_DELETE_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_id: photoId }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? res.statusText);
      await loadTamRoopItemPhotos();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "ลบรูปไม่สำเร็จ");
    } finally {
      setPhotoBusy(false);
    }
  };

  const splitInlineTextWithCompare = () => {
    setInlineCompareEnabled(true);
    const shouldKeepInlineTaskLine = (rawLine: string): boolean => {
      const line = rawLine.trim();
      if (!line) return false;

      const mentions = line.match(/@\S+/g) ?? [];
      const wordCount = line.split(/\s+/).filter(Boolean).length;
      /** บรรทัดแท็กชื่อ (เช่น @A @B @C) */
      if (mentions.length >= 2 && mentions.length * 2 >= wordCount) return false;
      if (mentions.length >= 1 && wordCount <= 2) return false;

      /** บรรทัดหัวรถ/ทะเบียนที่แปะมากับข้อความ LINE */
      const hasThaiPlateLike = /[ก-ฮ]{1,3}[-\s]?\d{1,4}/.test(line);
      const hasVehicleSpecToken =
        /(REVO|FORTUNER|HILUX|VIGO|RANGER|D-MAX|2WD|4WD|AT|MT|DOUBLE[_\s-]?CAB|SILVER|BLACK|WHITE|GRAY|GREY|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/i.test(
          line
        );
      if (hasThaiPlateLike && hasVehicleSpecToken) return false;
      /** บรรทัดที่เป็นเลขทะเบียนล้วน */
      if (/^[0-9]{0,2}[ก-ฮ]{1,3}[-\s]?[0-9]{1,4}$/i.test(line)) return false;
      /** บรรทัด chassis / VIN */
      const hasChassisKeyword = /(chassis|vin|เลขถัง|ตัวถัง)/i.test(line);
      const hasLongVinToken = /[a-z0-9-]{10,}/i.test(line);
      if (hasChassisKeyword || hasLongVinToken) return false;

      /** ชื่อ/โน้ตภาษาอังกฤษลอยๆ เช่น faluk */
      if (/^[a-zA-Z][a-zA-Z0-9 _-]{0,22}$/.test(line)) return false;

      return true;
    };

    setInlineItems(
      inlineText
        .split("\n")
        .map((line) => line.trim())
        .filter(shouldKeepInlineTaskLine)
        .map((name, index) => {
          const duplicate = items.some((old) => norm(old.name).includes(norm(name)) || norm(name).includes(norm(old.name)));
          return {
            id: `${order.id}-new-${index}`,
            name,
            duplicate,
            selected: !duplicate,
            assignee: defaultIntakeAssignee,
            status: "เช็ค" as ItemStatusValue,
            insertAfterUid: INLINE_INSERT_AFTER_END,
          };
        })
    );
  };

  const splitInlineTextRaw = () => {
    setInlineCompareEnabled(false);
    setInlineItems(
      inlineText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((name, index) => ({
          id: `${order.id}-raw-${index}`,
          name,
          duplicate: false,
          selected: true,
          assignee: defaultIntakeAssignee,
          status: "เช็ค" as ItemStatusValue,
          insertAfterUid: INLINE_INSERT_AFTER_END,
        }))
    );
  };

  const aiAssistInlineText = async () => {
    if (!inlineText.trim() || inlineAiBusy) return;
    setInlineAiBusy(true);
    setInlineMessage("");
    try {
      const res = await fetch("/api/m/order-intake/ai-split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: inlineText,
          existing_items: items.map((r) => String(r.name ?? "").trim()).filter(Boolean),
        }),
      });
      const payload = (await res.json()) as { error?: string; lines?: string[] };
      if (!res.ok) throw new Error(payload.error ?? res.statusText);
      const lines = Array.isArray(payload.lines) ? payload.lines : [];
      if (lines.length === 0) {
        setInlineMessage("AI ไม่พบรายการงานจากข้อความนี้");
        return;
      }
      setInlineText(lines.join("\n"));
      /** ต่อด้วย split + เทียบของเดิมเพื่อทำ checkbox ให้เลย */
      queueMicrotask(() => splitInlineTextWithCompare());
    } catch (e) {
      setInlineMessage(e instanceof Error ? e.message : "AI ช่วยแยกไม่สำเร็จ");
    } finally {
      setInlineAiBusy(false);
    }
  };

  const removeInlineItem = (id: string) => {
    setInlineItems((prev) => prev.filter((item) => item.id !== id));
  };

  const updateInlineItem = (
    id: string,
    patch: Partial<Pick<InlineDraftRow, "name" | "status" | "assignee" | "selected">>
  ) => {
    setInlineItems((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const nextName = patch.name !== undefined ? patch.name : row.name;
        const next = { ...row, ...patch, name: nextName };
        const trimmed = nextName.trim();
        const duplicate =
          inlineCompareEnabled &&
          trimmed.length > 0 &&
          items.some((old) => norm(old.name).includes(norm(trimmed)) || norm(trimmed).includes(norm(old.name)));
        const selected =
          patch.selected !== undefined
            ? patch.selected
            : patch.name !== undefined
              ? inlineCompareEnabled
                ? !duplicate
                : row.selected
              : row.selected;
        return { ...next, duplicate, selected };
      })
    );
  };

  const pushEmptyInlineItem = (insertAfterUid: string = INLINE_INSERT_AFTER_END) => {
    setInlineItems((prev) => [
      ...prev,
      {
        id: `${order.id}-manual-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: "",
        duplicate: false,
        selected: true,
        assignee: defaultIntakeAssignee,
        status: "เช็ค" as ItemStatusValue,
        insertAfterUid,
      },
    ]);
  };

  /** แทรกแถวว่างใต้แถวรายการที่สั่งจากปัดซ้าย */
  const openIntakeAndAddEmptyRow = (afterItemUid: string) => {
    setShowAllItems(true);
    setShowInlineIntake(true);
    pushEmptyInlineItem(afterItemUid);
  };

  const addInlineItemsToOrder = async () => {
    if (!inlineItems.length) return;
    const cleaned = inlineItems
      .map((item) => ({ ...item, name: item.name.trim() }))
      .filter((item) => item.name.length > 0 && item.selected);
    if (!cleaned.length) return;
    try {
      setInlineSaving(true);
      setInlineMessage("");
      const res = await fetch("/api/m/order-intake/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          car_row_id: order.carRowId,
          car_id: order.carId,
          full_plate: order.fullPlate,
          car_label: order.car,
          items: cleaned.map((item) => ({
            label: item.name,
            status: item.status,
            assignee_staff: item.assignee || null,
          })),
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
        order_task_id?: string;
        saved?: Array<{ order_item_id: string; label: string; label_en: string | null }>;
      };
      if (!res.ok) throw new Error(payload.error ?? res.statusText);
      const taskId = String(payload.order_task_id ?? "").trim() || null;
      const savedList = Array.isArray(payload.saved) ? payload.saved : null;
      setItems((prev) => {
        const prevUids = new Set(prev.map((r) => r.uid));
        const merged = mergeInlineCleanedIntoItemRows(prev, cleaned, taskId, savedList);
        for (const row of merged) {
          if (!prevUids.has(row.uid)) {
            lastPersistedSigByUidRef.current[row.uid] = orderItemPersistSignature(row);
          }
        }
        return merged;
      });
      setInlineItems([]);
      setInlineText("");
      setShowInlineIntake(false);
      setShowAllItems(false);
      router.refresh();
    } catch (error) {
      setInlineMessage(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
    } finally {
      setInlineSaving(false);
    }
  };

  /** บันทึกแค่แถวเดียวจากฟอร์มที่เปิดจากปัดซ้าย — ไม่ต้องรอปุ่มรวมด้านล่าง */
  const saveSingleInlineDraftRow = async (row: InlineDraftRow) => {
    const name = row.name.trim();
    if (!name) {
      setInlineMessage(uiLang === "en" ? "Enter a task name before saving." : "กรอกชื่องานก่อนกดบันทึก");
      return;
    }
    const cleaned: Pick<InlineDraftRow, "id" | "name" | "status" | "assignee" | "insertAfterUid">[] = [
      { ...row, name },
    ];
    try {
      setInlineRowSavingId(row.id);
      setInlineMessage("");
      const res = await fetch("/api/m/order-intake/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          car_row_id: order.carRowId,
          car_id: order.carId,
          full_plate: order.fullPlate,
          car_label: order.car,
          items: cleaned.map((item) => ({
            label: item.name,
            status: item.status,
            assignee_staff: item.assignee || null,
          })),
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
        order_task_id?: string;
        saved?: Array<{ order_item_id: string; label: string; label_en: string | null }>;
      };
      if (!res.ok) throw new Error(payload.error ?? res.statusText);
      const taskId = String(payload.order_task_id ?? "").trim() || null;
      const savedList = Array.isArray(payload.saved) ? payload.saved : null;
      setItems((prev) => {
        const prevUids = new Set(prev.map((r) => r.uid));
        const merged = mergeInlineCleanedIntoItemRows(prev, cleaned, taskId, savedList);
        for (const r of merged) {
          if (!prevUids.has(r.uid)) {
            lastPersistedSigByUidRef.current[r.uid] = orderItemPersistSignature(r);
          }
        }
        return merged;
      });
      setInlineItems((prev) => {
        const next = prev.filter((r) => r.id !== row.id);
        if (next.length === 0) {
          setShowInlineIntake(false);
          setShowAllItems(false);
        }
        return next;
      });
      router.refresh();
    } catch (error) {
      setInlineMessage(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
    } finally {
      setInlineRowSavingId(null);
    }
  };

  const assigneeSelectOptions = (assignee: string) => {
    const s = new Set<string>();
    for (const n of staffOptions) {
      const t = String(n).trim();
      if (t) s.add(t);
    }
    const a = String(assignee ?? "").trim();
    if (a) s.add(a);
    return Array.from(s).sort((x, y) => x.localeCompare(y, "en"));
  };

  const handleDeleteItem = async (item: OrderItemRow) => {
    if (typeof window !== "undefined" && !window.confirm("ลบรายการนี้?")) return;
    closeSwipeRows();
    clearNameDebounce(item.uid);
    clearNoteDebounce(item.uid);
    if (noteOpenUid === item.uid) setNoteOpenUid(null);
    if (!item.id) {
      setItems((prev) => prev.filter((r) => r.uid !== item.uid));
      return;
    }
    setSavingItemUid(item.uid);
    setSaveError("");
    try {
      const res = await fetch("/api/m/order-items/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_item_id: item.id,
          order_task_id: item.orderTaskId ?? null,
          car_row_id: order.carRowId,
          car_id: order.carId,
          updated_by: "mobile-card",
        }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? res.statusText);
      setItems((prev) => prev.filter((r) => r.uid !== item.uid));
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    } finally {
      setSavingItemUid((cur) => (cur === item.uid ? null : cur));
    }
  };

  const onRowPointerDown = (e: React.PointerEvent, uid: string) => {
    if (e.button !== 0) return;
    const t = e.target;
    if (
      t instanceof HTMLInputElement ||
      t instanceof HTMLSelectElement ||
      t instanceof HTMLTextAreaElement ||
      t instanceof HTMLOptionElement ||
      t instanceof HTMLButtonElement
    ) {
      return;
    }
    if (t instanceof HTMLElement && t.closest("[data-order-item-name-preview]")) return;
    const raw = rowSwipePxRef.current[uid] ?? 0;
    const baseFromState = Math.min(0, Math.max(-SWIPE_ROW_LEFT_OPEN_PX, raw));
    rowSwipeGestureRef.current = {
      uid,
      startX: e.clientX,
      startY: e.clientY,
      base: baseFromState,
      lastOffset: baseFromState,
      startedOpen: baseFromState < 0,
      phase: "pending",
    };
  };

  const onRowPointerMove = (e: React.PointerEvent, uid: string) => {
    const g = rowSwipeGestureRef.current;
    if (!g || g.uid !== uid) return;

    if (g.phase === "pending") {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_TOUCH_SLOP_PX) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        rowSwipeGestureRef.current = null;
        return;
      }
      g.phase = "dragging";
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setRowSwipePx(() => ({ [uid]: g.base }));
    }

    if (g.phase !== "dragging") return;
    e.preventDefault();
    const dx = e.clientX - g.startX;
    const offset = Math.min(0, Math.max(-SWIPE_ROW_LEFT_OPEN_PX, g.base + dx));
    g.lastOffset = offset;

    if (swipeDragRafRef.current == null) {
      swipeDragRafRef.current = requestAnimationFrame(() => {
        swipeDragRafRef.current = null;
        const active = rowSwipeGestureRef.current;
        if (!active || active.uid !== uid || active.phase !== "dragging") return;
        const off = active.lastOffset;
        setRowSwipePx((prev) => ({ ...prev, [uid]: off }));
      });
    }
  };

  const onRowPointerUpOrCancel = (e: React.PointerEvent, uid: string) => {
    flushSwipeDragRaf();
    const g = rowSwipeGestureRef.current;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!g || g.uid !== uid) {
      rowSwipeGestureRef.current = null;
      return;
    }
    rowSwipeGestureRef.current = null;

    if (g.phase === "pending") {
      return;
    }

    const cur = g.lastOffset;
    const easyOpenThresh = SWIPE_ROW_LEFT_OPEN_PX * SWIPE_ROW_SNAP_RATIO;
    const halfOpen = SWIPE_ROW_LEFT_OPEN_PX / 2;
    /** จากปิด: ปัดซ้ายนิดเดียวก็เปิดได้ · จากเปิด: ปัดขวาเกินครึ่งแถบ = ปิด (ไม่สแนปกลับเปิดเต็มโดยผิด) */
    let snap: number;
    if (g.startedOpen) {
      snap = cur <= -halfOpen ? -SWIPE_ROW_LEFT_OPEN_PX : 0;
    } else {
      snap = cur < -easyOpenThresh ? -SWIPE_ROW_LEFT_OPEN_PX : 0;
    }
    setRowSwipePx((prev) => {
      const next = { ...prev };
      if (snap === 0) delete next[uid];
      else next[uid] = snap;
      return next;
    });
  };

  const orderPhotoUrl = orderPhotoHttpUrl(order.photo);
  const renderCarHeadline = (asPhotoLink: boolean) => (
    <>
      <span
        className={cn(
          "text-[15px] font-semibold leading-snug sm:text-base",
          asPhotoLink ? "text-blue-700" : "text-slate-900"
        )}
      >
        {order.car}
      </span>
      <span
        className={cn(
          "mt-1 block break-all font-mono text-xs font-normal leading-normal",
          asPhotoLink ? "text-blue-600" : "text-slate-500"
        )}
      >
        {order.chassis}
      </span>
    </>
  );

  const renderInlineDraftCard = (row: InlineDraftRow) => (
    <div key={row.id} className={cn("rounded-2xl px-2.5 py-2", row.duplicate ? "bg-red-50" : "bg-slate-100")}>
      <input
        value={row.name}
        onChange={(e) => updateInlineItem(row.id, { name: e.target.value })}
        placeholder={uiLang === "en" ? "Task name" : "ชื่องาน"}
        className="mb-2 w-full rounded-xl border-0 bg-white px-2.5 py-2.5 text-sm font-medium text-slate-900 outline-none ring-1 ring-slate-200/80 focus:ring-2 focus:ring-slate-300/80"
      />
      <div className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch]">
        <select
          value={row.status}
          onChange={(e) => updateInlineItem(row.id, { status: e.target.value as ItemStatusValue })}
          title={uiLang === "en" ? "Status" : "สถานะ"}
          className="h-10 min-h-[40px] w-[5.75rem] shrink-0 touch-manipulation rounded-full border-0 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 shadow-sm outline-none ring-1 ring-slate-200/80"
        >
          {statusOptionsForValue(row.status).map((st) => (
            <option key={st} value={st}>
              {statusLabelInCard(st)}
            </option>
          ))}
        </select>
        <select
          value={row.assignee || ""}
          onChange={(e) => updateInlineItem(row.id, { assignee: e.target.value })}
          title={uiLang === "en" ? "Owner" : "พนักงาน"}
          className={cn(
            "h-10 min-h-[40px] w-[84px] min-w-[4.75rem] touch-manipulation rounded-full border-0 px-2 py-1.5 text-xs font-semibold shadow-sm outline-none ring-1 focus-visible:ring-2 sm:w-[92px]",
            assigneeSelectSurfaceClasses(row.assignee || "")
          )}
        >
          <option value="">—</option>
          {assigneeSelectOptions(row.assignee).map((staffName) => (
            <option key={staffName} value={staffName}>
              {staffName}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => removeInlineItem(row.id)}
          className="shrink-0 rounded-full bg-red-100 px-2.5 py-1.5 text-xs font-medium text-red-800 touch-manipulation"
        >
          {uiLang === "en" ? "Delete" : "ลบ"}
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-xs font-medium">
          {row.duplicate ? (
            <span className="text-red-600">{uiLang === "en" ? "Likely duplicate on card" : "คาดว่าซ้ำกับรายการบนการ์ด"}</span>
          ) : (
            <span className="text-emerald-600">{uiLang === "en" ? "New item" : "รายการใหม่"}</span>
          )}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void saveSingleInlineDraftRow(row)}
            disabled={inlineSaving || inlineRowSavingId !== null}
            className={cn(
              "rounded-full px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm ring-1 ring-inset touch-manipulation",
              inlineSaving || (inlineRowSavingId !== null && inlineRowSavingId !== row.id)
                ? "cursor-not-allowed bg-slate-400 ring-slate-500/20"
                : inlineRowSavingId === row.id
                  ? "cursor-wait bg-emerald-500/90 ring-emerald-700/20"
                  : "bg-emerald-600 ring-emerald-800/25 active:bg-emerald-700"
            )}
          >
            {inlineRowSavingId === row.id
              ? uiLang === "en"
                ? "Saving…"
                : "กำลังบันทึก…"
              : uiLang === "en"
                ? "Save"
                : "บันทึก"}
          </button>
          <label className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200/80">
            <input
              type="checkbox"
              checked={row.selected}
              onChange={(e) => updateInlineItem(row.id, { selected: e.target.checked })}
              className="h-3.5 w-3.5 accent-slate-900"
            />
            {row.duplicate ? (uiLang === "en" ? "Confirm add" : "ยืนยันเพิ่ม") : (uiLang === "en" ? "Add item" : "เพิ่มรายการ")}
          </label>
        </div>
      </div>
    </div>
  );

  return (
    <article
      id={`order-card-${order.id}`}
      className="rounded-none bg-white px-2 py-2.5 shadow-sm ring-1 ring-slate-200/60 sm:rounded-2xl sm:px-3 sm:py-3"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {orderPhotoUrl ? (
            <a
              href={orderPhotoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-sm decoration-blue-600/70 underline-offset-2 hover:underline"
            >
              {renderCarHeadline(true)}
            </a>
          ) : (
            <div className="block text-slate-900">{renderCarHeadline(false)}</div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-medium leading-snug text-slate-600">
            <span className="rounded-full bg-slate-100 px-2.5 py-1">{order.sale}</span>
            <span className="min-w-0 max-w-full truncate rounded-full bg-slate-100 px-2.5 py-1">{order.buyer} · {formatUsd(order.salePrice)}</span>
            <button
              type="button"
              onClick={() => {
                setShowCost((wasOpen) => {
                  const opening = !wasOpen;
                  if (opening && uiLang === "en" && !carSummaryEnRef.current && orderCarSummaryFieldsHaveThai(order)) {
                    void translateCarSummaryViaApi({ panelLoading: true });
                  }
                  return opening;
                });
              }}
              className="rounded-full bg-slate-200/80 px-2.5 py-1 text-xs font-semibold text-slate-800 touch-manipulation"
            >
              COST {formatUsd(order.cost)}{" "}
              {carSummaryTranslating && uiLang === "en" ? "…" : showCost ? "⌃" : "⌄"}
            </button>
          </div>
          {showCost ? (
            <div className="mt-2 overflow-hidden rounded-2xl bg-slate-50 text-sm font-medium leading-relaxed text-slate-700">
              <div className="flex items-center justify-between gap-2 bg-slate-950 px-3 py-2.5 text-white">
                <span className="text-sm font-semibold tracking-tight">{uiLang === "en" ? "Cost Summary" : "สรุปต้นทุน"}</span>
                {order.expensePdf ? (
                  <a
                    href={order.expensePdf}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white hover:bg-white/25"
                  >
                    {uiLang === "en" ? "Parts/Accessories" : "ค่าอะไหล่/ของแต่ง"}
                  </a>
                ) : (
                  <span
                    className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/50"
                    title={uiLang === "en" ? "No parts/accessories link yet (part_accessories)" : "ยังไม่มีลิงก์ค่าอะไหล่/ของแต่ง (part_accessories)"}
                  >
                    {uiLang === "en" ? "Parts/Accessories" : "ค่าอะไหล่/ของแต่ง"}
                  </span>
                )}
              </div>
              <div className="space-y-2 p-3">
                <div className="rounded-2xl bg-white p-2.5">
                  <div className="mb-1 text-xs font-semibold tracking-wide text-slate-500">{uiLang === "en" ? "Total Cost" : "ต้นทุนรวม"}</div>
                  <p className="whitespace-pre-wrap break-words leading-relaxed text-slate-800">
                    {uiLang === "en" && carSummaryTranslating && !carSummaryEn
                      ? "Translating…"
                      : uiLang === "en" && carSummaryEn
                        ? stripEnglishPhotoRefMarkers(
                            String(carSummaryEn.cost || order.costDetail || order.costBreakdown || order.cost || "-")
                          )
                        : order.costDetail || order.costBreakdown || order.cost || "-"}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-2xl bg-white p-2.5">
                    <div className="mb-1 text-xs font-semibold tracking-wide text-slate-500">{uiLang === "en" ? "Repair" : "ซ่อม"}</div>
                    <p className="whitespace-pre-wrap break-words leading-relaxed text-slate-700">
                      {uiLang === "en" && carSummaryTranslating && !carSummaryEn
                        ? "Translating…"
                        : uiLang === "en" && carSummaryEn
                          ? stripEnglishPhotoRefMarkers(
                              String(carSummaryEn.repair || order.repairDetail || order.repairDetails || "-")
                            )
                          : order.repairDetail || order.repairDetails || "-"}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white p-2.5">
                    <div className="mb-1 text-xs font-semibold tracking-wide text-slate-500">{uiLang === "en" ? "Document" : "เอกสาร"}</div>
                    <p className="whitespace-pre-wrap break-words leading-relaxed text-slate-700">
                      {uiLang === "en" && carSummaryTranslating && !carSummaryEn
                        ? "Translating…"
                        : uiLang === "en" && carSummaryEn
                          ? stripEnglishPhotoRefMarkers(String(carSummaryEn.document || order.documentDetail || "-"))
                          : order.documentDetail || "-"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        {order.ship && order.ship !== "ว่าง" ? (
          <span className="shrink-0 whitespace-nowrap rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800">{order.ship}</span>
        ) : null}
      </div>

      <div className="mb-2 flex w-full min-w-0 flex-nowrap items-center gap-2 overflow-x-auto rounded-full bg-slate-100/90 px-2 py-2 ring-1 ring-slate-200/50">
        <button
          type="button"
          onClick={() => {
            setShowInlineIntake((prev) => {
              const opening = !prev;
              if (opening) setShowAllItems(true);
              else setShowAllItems(false);
              return !prev;
            });
          }}
          className="shrink-0 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 touch-manipulation"
        >
          {uiLang === "en" ? "Add task" : "เพิ่มงาน"}
        </button>
        <button
          type="button"
          onClick={() => void translateCardItemsToEnglish()}
          disabled={translateCardBusy || orderTaskIdsForCard.length === 0}
          className={cn(
            "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium touch-manipulation",
            translateCardBusy || orderTaskIdsForCard.length === 0
              ? "cursor-not-allowed bg-slate-200 text-slate-500"
              : "bg-blue-50 text-blue-800"
          )}
          title={
            uiLang === "en"
              ? "Translate item names, item notes, and Cost Summary (cost/repair/document) on this card"
              : "แปลชื่อและหมายเหตุรายการ + ข้อความสรุปต้นทุน/ซ่อม/เอกสารในการ์ดนี้"
          }
        >
          {translateCardBusy
            ? (uiLang === "en" ? "Translating..." : "กำลังแปล...")
            : (uiLang === "en" ? "Translate EN" : "แปล EN")}
        </button>
        {items.length === 0 ? (
          <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-900">{uiLang === "en" ? "No items yet" : "ยังไม่มีรายการ"}</span>
        ) : itemsEffective.length === 0 ? (
          <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
            {suppressToolbarOthers && itemsOutsideToolbarFilter.length > 0
              ? (uiLang === "en"
                  ? `Other items hidden (+${itemsOutsideToolbarFilter.length})`
                  : `ซ่อนงานอื่นอยู่ (+${itemsOutsideToolbarFilter.length})`)
              : (uiLang === "en" ? "No items match filters" : "ไม่มีรายการตามตัวกรอง")}
          </span>
        ) : (
          <span
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium",
              allDone ? "bg-emerald-50 text-emerald-800" : "bg-amber-100 text-amber-900"
            )}
          >
            {allDone
              ? (uiLang === "en" ? `Done ${done.length}/${itemsEffective.length}` : `จบ ${done.length}/${itemsEffective.length}`)
              : (uiLang === "en" ? `Waiting ${waiting.length}/${itemsEffective.length}` : `รอ ${waiting.length}/${itemsEffective.length}`)}
          </span>
        )}
        <a
          href={lineShareUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 touch-manipulation"
        >
          {uiLang === "en" ? "Share" : "แชร์"}
        </a>
        {canAttachPhotos ? (
          <label
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold touch-manipulation",
              photoBusy ? "cursor-not-allowed bg-slate-200 text-slate-500" : "bg-slate-900 text-white"
            )}
          >
            {uiLang === "en" ? "Add photo" : "เพิ่มรูป"}
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={photoBusy}
              className="hidden"
              onChange={(e) => {
                void uploadPhotos(e.currentTarget.files);
                e.currentTarget.value = "";
              }}
            />
          </label>
        ) : null}
      </div>

      {canAttachPhotos && carPhotos.length > 0 ? (
        <div className="mb-2 rounded-2xl bg-slate-100/80 px-2.5 py-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-semibold tracking-wide text-slate-600">{uiLang === "en" ? "Car Photos" : "รูปรถ"}</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {carPhotos.map((p) => (
              <div key={p.id} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => openPhotoViewer(carPhotos.findIndex((x) => x.id === p.id))}
                  className="block"
                >
                  <Image
                    src={p.url}
                    alt="car"
                    width={112}
                    height={80}
                    sizes="112px"
                    loading="lazy"
                    className="h-20 w-28 rounded-lg object-cover ring-1 ring-slate-200/70"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => void deletePhoto(p.id)}
                  disabled={photoBusy}
                  className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                >
                  {uiLang === "en" ? "Delete" : "ลบ"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : !canAttachPhotos ? (
        <p className="mb-2 text-[11px] font-medium text-slate-500">{uiLang === "en" ? "No car_row_id / car_id for photo attachment" : "ไม่พบ car_row_id / car_id สำหรับแนบรูป"}</p>
      ) : null}

      {photoViewerOpen && carPhotos.length > 0 ? (
        <div className="fixed inset-0 z-[80] bg-black/90 p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-white">
              {uiLang === "en"
                ? `Car photos ${photoViewerIndex + 1}/${carPhotos.length} (swipe left/right)`
                : `รูปรถ ${photoViewerIndex + 1}/${carPhotos.length} (ปัดซ้าย/ขวาได้)`}
            </span>
            <button type="button" onClick={closePhotoViewer} className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
              {uiLang === "en" ? "Close" : "ปิด"}
            </button>
          </div>
          <div
            ref={photoViewerStripRef}
            className="flex h-[86vh] snap-x snap-mandatory overflow-x-auto touch-pan-x gap-2"
            style={{ scrollBehavior: "smooth" }}
            onScroll={(e) => {
              const el = e.currentTarget;
              const idx = Math.round(el.scrollLeft / Math.max(el.clientWidth, 1));
              if (idx !== photoViewerIndex && idx >= 0 && idx < carPhotos.length) setPhotoViewerIndex(idx);
            }}
          >
            {carPhotos.map((p) => (
              <div key={`viewer-${p.id}`} className="relative h-full w-full shrink-0 snap-center">
                <Image src={p.url} alt="car full" fill sizes="100vw" loading="lazy" className="object-contain" />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-1">
        {compareItems.map((item) => {
          const isWaiting = WAITING_SET.has(item.status);
          const isSaving = savingItemUid === item.uid;
          const showNoteRow = noteOpenUid === item.uid || Boolean(item.note?.trim());
          const swipeX = rowSwipePx[item.uid] ?? 0;
          const rowPol = itemPoliciesNorm.byStatus[item.status as ItemStatusValue];
          const storeCap = rowPol.storeDepositClock ? storeDepositEffectiveMaxDays(rowPol) : null;
          return (
            <Fragment key={item.uid}>
            <div className="relative overflow-hidden rounded-2xl">
              <div
                className="absolute inset-y-0 right-0 z-0 flex items-stretch overflow-hidden rounded-2xl ring-1 ring-slate-300/50"
                style={{ width: SWIPE_ROW_LEFT_OPEN_PX }}
              >
                <button
                  type="button"
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={() => void handleDeleteItem(item)}
                  disabled={isSaving}
                  className="flex min-w-0 flex-1 items-center justify-center border-r border-rose-300/70 bg-rose-100 px-0.5 text-center text-[11px] font-semibold leading-tight text-rose-900 disabled:opacity-50 sm:text-xs"
                >
                  {uiLang === "en" ? "Delete" : "ลบ"}
                </button>
                <button
                  type="button"
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={() => {
                    setShowAllItems(true);
                    setShowInlineIntake(true);
                    closeSwipeRows();
                  }}
                  className="flex min-w-0 flex-1 items-center justify-center border-r border-emerald-300/70 bg-emerald-100 px-0.5 text-center text-[11px] font-semibold leading-tight text-emerald-950 sm:text-xs"
                >
                  {uiLang === "en" ? "Add task" : "เพิ่มงาน"}
                </button>
                <button
                  type="button"
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={() => {
                    openIntakeAndAddEmptyRow(item.uid);
                    closeSwipeRows();
                  }}
                  className="flex min-w-0 flex-1 items-center justify-center bg-sky-100 px-0.5 text-center text-[11px] font-semibold leading-tight text-sky-950 sm:text-xs"
                >
                  {uiLang === "en" ? "Add row" : "เพิ่มแถว"}
                </button>
              </div>
              <div
                style={{ transform: `translateX(${swipeX}px)` }}
                onPointerDown={(e) => onRowPointerDown(e, item.uid)}
                onPointerMove={(e) => onRowPointerMove(e, item.uid)}
                onPointerUp={(e) => onRowPointerUpOrCancel(e, item.uid)}
                onPointerCancel={(e) => onRowPointerUpOrCancel(e, item.uid)}
                className={cn(
                  "relative z-[1] flex touch-manipulation flex-col rounded-2xl py-1.5 pl-1 pr-2 will-change-transform sm:py-2 sm:pl-1.5 sm:pr-3",
                  item.overdue ? "bg-red-50" : isWaiting ? "bg-amber-50" : "bg-slate-100"
                )}
              >
              <div className="flex min-h-0 w-full min-w-0 flex-1 flex-row items-stretch gap-1">
                <div
                  className="shrink-0 touch-manipulation select-none self-stretch rounded-l-lg bg-slate-200/35 active:bg-slate-300/50 sm:w-4 w-[14px] min-h-[2.75rem]"
                  aria-hidden
                  title="ปัดซ้ายจากขอบนี้ — พื้นที่ว่างสำหรับลากเปิดเมนู"
                />
              <div
                className={cn(
                  "min-h-0 min-w-0 flex-1",
                  showNoteRow ? "flex flex-col gap-1.5" : "flex flex-nowrap items-center gap-1 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch]"
                )}
              >
                <div
                  className={cn(
                    "flex min-w-0 w-full items-center gap-1",
                    showNoteRow ? "flex-nowrap overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch]" : "contents"
                  )}
                >
                  <OrderItemNameFieldWithTamRoop
                    item={item}
                    showNoteRow={showNoteRow}
                    uiLang={uiLang}
                    patchItem={patchItem}
                    flushPendingNamePersist={flushPendingNamePersist}
                    onTamRoopClick={(row) => {
                      void flushPendingNamePersist(row.uid);
                      setTamRoopSheetUid(row.uid);
                      setTamRoopItemPhotos([]);
                      setTamRoopPhotosFetchedForDbId(null);
                      setTamRoopViewerOpen(false);
                      setSaveError("");
                    }}
                    onAfterNameBlur={(uid, next) => {
                      if (!orderItemLabelContainsTamRoop(next) && tamRoopSheetUid === uid) closeTamRoopSheet();
                    }}
                  />
                  <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
                    <select
                      value={item.assignee || ""}
                      onChange={(e) => patchItem(item, { assignee: e.target.value })}
                      title={uiLang === "en" ? "Owner" : "พนักงาน"}
                      className={cn(
                        "h-10 min-h-[40px] w-[76px] min-w-[4.5rem] shrink-0 touch-manipulation rounded-full border-0 px-2 py-1.5 text-xs font-semibold shadow-sm outline-none ring-1 focus-visible:ring-2 sm:w-[88px]",
                        assigneeSelectSurfaceClasses(item.assignee || "")
                      )}
                    >
                      <option value="">—</option>
                      {assigneeSelectOptions(item.assignee).map((staffName) => (
                        <option key={staffName} value={staffName}>
                          {staffName}
                        </option>
                      ))}
                    </select>

                    {rowPol.arrivalDueDate ? (
                      <button
                        type="button"
                        onClick={() => {
                          void (async () => {
                            await flushPendingNotePersist(item.uid);
                            await flushPendingNamePersist(item.uid);
                            setDatePickerUid(item.uid);
                          })();
                        }}
                        className={cn(
                          "min-h-[36px] shrink-0 whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-medium touch-manipulation ring-1 sm:px-3",
                          (() => {
                            const tone = dueDateArrivalButtonTone(item.dueDate);
                            if (tone === "amber") return "bg-amber-200 text-amber-950 ring-amber-500/60";
                            if (tone === "red") return "bg-red-100 text-red-900 ring-red-500/60";
                            return "bg-sky-100 text-sky-800 ring-sky-400/40";
                          })()
                        )}
                      >
                        {item.dueDate
                          ? uiLang === "en"
                            ? `Due ${formatDateInput(item.dueDate)}`
                            : `มา ${formatDateInput(item.dueDate)}`
                          : uiLang === "en"
                            ? "Select date"
                            : "เลือกวันที่"}
                      </button>
                    ) : null}

                    {rowPol.storeDepositClock && storeCap !== null ? (
                      <span
                        className={cn(
                          "shrink-0 max-w-[9.5rem] truncate rounded-full px-2 py-1 text-[11px] font-semibold leading-tight ring-1 sm:max-w-[11rem]",
                          (() => {
                            const tone = storeDepositTone(item.clockStartYmd, storeCap);
                            if (tone === "amber") return "bg-amber-100 text-amber-950 ring-amber-400/50";
                            if (tone === "red") return "bg-red-100 text-red-900 ring-red-400/50";
                            return "bg-slate-200/90 text-slate-800 ring-slate-400/40";
                          })()
                        )}
                        title={
                          uiLang === "en"
                            ? `${storeCap}-day allowance (Bangkok calendar) from clock-start date stored on row`
                            : `นับ ${storeCap} วันปฏิทิน (เวลาไทย) จากวันที่ลงข้อมูลในระบบ`
                        }
                      >
                        {item.clockStartYmd ? `${formatDateInput(item.clockStartYmd)} · ` : ""}
                        {storeDepositRemainingLabel(item.clockStartYmd, storeCap)}
                      </span>
                    ) : null}

                    <div className="flex shrink-0 items-center gap-1">
                    <select
                      value={item.status}
                      onChange={(e) => updateStatus(item.uid, e.target.value)}
                      title={uiLang === "en" ? "Item status" : "สถานะรายการ"}
                      className={cn(
                        "h-10 min-h-[40px] w-[5.5rem] shrink-0 touch-manipulation rounded-full border-0 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 shadow-sm outline-none ring-1 ring-slate-200/80 sm:w-[6.25rem]",
                        isWaiting ? "text-amber-900" : "text-emerald-900"
                      )}
                    >
                      {statusOptionsForValue(item.status).map((st) => (
                        <option key={st} value={st}>
                          {statusLabelInCard(st)}
                        </option>
                      ))}
                      <option value={STATUS_ACTION_NOTE}>{uiLang === "en" ? "Note" : "หมายเหตุ"}</option>
                    </select>
                    {statusChangedElapsedLabel(item.statusChangedAtYmd) ? (
                      <span
                        className="shrink-0 rounded-full bg-slate-200/80 px-1.5 py-1 text-[10px] font-semibold leading-none text-slate-600 tabular-nums"
                        title={`เปลี่ยนสถานะล่าสุด ${formatDateInput(item.statusChangedAtYmd ?? "")}`}
                      >
                        {statusChangedElapsedLabel(item.statusChangedAtYmd)}
                      </span>
                    ) : null}
                    {slaExceededInStatus(item.statusChangedAtYmd, rowPol.slaMaxCalendarDaysInStatus) ? (
                      <span
                        className="shrink-0 rounded-full bg-rose-100 px-1.5 py-1 text-[10px] font-bold leading-none text-rose-800 ring-1 ring-rose-300/70"
                        title={
                          uiLang === "en"
                            ? `Over SLA (${rowPol.slaMaxCalendarDaysInStatus ?? "?"} calendar days since last status date)`
                            : `เกินขีด SLA (${rowPol.slaMaxCalendarDaysInStatus ?? "?"} วันปฏิทินนับจากวันเปลี่ยนสถานะ)`
                        }
                      >
                        SLA
                      </span>
                    ) : null}
                    </div>
                  </div>
                </div>

                {showNoteRow ? (
                  <div className="flex min-w-0 w-full flex-wrap items-center gap-1.5 border-t border-slate-200/70 pt-1.5">
                    <span className="shrink-0 rounded-full bg-white px-2 py-1 text-xs font-medium text-sky-800 ring-1 ring-sky-200/80">
                      {uiLang === "en" ? "Note" : "หมายเหตุ"}
                    </span>
                    <OrderItemNoteField
                      item={item}
                      uiLang={uiLang}
                      patchItem={patchItem}
                      flushPendingNotePersist={flushPendingNotePersist}
                      onTamRoopClick={(row) => {
                        void flushPendingNotePersist(row.uid);
                        void flushPendingNamePersist(row.uid);
                        setTamRoopSheetUid(row.uid);
                        setTamRoopItemPhotos([]);
                        setTamRoopPhotosFetchedForDbId(null);
                        setTamRoopViewerOpen(false);
                        setSaveError("");
                      }}
                      onTranslateCard={() => void translateCardItemsToEnglish()}
                      translateCardBusy={translateCardBusy}
                      translateCardDisabled={orderTaskIdsForCard.length === 0}
                    />
                    <button
                      type="button"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => {
                        void (async () => {
                          await flushPendingNamePersist(item.uid);
                          await flushPendingNotePersist(item.uid);
                        })();
                        setNoteOpenUid(null);
                      }}
                      className="shrink-0 rounded-full bg-slate-900 px-2.5 py-1 text-xs font-medium text-white"
                    >
                      {uiLang === "en" ? "Done" : "เสร็จ"}
                    </button>
                  </div>
                ) : null}
              </div>
              </div>

              <div className="mt-1 flex flex-wrap items-center justify-end gap-1 text-xs text-slate-500">
                {isSaving ? <span className="font-medium">{uiLang === "en" ? "Saving..." : "กำลังบันทึก…"}</span> : null}
              </div>
              </div>
            </div>
            {showInlineIntake
              ? inlineItems.filter((r) => r.insertAfterUid === item.uid).map((row) => renderInlineDraftCard(row))
              : null}
            </Fragment>
          );
        })}
        {showInlineIntake
          ? inlineItems.filter((r) => r.insertAfterUid === INLINE_INSERT_AFTER_END).map((row) => renderInlineDraftCard(row))
          : null}
        {saveError ? (
          isUnauthorizedApiError(saveError) ? (
            <p className="text-xs font-medium leading-snug text-rose-700">
              ยังไม่ได้เข้าสู่ระบบ — ต้องล็อกอินก่อนบันทึก{" "}
              <Link
                href={`/login?next=${encodeURIComponent(pathname)}`}
                className="font-semibold underline underline-offset-2"
              >
                เข้าสู่ระบบ
              </Link>
            </p>
          ) : (
            <p className="text-xs font-medium leading-snug text-rose-700">{uiLang === "en" ? "Save failed" : "บันทึกไม่สำเร็จ"}: {saveError}</p>
          )
        ) : null}
        {translationNotice ? (
          <p className="mt-1 text-xs font-medium leading-snug text-amber-900">{translationNotice}</p>
        ) : null}
        {toolbarLineFilterActive && itemsOutsideToolbarFilter.length > 0 ? (
          <button
            type="button"
            onClick={() => setToolbarOthersExpanded((v) => !v)}
            className={cn(
              "mt-2 w-full rounded-2xl py-3 text-sm font-medium transition-colors touch-manipulation",
              toolbarOthersExpanded ? "bg-slate-100 text-slate-700" : "bg-sky-100 text-sky-950 ring-1 ring-sky-300/60"
            )}
          >
            {toolbarOthersExpanded
              ? "แสดงเฉพาะงานตามตัวกรอง"
              : `ดูทั้งหมด (+${itemsOutsideToolbarFilter.length})`}
          </button>
        ) : null}
        {hiddenDoneItems.length > 0 && !showDoneRowsInMainList ? (
          <button
            type="button"
            onClick={() => setShowAllItems((v) => !v)}
            className={cn(
              "mt-2 w-full rounded-2xl py-3 text-sm font-medium transition-colors touch-manipulation",
              showAllItems ? "bg-slate-100 text-slate-700" : "bg-slate-200/70 text-slate-700"
            )}
          >
            {showAllItems ? "ซ่อนงานที่จบแล้ว" : `ดูทั้งหมด +${hiddenDoneItems.length}`}
          </button>
        ) : null}
      </div>

      {showInlineIntake && inlineItems.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {inlineMessage ? (
            isUnauthorizedApiError(inlineMessage) ? (
              <p className="text-xs font-medium leading-snug text-rose-700">
                ยังไม่ได้เข้าสู่ระบบ — ต้องล็อกอินก่อนบันทึก{" "}
                <Link
                  href={`/login?next=${encodeURIComponent(pathname)}`}
                  className="font-semibold underline underline-offset-2"
                >
                  เข้าสู่ระบบ
                </Link>
              </p>
            ) : (
              <p className="text-xs font-medium leading-snug text-rose-700">{inlineMessage}</p>
            )
          ) : null}
          <button
            type="button"
            onClick={() => void addInlineItemsToOrder()}
            disabled={inlineSaving || inlineRowSavingId !== null}
            className={cn(
              "h-10 w-full rounded-2xl text-sm font-semibold text-white touch-manipulation",
              inlineSaving || inlineRowSavingId !== null ? "bg-slate-400" : "bg-emerald-600"
            )}
          >
            {inlineSaving
              ? uiLang === "en"
                ? "Saving…"
                : "กำลังบันทึก…"
              : inlineRowSavingId !== null
                ? uiLang === "en"
                  ? "Saving row…"
                  : "กำลังบันทึกแถว…"
                : uiLang === "en"
                  ? "Add items to this car"
                  : "เพิ่มรายการเข้ารถคันนี้"}
          </button>
        </div>
      ) : null}

      {showInlineIntake ? (
        <div className="mt-2 rounded-2xl bg-slate-100 p-2">
          <textarea
            value={inlineText}
            onChange={(e) => setInlineText(e.target.value)}
            className="min-h-28 w-full rounded-2xl bg-white p-3 text-sm font-medium leading-relaxed text-slate-900 outline-none ring-1 ring-slate-200/80"
            placeholder={
              uiLang === "en"
                ? [
                    "Paste all LINE messages for this car here.",
                    'Then tap "AI Help" — the system strips vehicle headers/name tags and splits tasks automatically.',
                    "It also flags suspected duplicates (confirm duplicates yourself).",
                  ].join("\n")
                : [
                    "วางข้อความทั้งหมดจาก LINE ของรถคันนี้ได้เลย",
                    "แล้วกด “AI ช่วย” — ระบบจะตัดหัวรถ/แท็กชื่อ, แยกรายการงานให้อัตโนมัติ",
                    "และเทียบรายการที่คาดว่าซ้ำให้ (รายการที่คาดว่าซ้ำต้องติ๊กยืนยันเพิ่มเอง)",
                  ].join("\n")
            }
          />
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void aiAssistInlineText()}
              disabled={inlineAiBusy}
              className={cn(
                "h-11 flex-1 rounded-2xl text-sm font-semibold text-white touch-manipulation",
                inlineAiBusy ? "bg-slate-400" : "bg-indigo-600"
              )}
              title={
                uiLang === "en"
                  ? "Use AI to strip headers/tags and extract task lines"
                  : "ให้ AI ช่วยตัดหัวรถ/แท็ก และดึงรายการงาน"
              }
            >
              {inlineAiBusy
                ? uiLang === "en"
                  ? "AI working…"
                  : "AI กำลังช่วย…"
                : uiLang === "en"
                  ? "AI Help"
                  : "AI ช่วย"}
            </button>
            <button type="button" onClick={splitInlineTextRaw} className="h-11 flex-1 rounded-2xl bg-slate-950 text-sm font-semibold text-white touch-manipulation">
              {uiLang === "en" ? "Split into rows" : "แยกเป็นแถว"}
            </button>
            <button
              type="button"
              onClick={() => pushEmptyInlineItem()}
              className="h-11 flex-1 rounded-2xl border border-slate-300 bg-white text-sm font-semibold text-slate-800 touch-manipulation"
            >
              {uiLang === "en" ? "Add empty row" : "เพิ่มแถวว่าง"}
            </button>
          </div>
        </div>
      ) : null}

      {tamRoopSheetUid ? (
        <div
          ref={tamRoopOverlayRef}
          tabIndex={-1}
          role="presentation"
          aria-label={
            uiLang === "en"
              ? "Item photos — drag and drop on the backdrop or paste from clipboard"
              : "รูปตามรายการ — ลากวางทั้งพื้นหลังหรือวางจากคลิปบอร์ด"
          }
          className="fixed inset-0 z-[72] flex items-end justify-center bg-black/45 p-2 sm:p-3 outline-none"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeTamRoopSheet();
          }}
          onDragOver={onTamRoopSheetDragOver}
          onDrop={onTamRoopSheetDrop}
        >
          <div className="mb-[max(env(safe-area-inset-bottom),0px)] w-full max-w-md rounded-2xl bg-white p-4 shadow-xl ring-1 ring-slate-200/80">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <b className="text-sm font-semibold text-slate-950">{uiLang === "en" ? "Item Photos" : "รูปตามรายการ"}</b>
                <p className="mt-1 line-clamp-2 text-xs font-medium text-slate-600">
                  {formatTamRoopSheetItemSubtitle(tamRoopSheetItem ?? null, uiLang)}
                </p>
              </div>
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={closeTamRoopSheet}
                className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-800 touch-manipulation"
              >
                {uiLang === "en" ? "Close" : "ปิด"}
              </button>
            </div>
            {!canAttachPhotos ? (
              <p className="mb-3 text-xs font-medium text-amber-800">{uiLang === "en" ? "No car_row_id / car_id - cannot attach item photos" : "ไม่พบ car_row_id / car_id — แนบรูปตามรายการไม่ได้"}</p>
            ) : null}
            {canAttachPhotos && !String(tamRoopSheetItem?.id ?? "").trim() ? (
              <p className="mb-3 text-xs font-medium text-amber-800">
                {uiLang === "en"
                  ? "Save this item first to get system ID before attaching or loading item photos."
                  : "บันทึกรายการให้ได้รหัสจากระบบก่อน จึงจะแนบหรือโหลดรูปตามรายการได้"}
              </p>
            ) : null}
            <div className="mb-3">
              <label
                className={cn(
                  "inline-flex min-h-10 w-full cursor-pointer items-center justify-center rounded-xl px-3 text-xs font-semibold touch-manipulation",
                  photoBusy || !String(tamRoopSheetItem?.id ?? "").trim() || !canAttachPhotos
                    ? "cursor-not-allowed bg-slate-200 text-slate-500"
                    : "bg-sky-600 text-white"
                )}
              >
                {uiLang === "en" ? "Add photo" : "เพิ่มรูป"}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={photoBusy || !String(tamRoopSheetItem?.id ?? "").trim() || !canAttachPhotos}
                  className="hidden"
                  onChange={(e) => {
                    void uploadTamRoopItemPhotos(e.currentTarget.files);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            {String(tamRoopSheetItem?.id ?? "").trim() && canAttachPhotos ? (
              tamRoopLoadingPhotos && !tamRoopPhotosFetchedForDbId ? (
                <p className="mb-2 text-center text-xs font-medium text-slate-500">{uiLang === "en" ? "Loading photos..." : "กำลังโหลดรูป…"}</p>
              ) : tamRoopPhotosFetchedForDbId ? (
                tamRoopItemPhotos.length === 0 ? (
                  <p className="text-center text-xs font-medium text-slate-500">{uiLang === "en" ? "No photos yet - use Add photo" : "ยังไม่มีรูป — กดเพิ่มรูปได้"}</p>
                ) : (
                  <div className="flex max-h-48 gap-2 overflow-y-auto overflow-x-auto pb-1">
                    {tamRoopItemPhotos.map((p) => (
                      <div key={p.id} className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            const idx = tamRoopItemPhotos.findIndex((x) => x.id === p.id);
                            if (idx >= 0) {
                              setTamRoopViewerIndex(idx);
                              setTamRoopViewerOpen(true);
                            }
                          }}
                          className="block"
                        >
                          <Image
                            src={p.url}
                            alt={uiLang === "en" ? "Item photo thumbnail" : "รูปรายการ"}
                            width={112}
                            height={80}
                            sizes="112px"
                            loading="lazy"
                            className="h-20 w-28 rounded-lg object-cover ring-1 ring-slate-200/70"
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteTamRoopItemPhoto(p.id)}
                          disabled={photoBusy}
                          className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50"
                        >
                          {uiLang === "en" ? "Delete" : "ลบ"}
                        </button>
                      </div>
                    ))}
                  </div>
                )
              ) : null
            ) : null}
          </div>
        </div>
      ) : null}

      {tamRoopViewerOpen && tamRoopItemPhotos.length > 0 ? (
        <div className="fixed inset-0 z-[86] bg-black/90 p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-white">
              {uiLang === "en" ? "Item photo" : "รูปรายการ"} {tamRoopViewerIndex + 1}/{tamRoopItemPhotos.length}
            </span>
            <button
              type="button"
              onClick={() => setTamRoopViewerOpen(false)}
              className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white"
            >
              {uiLang === "en" ? "Close" : "ปิด"}
            </button>
          </div>
          <div
            ref={tamRoopViewerStripRef}
            className="flex h-[86vh] snap-x snap-mandatory overflow-x-auto touch-pan-x gap-2"
            style={{ scrollBehavior: "smooth" }}
            onScroll={(e) => {
              const el = e.currentTarget;
              const idx = Math.round(el.scrollLeft / Math.max(el.clientWidth, 1));
              if (idx !== tamRoopViewerIndex && idx >= 0 && idx < tamRoopItemPhotos.length) setTamRoopViewerIndex(idx);
            }}
          >
            {tamRoopItemPhotos.map((p) => (
              <div key={`tam-view-${p.id}`} className="relative h-full w-full shrink-0 snap-center">
                <Image
                  src={p.url}
                  alt={uiLang === "en" ? "Item photo full screen" : "รูปรายการเต็มจอ"}
                  fill
                  sizes="100vw"
                  loading="lazy"
                  className="object-contain"
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {datePickerUid ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3">
          <div className="w-full max-w-md rounded-2xl bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <b className="text-sm font-semibold text-slate-950">{uiLang === "en" ? "Select arrival date" : "เลือกวันที่ของมา"}</b>
              <button
                type="button"
                onClick={() => {
                  const uid = datePickerUid;
                  const el = uid ? (document.getElementById(`order-due-date-${uid}`) as HTMLInputElement | null) : null;
                  const v = el?.value?.trim() ?? "";
                  setDatePickerUid(null);
                  if (uid && v) handleDueDatePicked(uid, v);
                }}
                className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-800"
              >
                ปิด
              </button>
            </div>
            <input
              id={`order-due-date-${datePickerUid}`}
              key={datePickerUid}
              type="date"
              autoFocus
              defaultValue={(() => {
                const row = items.find((r) => r.uid === datePickerUid);
                const d = row?.dueDate?.trim();
                return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : "";
              })()}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value;
                if (v) handleDueDatePicked(datePickerUid, v);
              }}
              onChange={(e) => {
                const v = e.target.value;
                if (v) handleDueDatePicked(datePickerUid, v);
              }}
              className="h-12 w-full rounded-2xl bg-slate-100 px-3 text-base font-medium text-slate-900 outline-none"
            />
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function MobileOrderTrackingHome({
  carsData = [],
  orderItemsByCar = {},
  orderUpdatesByCar = {},
  saleStatusSummaryAllCars = null,
  summarySnapshotAllCars = null,
  disableDemoFallback = false,
  deferCarsHydration = false,
  dataWarnings = [],
  initialFocusedOrderId = null,
  shareBaseUrl = null,
  initialUiLang = "th",
}: MobileOrderTrackingHomeProps) {
  const router = useRouter();
  const pathname = usePathname() || "/m/orders";
  const searchParams = useSearchParams();
  const orderTrackingRootRef = useRef<HTMLDivElement | null>(null);
  const [ptrPullPx, setPtrPullPx] = useState(0);
  const [ptrRefreshing, setPtrRefreshing] = useState(false);
  const ptrArmRef = useRef(false);
  const ptrStartYRef = useRef(0);
  const ptrStartXRef = useRef(0);
  const ptrPullRef = useRef(0);
  const ptrRefreshingRef = useRef(false);
  const staffRosterPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staffRosterRef = useRef<string[]>([]);
  const saleAssigneesRef = useRef<Record<string, string>>({});
  const liveItemsToolbarSigRef = useRef<Record<string, string>>({});
  const [liveOrderItemsById, setLiveOrderItemsById] = useState<Record<string, OrderItem[]>>({});
  const hydratedOnceRef = useRef(false);

  useEffect(() => {
    if (!deferCarsHydration) return;
    if (hydratedOnceRef.current) return;
    const mode = String(searchParams?.get("load") ?? "").trim().toLowerCase();
    if (mode === "full") {
      hydratedOnceRef.current = true;
      return;
    }
    hydratedOnceRef.current = true;
    const p = new URLSearchParams(searchParams?.toString() ?? "");
    p.set("load", "full");
    const nextUrl = `${pathname}?${p.toString()}`;
    router.replace(nextUrl, { scroll: false });
    const fallbackTimer = window.setTimeout(() => {
      if (String(new URLSearchParams(window.location.search).get("load") ?? "").trim().toLowerCase() !== "full") {
        window.location.replace(nextUrl);
      }
    }, 1200);
    return () => {
      window.clearTimeout(fallbackTimer);
    };
  }, [deferCarsHydration, pathname, router, searchParams]);
  const suppressDataWarningsDuringDeferredHydration =
    deferCarsHydration && String(searchParams?.get("load") ?? "").trim().toLowerCase() !== "full";
  const isDeferredHydrationLoading =
    deferCarsHydration && String(searchParams?.get("load") ?? "").trim().toLowerCase() !== "full";
  const [deferredHydrationPercent, setDeferredHydrationPercent] = useState(8);

  useEffect(() => {
    if (!isDeferredHydrationLoading) {
      setDeferredHydrationPercent(100);
      return;
    }
    setDeferredHydrationPercent(8);
    const timer = window.setInterval(() => {
      setDeferredHydrationPercent((prev) => {
        if (prev >= 95) return prev;
        if (prev < 70) return prev + 6;
        if (prev < 85) return prev + 3;
        return prev + 1;
      });
    }, 140);
    return () => {
      window.clearInterval(timer);
    };
  }, [isDeferredHydrationLoading]);

  const handleOrderLiveItemsChange = React.useCallback((orderId: string, next: OrderItem[]) => {
    const sig = orderItemsLiveToolbarSignature(next);
    if (liveItemsToolbarSigRef.current[orderId] === sig) return;
    liveItemsToolbarSigRef.current[orderId] = sig;
    setLiveOrderItemsById((prev) => ({ ...prev, [orderId]: next }));
  }, []);

  useEffect(() => {
    liveItemsToolbarSigRef.current = {};
    setLiveOrderItemsById({});
  }, [carsData, orderItemsByCar]);

  const usingDemoFallback = !disableDemoFallback && carsData.length === 0;
  const mappedOrders = useMemo(() => {
    const base =
      !disableDemoFallback && carsData.length === 0
        ? ORDERS
        : carsData.map((car, index) => toOrderFromCar(car, index, orderItemsByCar, orderUpdatesByCar));
    return base.map((order) => {
      const live = liveOrderItemsById[order.id];
      return live ? { ...order, items: live } : order;
    });
  }, [carsData, orderItemsByCar, orderUpdatesByCar, liveOrderItemsById, disableDemoFallback]);
  const [saleFilters, setSaleFilters] = useState<Set<string>>(() => new Set());
  const [saleStatusFilters, setSaleStatusFilters] = useState<Set<SaleStatusFilterValue>>(() => new Set());
  const [vehicleSearch, setVehicleSearch] = useState("");
  const vehicleSearchForFiltering = useDebouncedValue(vehicleSearch, 120);
  const [translateAllBusy, setTranslateAllBusy] = useState(false);
  const [translateAllMessage, setTranslateAllMessage] = useState("");
  /** ห้ามอ่าน localStorage ใน initializer — SSR จะได้ภาษาเดียวกับไคลเอนต์รอบแรก (กัน hydration mismatch) */
  const [uiLang, setUiLang] = useState<UiLang>(initialUiLang);

  useEffect(() => {
    try {
      const saved = String(localStorage.getItem(ORDER_TRACKING_UI_LANG_STORAGE_KEY) ?? "").toLowerCase();
      if (saved === "en" || saved === "th") setUiLang(saved as UiLang);
    } catch {
      /* ignore */
    }
  }, []);
  const [itemStatusFilters, setItemStatusFilters] = useState<
    Set<ItemStatusFilterValue | typeof ITEM_STATUS_DUE_TODAY>
  >(() => new Set());
  const [staffFilters, setStaffFilters] = useState<Set<string>>(() => new Set());
  const [staffRoster, setStaffRoster] = useState<string[]>(() => []);
  const [saleAssignees, setSaleAssignees] = useState<Record<string, string>>(() =>
    typeof window !== "undefined" ? readSaleAssigneesFromStorage() : {}
  );
  const [staffNameInput, setStaffNameInput] = useState("");
  const [showStaffManager, setShowStaffManager] = useState(false);
  /** ลูกศรที่ชิป「รอส่ง」— ขยายแถวรอบส่ง (booked shipping) ลงมา */
  const [bookedShippingPanelExpanded, setBookedShippingPanelExpanded] = useState(false);
  const [bookedBuyerPanelExpanded, setBookedBuyerPanelExpanded] = useState(false);
  /** ลูกศรที่ชิป「ส่งแล้ว」— ขยายกรองตาม shipped / model year */
  const [shippedSoldExtrasPanelExpanded, setShippedSoldExtrasPanelExpanded] = useState(false);
  const [vacantSaleModelYearPanelExpanded, setVacantSaleModelYearPanelExpanded] = useState(false);
  const [itemStatusRoster, setItemStatusRoster] = useState<ItemStatusValue[]>(() => []);
  const [showStatusManager, setShowStatusManager] = useState(false);
  const [itemStatusLabels, setItemStatusLabels] = useState<ItemStatusLabelMap>({});
  const [itemStatusPoliciesNormalized, setItemStatusPoliciesNormalized] = useState<ItemStatusPoliciesNormalized>(() =>
    defaultItemStatusPoliciesNormalized()
  );
  const [visibleLimit, setVisibleLimit] = useState(ORDERS_PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollYRef = useRef<number | null>(null);
  /** ซ่อนชิปที่นับเป็น 0 เฉพาะตอนโหลดครั้งแรก — หลังล็อกแล้วชิปไม่หายเวลาเปลี่ยนสถานะในการ์ด */
  const staffChipsStickyAfterPrimeRef = useRef<Set<string> | null>(null);
  const itemStatusChipsStickyAfterPrimeRef = useRef<Set<ItemStatusValue> | null>(null);
  const [filterChipLayoutPrimed, setFilterChipLayoutPrimed] = useState(false);
  /** true = แตะชิปซ้ำเพื่อสะสมหลายชิปต่อแถว · false = เลือกได้ทีละหนึ่งชิปต่อแถว (แตะซ้ำยกเลิก) */
  const [filterChipMultiSelect, setFilterChipMultiSelect] = useState(true);
  const prevFilterChipMultiSelectRef = useRef(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(ORDER_TRACKING_UI_LANG_STORAGE_KEY, uiLang);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = uiLang;
    document.body.dataset.uiLang = uiLang;
    void fetch("/api/ui-locale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: uiLang }),
      keepalive: true,
    }).catch(() => {
      /* ignore network error */
    });
  }, [uiLang]);

  const translateAllLegacyItems = React.useCallback(async () => {
    if (translateAllBusy) return;
    setTranslateAllBusy(true);
    setTranslateAllMessage("");
    try {
      const res = await fetch(ORDER_ITEMS_TRANSLATE_ALL_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 1200, force: true }),
      });
      const payload = (await res.json()) as {
        error?: string;
        scanned?: number;
        updated?: number;
        remainingHint?: boolean;
      };
      if (!res.ok) throw new Error(payload.error ?? res.statusText);
      const scanned = Number(payload.scanned ?? 0);
      const updated = Number(payload.updated ?? 0);
      const tail = payload.remainingHint
        ? (uiLang === "en" ? " (run again for more)" : " (กดซ้ำเพื่อแปลต่อ)")
        : "";
      setTranslateAllMessage(
        uiLang === "en"
          ? `Re-translated ${updated}/${scanned} rows (names + Thai notes)${tail}`
          : `แปลใหม่แล้ว ${updated}/${scanned} แถว (ชื่อ + หมายเหตุไทย)${tail}`
      );
      router.refresh();
    } catch (e) {
      setTranslateAllMessage(
        `${uiLang === "en" ? "Batch translate failed" : "แปลแบบกลุ่มไม่สำเร็จ"}: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setTranslateAllBusy(false);
    }
  }, [router, translateAllBusy, uiLang]);

  const saleCounts = useMemo(() => {
    const useSummaryCacheBase =
      Boolean(summarySnapshotAllCars) &&
      saleFilters.size === 0 &&
      saleStatusFilters.size === 0 &&
      staffFilters.size === 0 &&
      itemStatusFilters.size === 0 &&
      vehicleSearchForFiltering.trim() === "";
    if (useSummaryCacheBase && summarySnapshotAllCars) {
      const acc: Record<string, number> = {};
      for (const s of ALL_SALES) {
        if (s === "ALL") acc[s] = Number(summarySnapshotAllCars.totalOrders ?? 0);
        else acc[s] = Number(summarySnapshotAllCars.saleCodeCounts?.[s] ?? 0);
      }
      return acc;
    }
    const acc: Record<string, number> = { ALL: mappedOrders.length };
    for (const s of ALL_SALES) {
      if (s !== "ALL") acc[s] = 0;
    }
    for (const order of mappedOrders) {
      const sale = String(order.sale).toUpperCase();
      if (sale in acc) acc[sale] += 1;
    }
    return acc;
  }, [mappedOrders, summarySnapshotAllCars, saleFilters, saleStatusFilters, staffFilters, itemStatusFilters, vehicleSearchForFiltering]);
  /** ชิปเซลล์: ALL อยู่แรกเสมอ ที่เหลือเรียงตามจำนวนจากมากไปน้อย */
  const salesChipsOrdered = useMemo(() => {
    const rest = ALL_SALES.filter((sale) => sale !== "ALL" && (saleCounts[sale] ?? 0) > 0);
    rest.sort((a, b) => {
      const diff = (saleCounts[b] ?? 0) - (saleCounts[a] ?? 0);
      return diff !== 0 ? diff : String(a).localeCompare(String(b), "en", { sensitivity: "base" });
    });
    return ["ALL", ...rest] as const;
  }, [saleCounts]);

  /** จำนวนรายการต่อ assignee — ขอบเขตเหมือนชิปสถานะรายการ (ไม่กรองตามพนักงาน) */
  const staffAssigneeItemCounts = useMemo(() => {
    const useSummaryCacheBase =
      Boolean(summarySnapshotAllCars) &&
      saleFilters.size === 0 &&
      saleStatusFilters.size === 0 &&
      staffFilters.size === 0 &&
      itemStatusFilters.size === 0 &&
      vehicleSearchForFiltering.trim() === "";
    if (useSummaryCacheBase && summarySnapshotAllCars) {
      const from = summarySnapshotAllCars.staffItemCounts ?? {};
      const unassigned = Number(from["ไม่ระบุชื่อ"] ?? 0);
      const byAssignee: Record<string, number> = {};
      for (const [k, v] of Object.entries(from)) {
        if (k === "ไม่ระบุชื่อ") continue;
        byAssignee[k] = Number(v ?? 0);
      }
      return {
        grandTotal: Number(summarySnapshotAllCars.totalItems ?? 0),
        byAssignee,
        unassigned,
      };
    }
    const baseFiltered = mappedOrders.filter((order) => {
      const saleOk = orderMatchesSaleFilters(order, saleFilters);
      const saleStatusOk = orderMatchesSaleStatusFilters(order, saleStatusFilters);
      const vehicleOk = matchesVehicleSearch(order, vehicleSearchForFiltering);
      return saleOk && saleStatusOk && vehicleOk;
    });
    const byAssignee: Record<string, number> = {};
    let grandTotal = 0;
    let unassigned = 0;
    for (const order of baseFiltered) {
      for (const item of order.items) {
        grandTotal += 1;
        const a = String(item.assignee ?? "").trim();
        if (a) byAssignee[a] = (byAssignee[a] ?? 0) + 1;
        else unassigned += 1;
      }
    }
    return { grandTotal, byAssignee, unassigned };
  }, [mappedOrders, saleFilters, saleStatusFilters, vehicleSearchForFiltering, staffFilters, itemStatusFilters, summarySnapshotAllCars]);

  /** รอบส่ง (ค่า booked_shipping) ต่อกลุ่ม — สถานะขาย รอส่ง เท่านั้น */
  const bookedShippingRounds = useMemo(() => {
    const baseFiltered = mappedOrders.filter((order) => {
      const saleOk = orderMatchesSaleFilters(order, saleFilters);
      const saleStatusOk = orderMatchesSaleStatusFilters(order, saleStatusFilters);
      const vehicleOk = matchesVehicleSearch(order, vehicleSearchForFiltering);
      return saleOk && saleStatusOk && vehicleOk;
    });
    const byKey = new Map<string, { label: string; count: number }>();
    for (const order of baseFiltered) {
      if (order.saleStatus !== "รอส่ง") continue;
      const raw = String(order.ship ?? "").trim();
      if (!raw) continue;
      const key = shipGroupKey(raw);
      const prev = byKey.get(key);
      if (!prev) byKey.set(key, { label: raw, count: 1 });
      else prev.count += 1;
    }
    const rounds: { key: string; label: string; token: string; count: number }[] = [];
    byKey.forEach((v, key) => {
      rounds.push({ key, label: v.label, token: bookedShipFilterTokenFromKey(key), count: v.count });
    });
    rounds.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "th", { sensitivity: "base" }));
    return rounds;
  }, [mappedOrders, saleFilters, saleStatusFilters, vehicleSearchForFiltering]);

  /** ชื่อลูกค้า (buyer) ต่อกลุ่ม — สถานะขาย จอง เท่านั้น */
  const bookedBuyerRounds = useMemo(() => {
    const baseFiltered = mappedOrders.filter((order) => {
      const saleOk = orderMatchesSaleFilters(order, saleFilters);
      const saleStatusOk = orderMatchesSaleStatusFilters(order, saleStatusFilters);
      const vehicleOk = matchesVehicleSearch(order, vehicleSearchForFiltering);
      return saleOk && saleStatusOk && vehicleOk;
    });
    const byKey = new Map<string, { label: string; count: number }>();
    for (const order of baseFiltered) {
      if (order.saleStatus !== "จอง") continue;
      const raw = String(order.buyer ?? "").trim();
      if (!raw || raw === "-") continue;
      const key = buyerGroupKey(raw);
      const prev = byKey.get(key);
      if (!prev) byKey.set(key, { label: raw, count: 1 });
      else prev.count += 1;
    }
    const rounds: { key: string; label: string; token: string; count: number }[] = [];
    byKey.forEach((v, key) => {
      rounds.push({ key, label: v.label, token: bookedBuyerFilterTokenFromKey(key), count: v.count });
    });
    rounds.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "th", { sensitivity: "base" }));
    return rounds;
  }, [mappedOrders, saleFilters, saleStatusFilters, vehicleSearchForFiltering]);

  /** ส่งแล้ว: นับตาม shipped (cars.shipped) และ model year — ไม่กรองตาม staff */
  const shippedSoldToolbarStats = useMemo(() => {
    const baseFiltered = mappedOrders.filter((order) => {
      const saleOk = orderMatchesSaleFilters(order, saleFilters);
      const saleStatusOk = orderMatchesSaleStatusFilters(order, saleStatusFilters);
      const vehicleOk = matchesVehicleSearch(order, vehicleSearchForFiltering);
      return saleOk && saleStatusOk && vehicleOk;
    });
    let soldCount = 0;
    let shippedEmpty = 0;
    const shippedMap = new Map<string, { label: string; count: number }>();
    let modelYearEmpty = 0;
    const modelYearMap = new Map<string, { label: string; count: number }>();
    for (const order of baseFiltered) {
      if (order.saleStatus !== "ส่งแล้ว") continue;
      soldCount += 1;
      const sh = String(order.shipped ?? "").trim();
      if (!sh) shippedEmpty += 1;
      else {
        const k = soldShippedLineGroupKey(sh);
        const prev = shippedMap.get(k);
        if (!prev) shippedMap.set(k, { label: sh, count: 1 });
        else prev.count += 1;
      }
      const my = String(order.modelYear ?? "").trim();
      if (!my) modelYearEmpty += 1;
      else {
        const k = soldModelYearGroupKey(my);
        const prev = modelYearMap.get(k);
        if (!prev) modelYearMap.set(k, { label: my, count: 1 });
        else prev.count += 1;
      }
    }
    const shippedRounds: { key: string; label: string; token: string; count: number }[] = [];
    shippedMap.forEach((v, key) => {
      shippedRounds.push({ key, label: v.label, token: soldShippedLineTokenFromKey(key), count: v.count });
    });
    shippedRounds.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "th", { sensitivity: "base" }));
    const modelYearRounds: { key: string; label: string; token: string; count: number }[] = [];
    modelYearMap.forEach((v, key) => {
      modelYearRounds.push({ key, label: v.label, token: soldModelYearTokenFromKey(key), count: v.count });
    });
    modelYearRounds.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "th", { sensitivity: "base" }));
    return { soldCount, shippedEmpty, shippedRounds, modelYearEmpty, modelYearRounds };
  }, [mappedOrders, saleFilters, saleStatusFilters, vehicleSearchForFiltering]);

  /** สถานะขาย ว่าง: นับตาม model year */
  const vacantSaleToolbarStats = useMemo(() => {
    const baseFiltered = mappedOrders.filter((order) => {
      const saleOk = orderMatchesSaleFilters(order, saleFilters);
      const saleStatusOk = orderMatchesSaleStatusFilters(order, saleStatusFilters);
      const vehicleOk = matchesVehicleSearch(order, vehicleSearchForFiltering);
      return saleOk && saleStatusOk && vehicleOk;
    });
    let vacantCount = 0;
    let modelYearEmpty = 0;
    const modelYearMap = new Map<string, { label: string; count: number }>();
    for (const order of baseFiltered) {
      if (order.saleStatus !== "ว่าง") continue;
      vacantCount += 1;
      const my = String(order.modelYear ?? "").trim();
      if (!my) modelYearEmpty += 1;
      else {
        const k = soldModelYearGroupKey(my);
        const prev = modelYearMap.get(k);
        if (!prev) modelYearMap.set(k, { label: my, count: 1 });
        else prev.count += 1;
      }
    }
    const modelYearRounds: { key: string; label: string; token: string; count: number }[] = [];
    modelYearMap.forEach((v, key) => {
      modelYearRounds.push({ key, label: v.label, token: vacantSaleModelYearTokenFromKey(key), count: v.count });
    });
    modelYearRounds.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "th", { sensitivity: "base" }));
    return { vacantCount, modelYearEmpty, modelYearRounds };
  }, [mappedOrders, saleFilters, saleStatusFilters, vehicleSearchForFiltering]);

  const soldShippedDimActive = useMemo(() => {
    for (const f of Array.from(staffFilters)) if (isSoldShippedStaffFilter(f)) return true;
    return false;
  }, [staffFilters]);
  const soldModelYearDimActive = useMemo(() => {
    for (const f of Array.from(staffFilters)) if (isSoldModelYearStaffFilter(f)) return true;
    return false;
  }, [staffFilters]);
  const vacantSaleModelYearDimActive = useMemo(() => {
    for (const f of Array.from(staffFilters)) if (isVacantSaleModelYearStaffFilter(f)) return true;
    return false;
  }, [staffFilters]);

  /** ชิปกรอง: roster จากเซิร์ฟเวอร์ + assignee จากข้อมูลที่ยังไม่อยู่ใน roster — ไม่ให้หน้าเว็บว่างเมื่อยังไม่เคยเปิดจัดการพนักงาน */
  const staffFilterChipNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (raw: string) => {
      const t = raw.trim();
      if (!t || seen.has(t) || isStaffRosterNameExcluded(t)) return;
      seen.add(t);
      out.push(t);
    };
    for (const n of staffRoster) push(n);
    const fromData = Object.keys(staffAssigneeItemCounts.byAssignee);
    fromData.sort((a, b) => {
      const ca = staffAssigneeItemCounts.byAssignee[a] ?? 0;
      const cb = staffAssigneeItemCounts.byAssignee[b] ?? 0;
      if (cb !== ca) return cb - ca;
      return a.localeCompare(b, "en", { sensitivity: "base" });
    });
    for (const n of fromData) push(n);
    return out;
  }, [staffRoster, staffAssigneeItemCounts]);

  /** ชิปพนักงานที่แสดง — ซ่อนเมื่อจำนวนรายการ = 0 */
  const staffFilterChipNamesVisible = useMemo(
    () => staffFilterChipNames.filter((s) => (staffAssigneeItemCounts.byAssignee[s] ?? 0) > 0),
    [staffFilterChipNames, staffAssigneeItemCounts]
  );

  const flushItemStatusPrefsToServer = React.useCallback(
    async (roster: ItemStatusValue[], labels: ItemStatusLabelMap, policiesSparse: Record<string, unknown>) => {
      try {
        const res = await fetch(ITEM_STATUS_PREFS_API_PATH, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roster, labels, policies: policiesSparse }),
          cache: "no-store",
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    []
  );

  const persistItemStatusPrefs = React.useCallback(
    (roster: ItemStatusValue[], labels: ItemStatusLabelMap, policiesNorm: ItemStatusPoliciesNormalized) => {
      const policiesSparse = normalizedItemPoliciesToStoredJson(policiesNorm);
      writeItemStatusRosterToStorage(roster);
      writeItemStatusLabelsToStorage(labels);
      writeItemStatusPoliciesSparseToStorage(policiesSparse);
      void flushItemStatusPrefsToServer(roster, labels, policiesSparse);
    },
    [flushItemStatusPrefsToServer]
  );

  const flushStaffRosterToServer = React.useCallback(
    async (names: string[], sale_assignees: Record<string, string>) => {
      try {
        const res = await fetch(STAFF_ROSTER_API_PATH, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ names, sale_assignees }),
          cache: "no-store",
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    []
  );

  const scheduleStaffRosterPersist = React.useCallback(
    (names: string[], sale_assignees: Record<string, string>) => {
      writeStaffRosterToStorage(names);
      writeSaleAssigneesToStorage(sale_assignees);
      if (staffRosterPersistTimerRef.current) clearTimeout(staffRosterPersistTimerRef.current);
      staffRosterPersistTimerRef.current = setTimeout(() => {
        staffRosterPersistTimerRef.current = null;
        void flushStaffRosterToServer(names, sale_assignees);
      }, 450);
    },
    [flushStaffRosterToServer]
  );

  useLayoutEffect(() => {
    staffRosterRef.current = staffRoster;
  }, [staffRoster]);

  useLayoutEffect(() => {
    saleAssigneesRef.current = saleAssignees;
  }, [saleAssignees]);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;

    (async () => {
      const local = readStaffRosterFromStorage();
      const localAssignees = readSaleAssigneesFromStorage();
      try {
        const res = await fetch(STAFF_ROSTER_API_PATH, { cache: "no-store", signal: ac.signal });
        const json = (await res.json()) as {
          names?: unknown;
          sale_assignees?: unknown;
          error?: string;
        };
        if (cancelled) return;
        const serverNames = normalizeStaffRosterNames(json.names);
        const serverAssigneesMap = normalizeSaleAssigneesMap(json.sale_assignees);
        const serverHasAssignees = Object.keys(serverAssigneesMap).length > 0;
        const mergedAssignees = (
          serverHasAssignees ? serverAssigneesMap : normalizeSaleAssigneesMap(localAssignees)
        ) as Record<string, string>;

        if (!res.ok) {
          if (res.status === 503) {
            setStaffRoster(local);
            setSaleAssignees(normalizeSaleAssigneesMap(localAssignees) as Record<string, string>);
            return;
          }
          setStaffRoster(local.length ? local : serverNames);
          setSaleAssignees(
            (Object.keys(localAssignees).length > 0
              ? normalizeSaleAssigneesMap(localAssignees)
              : serverHasAssignees
                ? serverAssigneesMap
                : {}) as Record<string, string>
          );
          return;
        }

        if (serverNames.length === 0 && local.length > 0) {
          const seedAssignees = normalizeSaleAssigneesMap(localAssignees) as Record<string, string>;
          try {
            await fetch(STAFF_ROSTER_API_PATH, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ names: local, sale_assignees: seedAssignees }),
              cache: "no-store",
              signal: ac.signal,
            });
          } catch {
            /* ignore */
          }
          if (!cancelled) {
            setStaffRoster(local);
            setSaleAssignees(seedAssignees);
            writeStaffRosterToStorage(local);
            writeSaleAssigneesToStorage(seedAssignees);
          }
          return;
        }

        if (!cancelled) {
          setStaffRoster(serverNames);
          setSaleAssignees(mergedAssignees);
          writeStaffRosterToStorage(serverNames);
          writeSaleAssigneesToStorage(mergedAssignees);

          if (
            serverNames.length > 0 &&
            !serverHasAssignees &&
            Object.keys(normalizeSaleAssigneesMap(localAssignees)).length > 0
          ) {
            try {
              await fetch(STAFF_ROSTER_API_PATH, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ names: serverNames, sale_assignees: mergedAssignees }),
                cache: "no-store",
                signal: ac.signal,
              });
            } catch {
              /* ignore */
            }
          }
        }
      } catch {
        if (!cancelled) {
          setStaffRoster(readStaffRosterFromStorage());
          setSaleAssignees(readSaleAssigneesFromStorage());
        }
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;

    (async () => {
      const localRoster = readItemStatusRosterFromStorage();
      const localLabels = readItemStatusLabelsFromStorage();
      const localPn = readItemStatusPoliciesFromStorageNormalized() ?? defaultItemStatusPoliciesNormalized();
      const localPnSparse = normalizedItemPoliciesToStoredJson(localPn);
      try {
        const res = await fetch(ITEM_STATUS_PREFS_API_PATH, { cache: "no-store", signal: ac.signal });
        const json = (await res.json()) as { roster?: unknown; labels?: unknown; policies?: unknown };
        if (cancelled) return;

        const serverRoster = normalizeItemStatusRoster(json.roster);
        const mergedRoster = serverRoster;
        const serverLabels = normalizeItemStatusLabels(json.labels);
        const serverPn = normalizeItemStatusPoliciesRaw(json.policies);
        const serverPnSparse = normalizedItemPoliciesToStoredJson(serverPn);
        const defaultPnSparse = "{}";

        if (!res.ok) {
          if (res.status === 503) {
            setItemStatusRoster(localRoster);
            setItemStatusLabels(localLabels);
            setItemStatusPoliciesNormalized(localPn);
            return;
          }
          setItemStatusRoster(localRoster.length ? localRoster : mergedRoster);
          setItemStatusLabels(Object.keys(localLabels).length ? localLabels : serverLabels);
          setItemStatusPoliciesNormalized(localPn);
          return;
        }

        const serverHasCustom =
          serverRoster.length > 0 || Object.keys(serverLabels).length > 0 || JSON.stringify(serverPnSparse) !== defaultPnSparse;
        const localHasCustom =
          (localRoster.length > 0 && localRoster.join("|") !== ITEM_STATUS_ORDER.join("|")) ||
          Object.keys(localLabels).length > 0 ||
          JSON.stringify(localPnSparse) !== defaultPnSparse;
        if (!serverHasCustom && localHasCustom) {
          try {
            await fetch(ITEM_STATUS_PREFS_API_PATH, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                roster: localRoster,
                labels: localLabels,
                policies: localPnSparse,
              }),
              cache: "no-store",
              signal: ac.signal,
            });
          } catch {
            /* ignore */
          }
          if (!cancelled) {
            setItemStatusRoster(localRoster);
            setItemStatusLabels(localLabels);
            setItemStatusPoliciesNormalized(localPn);
            writeItemStatusRosterToStorage(localRoster);
            writeItemStatusLabelsToStorage(localLabels);
            writeItemStatusPoliciesSparseToStorage(localPnSparse);
          }
          return;
        }

        if (!cancelled) {
          setItemStatusRoster(mergedRoster);
          setItemStatusLabels(serverLabels);
          setItemStatusPoliciesNormalized(serverPn);
          writeItemStatusRosterToStorage(mergedRoster);
          writeItemStatusLabelsToStorage(serverLabels);
          writeItemStatusPoliciesSparseToStorage(serverPnSparse);
        }
      } catch {
        if (!cancelled) {
          setItemStatusRoster(localRoster);
          setItemStatusLabels(localLabels);
          setItemStatusPoliciesNormalized(localPn);
        }
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (staffRosterPersistTimerRef.current) clearTimeout(staffRosterPersistTimerRef.current);
    };
  }, []);

  const addStaffToRoster = React.useCallback(
    (name: string) => {
      const t = name.trim();
      if (!t || isStaffRosterNameExcluded(t)) return;
      setStaffRoster((prev) => {
        if (prev.includes(t)) return prev;
        const next = [...prev, t];
        scheduleStaffRosterPersist(next, saleAssigneesRef.current);
        return next;
      });
    },
    [scheduleStaffRosterPersist]
  );

  const removeStaffFromRoster = React.useCallback(
    (name: string) => {
      setStaffRoster((prev) => {
        const nextNames = prev.filter((n) => n !== name);
        setSaleAssignees((prevMap) => {
          const cleaned = { ...prevMap };
          for (const k of Object.keys(cleaned)) {
            if (cleaned[k] === name) delete cleaned[k];
          }
          const nextAssignees = normalizeSaleAssigneesMap(cleaned) as Record<string, string>;
          scheduleStaffRosterPersist(nextNames, nextAssignees);
          return nextAssignees;
        });
        return nextNames;
      });
    },
    [scheduleStaffRosterPersist]
  );

  const setSaleAssigneeForCode = React.useCallback(
    (saleCode: string, assigneeName: string) => {
      setSaleAssignees((prev) => {
        const next = { ...prev };
        const t = assigneeName.trim();
        if (!t) delete next[saleCode];
        else next[saleCode] = t;
        const normalized = normalizeSaleAssigneesMap(next) as Record<string, string>;
        scheduleStaffRosterPersist(staffRosterRef.current, normalized);
        return normalized;
      });
    },
    [scheduleStaffRosterPersist]
  );

  const addableItemStatuses = useMemo(() => {
    if (itemStatusRoster.length === 0) return [...ITEM_STATUSES];
    return ITEM_STATUSES.filter((s) => !itemStatusRoster.includes(s));
  }, [itemStatusRoster]);

  const itemStatusRosterEffective = useMemo(
    () => effectiveItemStatusRoster(itemStatusRoster),
    [itemStatusRoster]
  );

  const addItemStatusToRoster = React.useCallback(
    (st: ItemStatusValue) => {
      setItemStatusRoster((prev) => {
        if (prev.includes(st)) return prev;
        const next = [...prev, st];
        persistItemStatusPrefs(next, itemStatusLabels, itemStatusPoliciesNormalized);
        return next;
      });
    },
    [itemStatusLabels, itemStatusPoliciesNormalized, persistItemStatusPrefs]
  );

  const removeItemStatusFromRoster = React.useCallback(
    (st: ItemStatusValue) => {
      setItemStatusRoster((prev) => {
        const next = prev.filter((x) => x !== st);
        const fallback = next.length ? next : [];
        persistItemStatusPrefs(fallback, itemStatusLabels, itemStatusPoliciesNormalized);
        return fallback;
      });
    },
    [itemStatusLabels, itemStatusPoliciesNormalized, persistItemStatusPrefs]
  );

  const moveItemStatusInRoster = React.useCallback(
    (st: ItemStatusValue, direction: -1 | 1) => {
      setItemStatusRoster((prev) => {
        const idx = prev.indexOf(st);
        if (idx < 0) return prev;
        const to = idx + direction;
        if (to < 0 || to >= prev.length) return prev;
        const next = [...prev];
        const [taken] = next.splice(idx, 1);
        next.splice(to, 0, taken);
        persistItemStatusPrefs(next, itemStatusLabels, itemStatusPoliciesNormalized);
        return next;
      });
    },
    [itemStatusLabels, itemStatusPoliciesNormalized, persistItemStatusPrefs]
  );

  const updateItemStatusLabel = React.useCallback(
    (st: ItemStatusValue, nextLabel: string) => {
      setItemStatusLabels((prev) => {
        const trimmed = nextLabel.trim();
        const next = { ...prev };
        if (!trimmed || trimmed === st) delete next[st];
        else next[st] = trimmed;
        persistItemStatusPrefs(itemStatusRoster, next, itemStatusPoliciesNormalized);
        return next;
      });
    },
    [itemStatusRoster, itemStatusPoliciesNormalized, persistItemStatusPrefs]
  );

  const patchItemStatusPolicy = React.useCallback(
    (code: ItemStatusValue, patch: Partial<ResolvedItemRowStatusPolicy>) => {
      setItemStatusPoliciesNormalized((prev) => {
        const row = prev.byStatus[code];
        const next: ItemStatusPoliciesNormalized = {
          ...prev,
          byStatus: {
            ...prev.byStatus,
            [code]: { ...row, ...patch },
          },
        };
        persistItemStatusPrefs(itemStatusRoster, itemStatusLabels, next);
        return next;
      });
    },
    [itemStatusLabels, itemStatusRoster, persistItemStatusPrefs]
  );

  const toggleDueTodayPolicyStatus = React.useCallback(
    (st: ItemStatusValue) => {
      setItemStatusPoliciesNormalized((prev) => {
        const cur = new Set(prev.dueToday.statuses);
        if (cur.has(st)) cur.delete(st);
        else cur.add(st);
        const next: ItemStatusPoliciesNormalized = {
          ...prev,
          dueToday: { ...prev.dueToday, statuses: Array.from(cur) },
        };
        persistItemStatusPrefs(itemStatusRoster, itemStatusLabels, next);
        return next;
      });
    },
    [itemStatusLabels, itemStatusRoster, persistItemStatusPrefs]
  );

  const setDueTodayPolicyMatchDays = React.useCallback(
    (raw: string) => {
      const parsed = Number(String(raw).trim());
      setItemStatusPoliciesNormalized((prev) => {
        const matchDaysUntilDueBangkok = Number.isFinite(parsed)
          ? Math.min(730, Math.max(-730, Math.round(parsed)))
          : prev.dueToday.matchDaysUntilDueBangkok;
        const next: ItemStatusPoliciesNormalized = {
          ...prev,
          dueToday: { ...prev.dueToday, matchDaysUntilDueBangkok },
        };
        persistItemStatusPrefs(itemStatusRoster, itemStatusLabels, next);
        return next;
      });
    },
    [itemStatusLabels, itemStatusRoster, persistItemStatusPrefs]
  );

  const statusLabel = React.useCallback(
    (st: ItemStatusFilterValue): string => {
      if (st === ITEM_STATUS_DUE_TODAY) return uiLang === "en" ? "Due today" : ITEM_STATUS_DUE_TODAY;
      if (uiLang === "en") {
        return displayItemStatusLabel(st, uiLang);
      }
      const custom = itemStatusLabels[st];
      if (custom && custom !== st) return custom;
      return displayItemStatusLabel(st, uiLang);
    },
    [itemStatusLabels, uiLang]
  );

  const staffFilterChipNamesForToolbar = useMemo(() => {
    const sticky = staffChipsStickyAfterPrimeRef.current;
    if (!filterChipLayoutPrimed || !sticky) {
      return staffFilterChipNamesVisible;
    }
    return staffFilterChipNames.filter(
      (s) => sticky.has(s) || (staffAssigneeItemCounts.byAssignee[s] ?? 0) > 0
    );
  }, [filterChipLayoutPrimed, staffFilterChipNames, staffFilterChipNamesVisible, staffAssigneeItemCounts]);

  /** สีชิปพนักงานในแถบ — ไม่ให้ซ้ำในรายการที่ขึ้นพร้อมกัน (ยังใช้แฮชชื่อเมื่อชิปบนการ์ด) */
  const staffToolbarAssigneePaletteIndexByName = useMemo(
    () => buildStaffToolbarAssigneePaletteIndexMap(staffFilterChipNamesForToolbar),
    [staffFilterChipNamesForToolbar]
  );

  /** แสดงชิป "ไม่ระบุชื่อ" — ซ่อนเมื่อนับ 0 ยกเว้นหลังล็อก sticky หรือกำลังเลือกชิปนี้ */
  const staffUnassignedChipInToolbar = useMemo(() => {
    if (staffFilters.has(STAFF_FILTER_UNASSIGNED)) return true;
    const sticky = staffChipsStickyAfterPrimeRef.current;
    if (!filterChipLayoutPrimed || !sticky) {
      return (staffAssigneeItemCounts.unassigned ?? 0) > 0;
    }
    return sticky.has(STAFF_FILTER_UNASSIGNED) || (staffAssigneeItemCounts.unassigned ?? 0) > 0;
  }, [filterChipLayoutPrimed, staffFilters, staffAssigneeItemCounts.unassigned]);

  useEffect(() => {
    setStaffFilters((prev) => {
      const validShip = new Set(bookedShippingRounds.map((r) => r.token));
      const validBuyer = new Set(bookedBuyerRounds.map((r) => r.token));
      const validSoldShip = new Set(shippedSoldToolbarStats.shippedRounds.map((r) => r.token));
      const validSoldMy = new Set(shippedSoldToolbarStats.modelYearRounds.map((r) => r.token));
      const validVacMy = new Set(vacantSaleToolbarStats.modelYearRounds.map((r) => r.token));
      const next = new Set<string>();
      for (const f of Array.from(prev)) {
        if (f === STAFF_FILTER_UNASSIGNED) next.add(f);
        else if (f === STAFF_FILTER_BOOKED_SHIPPING) {
          /* ไม่เก็บ legacy — ผู้ใช้เลือกชิปต่อรอบแทน */
        } else if (f.startsWith(STAFF_FILTER_BOOKED_SHIP_PREFIX)) {
          if (validShip.has(f)) next.add(f);
        } else if (f.startsWith(STAFF_FILTER_BOOKED_BUYER_PREFIX)) {
          if (validBuyer.has(f)) next.add(f);
        } else if (f === STAFF_FILTER_SOLD_SHIPPED_EMPTY) {
          if (shippedSoldToolbarStats.shippedEmpty > 0) next.add(f);
        } else if (f.startsWith(STAFF_FILTER_SOLD_SHIPPED_PREFIX)) {
          if (validSoldShip.has(f)) next.add(f);
        } else if (f === STAFF_FILTER_SOLD_MODEL_YEAR_EMPTY) {
          if (shippedSoldToolbarStats.modelYearEmpty > 0) next.add(f);
        } else if (f.startsWith(STAFF_FILTER_SOLD_MODEL_YEAR_PREFIX)) {
          if (validSoldMy.has(f)) next.add(f);
        } else if (f === STAFF_FILTER_VACANT_MODEL_YEAR_EMPTY) {
          if (vacantSaleToolbarStats.modelYearEmpty > 0) next.add(f);
        } else if (f.startsWith(STAFF_FILTER_VACANT_MODEL_YEAR_PREFIX)) {
          if (validVacMy.has(f)) next.add(f);
        } else if (staffFilterChipNamesForToolbar.includes(f)) next.add(f);
      }
      if (next.size === prev.size && Array.from(prev).every((x) => next.has(x))) return prev;
      return next;
    });
  }, [staffFilterChipNamesForToolbar, bookedShippingRounds, bookedBuyerRounds, shippedSoldToolbarStats, vacantSaleToolbarStats]);

  useEffect(() => {
    if (bookedShippingRounds.length === 0) setBookedShippingPanelExpanded(false);
    if (bookedBuyerRounds.length === 0) setBookedBuyerPanelExpanded(false);
    if (shippedSoldToolbarStats.soldCount === 0) setShippedSoldExtrasPanelExpanded(false);
    if (vacantSaleToolbarStats.vacantCount === 0) setVacantSaleModelYearPanelExpanded(false);
  }, [bookedShippingRounds.length, bookedBuyerRounds.length, shippedSoldToolbarStats.soldCount, vacantSaleToolbarStats.vacantCount]);

  useEffect(() => {
    let ship = false;
    let buyer = false;
    let soldEx = false;
    let vacantMy = false;
    for (const f of Array.from(staffFilters)) {
      if (isBookedShipStaffFilter(f)) ship = true;
      if (isBookedBuyerStaffFilter(f)) buyer = true;
      if (isSoldShippedStaffFilter(f) || isSoldModelYearStaffFilter(f)) soldEx = true;
      if (isVacantSaleModelYearStaffFilter(f)) vacantMy = true;
    }
    if (ship) setBookedShippingPanelExpanded(true);
    if (buyer) setBookedBuyerPanelExpanded(true);
    if (soldEx) setShippedSoldExtrasPanelExpanded(true);
    if (vacantMy) setVacantSaleModelYearPanelExpanded(true);
  }, [staffFilters]);

  useEffect(() => {
    setItemStatusFilters((prev) => {
      const next = new Set<ItemStatusFilterValue | typeof ITEM_STATUS_DUE_TODAY>();
      for (const f of Array.from(prev)) {
        if (f === ITEM_STATUS_DUE_TODAY) next.add(f);
        else if (itemStatusRosterEffective.includes(f as ItemStatusValue)) next.add(f);
      }
      if (next.size === prev.size && Array.from(prev).every((x) => next.has(x))) return prev;
      return next;
    });
  }, [itemStatusRosterEffective]);

  const saleStatusCounts = useMemo(() => {
    const noExtraFilters = saleFilters.size === 0 && staffFilters.size === 0 && itemStatusFilters.size === 0;
    if (noExtraFilters && saleStatusSummaryAllCars) {
      return {
        ทั้งหมด: Number(saleStatusSummaryAllCars["ทั้งหมด"] ?? 0),
        จอง: Number(saleStatusSummaryAllCars["จอง"] ?? 0),
        รอส่ง: Number(saleStatusSummaryAllCars["รอส่ง"] ?? 0),
        ส่งแล้ว: Number(saleStatusSummaryAllCars["ส่งแล้ว"] ?? 0),
        ว่าง: Number(saleStatusSummaryAllCars["ว่าง"] ?? 0),
      } as Partial<Record<SaleStatusFilterValue, number>>;
    }
    const dueTodayChip = itemStatusPoliciesNormalized.dueToday;
    const baseOrders = mappedOrders.filter((order) => {
      const saleOk = orderMatchesSaleFilters(order, saleFilters);
      const staffOk = orderMatchesToolbarFilters(order, staffFilters, itemStatusFilters, dueTodayChip);
      return saleOk && staffOk;
    });
    const acc: Partial<Record<SaleStatusFilterValue, number>> = {};
    for (const saleStatus of SALE_STATUSES) {
      acc[saleStatus] =
        saleStatus === "ทั้งหมด"
          ? baseOrders.length
          : baseOrders.filter((order) => order.saleStatus === saleStatus).length;
    }
    return acc;
  }, [mappedOrders, saleFilters, staffFilters, itemStatusFilters, saleStatusSummaryAllCars, itemStatusPoliciesNormalized]);
  const visible = useMemo(
    () =>
      mappedOrders
        .filter((order) => {
          const saleOk = orderMatchesSaleFilters(order, saleFilters);
          const saleStatusOk = orderMatchesSaleStatusFilters(order, saleStatusFilters);
          const vehicleOk = matchesVehicleSearch(order, vehicleSearchForFiltering);
          if (!saleOk || !saleStatusOk || !vehicleOk) return false;
          return orderMatchesToolbarFilters(
            order,
            staffFilters,
            itemStatusFilters,
            itemStatusPoliciesNormalized.dueToday
          );
        })
        .sort((a, b) => {
          const workRank = orderCardWorkPresenceRank(a) - orderCardWorkPresenceRank(b);
          if (workRank !== 0) return workRank;
          const onlyEmptySelected = saleStatusFilters.size === 1 && saleStatusFilters.has("ว่าง");
          if (onlyEmptySelected) {
            const yearDelta = modelYearSortValue(b.modelYear) - modelYearSortValue(a.modelYear);
            if (yearDelta !== 0) return yearDelta;
          }
          const byStatus = (SALE_STATUS_PRIORITY[a.saleStatus] ?? 99) - (SALE_STATUS_PRIORITY[b.saleStatus] ?? 99);
          if (byStatus !== 0) return byStatus;
          const shipA = shipGroupKey(a.ship);
          const shipB = shipGroupKey(b.ship);
          if (shipA !== shipB) return shipA.localeCompare(shipB, "en", { numeric: true, sensitivity: "base" });
          return a.id.localeCompare(b.id);
        }),
    [
      saleStatusFilters,
      vehicleSearchForFiltering,
      staffFilters,
      itemStatusFilters,
      mappedOrders,
      saleFilters,
      itemStatusPoliciesNormalized,
    ]
  );
  /** AI · LINE car picker uses full loaded orders, not toolbar-filtered `visible`. */
  const lineInboxAiOrderPicks = useMemo(() => {
    const sorted = [...mappedOrders].sort((a, b) => {
      const plateCmp = String(a.fullPlate ?? "")
        .trim()
        .localeCompare(String(b.fullPlate ?? "").trim(), "th", { numeric: true, sensitivity: "base" });
      if (plateCmp !== 0) return plateCmp;
      return a.id.localeCompare(b.id);
    });
    return sorted.map((o) => ({
      id: o.id,
      fullPlate: o.fullPlate,
      car: o.car,
      carRowId: o.carRowId,
      carId: o.carId,
    }));
  }, [mappedOrders]);
  /** Per-status item counts from current `mappedOrders` (Supabase-backed or in-file `ORDERS` demo) with same filters as the list. */
  const itemStatusCounts = useMemo(() => {
    const useSummaryCacheBase =
      Boolean(summarySnapshotAllCars) &&
      saleFilters.size === 0 &&
      saleStatusFilters.size === 0 &&
      staffFilters.size === 0 &&
      itemStatusFilters.size === 0 &&
      vehicleSearchForFiltering.trim() === "";
    if (useSummaryCacheBase && summarySnapshotAllCars) {
      const counts = new Map<ItemStatusValue, number>();
      for (const s of ITEM_STATUSES) {
        counts.set(s, Number(summarySnapshotAllCars.itemStatusCounts?.[s] ?? 0));
      }
      return counts;
    }
    const counts = new Map<ItemStatusValue, number>();
    for (const s of ITEM_STATUSES) counts.set(s, 0);
    const { itemStaffFilters } = splitStaffFilters(staffFilters);
    const dtChip = itemStatusPoliciesNormalized.dueToday;
    const baseFiltered = mappedOrders.filter((order) => {
      const saleOk = orderMatchesSaleFilters(order, saleFilters);
      const saleStatusOk = orderMatchesSaleStatusFilters(order, saleStatusFilters);
      const vehicleOk = matchesVehicleSearch(order, vehicleSearchForFiltering);
      return saleOk && saleStatusOk && vehicleOk && orderMatchesToolbarFilters(order, staffFilters, new Set(), dtChip);
    });
    for (const order of baseFiltered) {
      for (const item of order.items) {
        if (!itemMatchesStaffFilters(item.assignee, itemStaffFilters)) continue;
        counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
      }
    }
    return counts;
  }, [
    mappedOrders,
    saleStatusFilters,
    vehicleSearchForFiltering,
    staffFilters,
    saleFilters,
    itemStatusFilters,
    summarySnapshotAllCars,
    itemStatusPoliciesNormalized,
  ]);

  /** จำนวนรายการตามการตั้งค่าชิป "มาวันนี้" (due date + เทียบ daysUntilBangkok ตั้งได้) */
  const dueTodayItemCount = useMemo(() => {
    const dtChip = itemStatusPoliciesNormalized.dueToday;
    const { itemStaffFilters } = splitStaffFilters(staffFilters);
    const baseFiltered = mappedOrders.filter((order) => {
      const saleOk = orderMatchesSaleFilters(order, saleFilters);
      const saleStatusOk = orderMatchesSaleStatusFilters(order, saleStatusFilters);
      const vehicleOk = matchesVehicleSearch(order, vehicleSearchForFiltering);
      return saleOk && saleStatusOk && vehicleOk && orderMatchesToolbarFilters(order, staffFilters, new Set(), dtChip);
    });
    let count = 0;
    for (const order of baseFiltered) {
      for (const item of order.items) {
        if (!itemMatchesStaffFilters(item.assignee, itemStaffFilters)) continue;
        if (matchesDueTodayChip(item, dtChip)) count += 1;
      }
    }
    return count;
  }, [mappedOrders, saleFilters, saleStatusFilters, vehicleSearchForFiltering, staffFilters, itemStatusPoliciesNormalized]);

  /** ชิปสถานะที่แสดง — ซ่อนเมื่อจำนวนรายการ = 0 (เฉพาะก่อนล็อกครั้งแรก; หลังล็อกใช้ itemStatusRosterForToolbar) */
  const itemStatusRosterVisible = useMemo(
    () => itemStatusRosterEffective.filter((s) => (itemStatusCounts.get(s) ?? 0) > 0),
    [itemStatusRosterEffective, itemStatusCounts]
  );

  const itemStatusRosterForToolbar = useMemo(() => {
    const sticky = itemStatusChipsStickyAfterPrimeRef.current;
    if (!filterChipLayoutPrimed || !sticky) {
      return itemStatusRosterVisible;
    }
    return itemStatusRosterEffective.filter((s) => sticky.has(s) || (itemStatusCounts.get(s) ?? 0) > 0);
  }, [filterChipLayoutPrimed, itemStatusRosterEffective, itemStatusRosterVisible, itemStatusCounts]);

  const itemStatusFilterOptionsForToolbar = useMemo(() => {
    const ordered = sortItemStatusesForFilterToolbar([...itemStatusRosterForToolbar]);
    const withDueToday =
      dueTodayItemCount > 0 || itemStatusFilters.has(ITEM_STATUS_DUE_TODAY)
        ? [ITEM_STATUS_DUE_TODAY, ...ordered]
        : ordered;
    return withDueToday;
  }, [dueTodayItemCount, itemStatusRosterForToolbar, itemStatusFilters]);

  /** สลับจากโหมดหลายชิป → ทีละหนึ่ง: ย่อให้เหลือชิปเดียวต่อแถว (ตามลำดับแสดงผล) */
  useEffect(() => {
    const wasMulti = prevFilterChipMultiSelectRef.current;
    prevFilterChipMultiSelectRef.current = filterChipMultiSelect;
    if (filterChipMultiSelect || !wasMulti) return;

    setSaleFilters((prev) => {
      if (prev.size <= 1) return prev;
      const pick = salesChipsOrdered.find((x) => x !== "ALL" && prev.has(x));
      return pick ? new Set([pick]) : new Set();
    });
    setSaleStatusFilters((prev) => {
      if (prev.size <= 1) return prev;
      const pick = SALE_STATUSES.find((x) => x !== "ทั้งหมด" && prev.has(x));
      return pick ? new Set([pick]) : new Set();
    });
    setStaffFilters((prev) => {
      if (prev.size <= 1) return prev;
      if (prev.has(STAFF_FILTER_UNASSIGNED)) return new Set([STAFF_FILTER_UNASSIGNED]);
      for (const name of staffFilterChipNamesForToolbar) {
        if (prev.has(name)) return new Set([name]);
      }
      for (const r of bookedShippingRounds) {
        if (prev.has(r.token)) return new Set([r.token]);
      }
      for (const r of bookedBuyerRounds) {
        if (prev.has(r.token)) return new Set([r.token]);
      }
      for (const r of shippedSoldToolbarStats.shippedRounds) {
        if (prev.has(r.token)) return new Set([r.token]);
      }
      if (prev.has(STAFF_FILTER_SOLD_SHIPPED_EMPTY)) return new Set([STAFF_FILTER_SOLD_SHIPPED_EMPTY]);
      for (const r of shippedSoldToolbarStats.modelYearRounds) {
        if (prev.has(r.token)) return new Set([r.token]);
      }
      if (prev.has(STAFF_FILTER_SOLD_MODEL_YEAR_EMPTY)) return new Set([STAFF_FILTER_SOLD_MODEL_YEAR_EMPTY]);
      for (const r of vacantSaleToolbarStats.modelYearRounds) {
        if (prev.has(r.token)) return new Set([r.token]);
      }
      if (prev.has(STAFF_FILTER_VACANT_MODEL_YEAR_EMPTY)) return new Set([STAFF_FILTER_VACANT_MODEL_YEAR_EMPTY]);
      const fallback = Array.from(prev)[0];
      return fallback ? new Set([fallback]) : new Set();
    });
    setItemStatusFilters((prev) => {
      if (prev.size <= 1) return prev;
      const pick = itemStatusFilterOptionsForToolbar.find((x) => prev.has(x));
      return pick ? new Set([pick]) : new Set();
    });
  }, [
    filterChipMultiSelect,
    salesChipsOrdered,
    staffFilterChipNamesForToolbar,
    bookedShippingRounds,
    bookedBuyerRounds,
    shippedSoldToolbarStats,
    vacantSaleToolbarStats,
    itemStatusFilterOptionsForToolbar,
  ]);

  useLayoutEffect(() => {
    if (filterChipLayoutPrimed) return;
    if (mappedOrders.length === 0 && staffAssigneeItemCounts.grandTotal === 0) return;
    const staffSticky = new Set(staffFilterChipNamesVisible);
    if ((staffAssigneeItemCounts.unassigned ?? 0) > 0) staffSticky.add(STAFF_FILTER_UNASSIGNED);
    for (const r of bookedShippingRounds) {
      if (r.count > 0) staffSticky.add(r.token);
    }
    for (const r of bookedBuyerRounds) {
      if (r.count > 0) staffSticky.add(r.token);
    }
    if (shippedSoldToolbarStats.shippedEmpty > 0) staffSticky.add(STAFF_FILTER_SOLD_SHIPPED_EMPTY);
    for (const r of shippedSoldToolbarStats.shippedRounds) {
      if (r.count > 0) staffSticky.add(r.token);
    }
    if (shippedSoldToolbarStats.modelYearEmpty > 0) staffSticky.add(STAFF_FILTER_SOLD_MODEL_YEAR_EMPTY);
    for (const r of shippedSoldToolbarStats.modelYearRounds) {
      if (r.count > 0) staffSticky.add(r.token);
    }
    if (vacantSaleToolbarStats.modelYearEmpty > 0) staffSticky.add(STAFF_FILTER_VACANT_MODEL_YEAR_EMPTY);
    for (const r of vacantSaleToolbarStats.modelYearRounds) {
      if (r.count > 0) staffSticky.add(r.token);
    }
    staffChipsStickyAfterPrimeRef.current = staffSticky;
    itemStatusChipsStickyAfterPrimeRef.current = new Set(itemStatusRosterVisible);
    setFilterChipLayoutPrimed(true);
  }, [
    filterChipLayoutPrimed,
    mappedOrders.length,
    staffAssigneeItemCounts.grandTotal,
    staffAssigneeItemCounts.unassigned,
    bookedShippingRounds,
    bookedBuyerRounds,
    shippedSoldToolbarStats,
    vacantSaleToolbarStats,
    staffFilterChipNamesVisible,
    itemStatusRosterVisible,
  ]);

  /** ผลรวมรายการทุกสถานะ (ขอบเขตเดียวกับชิปสถานะรายการ) — ชิป "แสดงทั้งหมด" */
  const itemStatusTotalCount = useMemo(
    () => ITEM_STATUSES.reduce((sum, s) => sum + (itemStatusCounts.get(s) ?? 0), 0),
    [itemStatusCounts]
  );
  const visiblePaged = useMemo(() => visible.slice(0, visibleLimit), [visible, visibleLimit]);
  const hasMoreVisible = visible.length > visibleLimit;

  const deepLinkSetupRef = useRef(false);
  const deepLinkScrollDoneRef = useRef(false);
  useEffect(() => {
    const raw = String(initialFocusedOrderId ?? "").trim();
    if (!raw || deepLinkSetupRef.current || mappedOrders.length === 0) return;
    const order = mappedOrders.find((o) => o.id === raw);
    if (!order) {
      deepLinkSetupRef.current = true;
      deepLinkScrollDoneRef.current = true;
      return;
    }
    deepLinkSetupRef.current = true;
    setSaleFilters(new Set());
    setSaleStatusFilters(new Set());
    setStaffFilters(new Set());
    setItemStatusFilters(new Set());
    const q = String(order.fullPlate ?? "").trim() || String(order.plate ?? "").trim();
    if (q && q !== "-") setVehicleSearch(sanitizeVehicleSearchInput(q));
  }, [initialFocusedOrderId, mappedOrders]);

  useLayoutEffect(() => {
    const raw = String(initialFocusedOrderId ?? "").trim();
    if (!raw || deepLinkScrollDoneRef.current || !deepLinkSetupRef.current) return;
    const order = mappedOrders.find((o) => o.id === raw);
    if (!order) {
      deepLinkScrollDoneRef.current = true;
      return;
    }
    const idx = visible.findIndex((o) => o.id === raw);
    if (idx < 0) return;
    setVisibleLimit((prev) => Math.max(prev, idx + 1));
    const el = document.getElementById(`order-card-${raw}`);
    if (!el) return;
    window.requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      deepLinkScrollDoneRef.current = true;
    });
  }, [initialFocusedOrderId, mappedOrders, visible]);

  useEffect(() => {
    setVisibleLimit(ORDERS_PAGE_SIZE);
  }, [saleStatusFilters, staffFilters, itemStatusFilters, saleFilters, vehicleSearchForFiltering]);

  useEffect(() => {
    if (!hasMoreVisible) return;
    const target = loadMoreRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        setVisibleLimit((prev) => prev + ORDERS_PAGE_SIZE);
      },
      { rootMargin: "200px 0px 200px 0px", threshold: 0.01 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreVisible]);

  const deleteVehicleChar = () => setVehicleSearch((prev) => prev.slice(0, -1));
  const runWithStableScroll = (action: () => void) => {
    pendingScrollYRef.current = window.scrollY;
    action();
  };
  const toggleSaleChipStable = (sale: string) =>
    runWithStableScroll(() => {
      if (sale === "ALL") {
        setSaleFilters(new Set());
        return;
      }
      if (!filterChipMultiSelect) {
        setSaleFilters((prev) => {
          if (prev.size === 1 && prev.has(sale)) return new Set();
          return new Set([sale]);
        });
        return;
      }
      setSaleFilters((prev) => toggleSetMember(prev, sale));
    });
  const toggleSaleStatusChipStable = (value: SaleStatusFilterValue) =>
    runWithStableScroll(() => {
      if (value === "ทั้งหมด") {
        setSaleStatusFilters(new Set());
        return;
      }
      if (!filterChipMultiSelect) {
        setSaleStatusFilters((prev) => {
          if (prev.size === 1 && prev.has(value)) return new Set();
          return new Set([value]);
        });
        return;
      }
      setSaleStatusFilters((prev) => toggleSetMember(prev, value));
    });
  const toggleStaffChipStable = (value: string) =>
    runWithStableScroll(() => {
      if (value === "ทั้งหมด") {
        setStaffFilters(new Set());
        return;
      }
      if (!filterChipMultiSelect) {
        setStaffFilters((prev) => {
          if (prev.size === 1 && prev.has(value)) return new Set();
          return new Set([value]);
        });
        return;
      }
      setStaffFilters((prev) => toggleSetMember(prev, value));
    });
  const clearSoldShippedDimStable = () =>
    runWithStableScroll(() => setStaffFilters((prev) => stripSoldShippedStaffFilters(prev)));
  const clearSoldModelYearDimStable = () =>
    runWithStableScroll(() => setStaffFilters((prev) => stripSoldModelYearStaffFilters(prev)));
  const clearVacantSaleModelYearDimStable = () =>
    runWithStableScroll(() => setStaffFilters((prev) => stripVacantSaleModelYearStaffFilters(prev)));
  const toggleItemStatusChipStable = (value: ItemStatusFilterValue | typeof ITEM_STATUS_DUE_TODAY) =>
    runWithStableScroll(() => {
      if (!filterChipMultiSelect) {
        setItemStatusFilters((prev) => {
          if (prev.size === 1 && prev.has(value)) return new Set();
          return new Set([value]);
        });
        return;
      }
      setItemStatusFilters((prev) => toggleSetMember(prev, value));
    });
  const toggleFilterChipModeStable = () =>
    runWithStableScroll(() => setFilterChipMultiSelect((v) => !v));
  const clearItemStatusFiltersStable = () =>
    runWithStableScroll(() => setItemStatusFilters(new Set()));
  const clearVehicleStable = () =>
    runWithStableScroll(() => {
      setVehicleSearch("");
      setVisibleLimit(ORDERS_PAGE_SIZE);
    });
  const deleteVehicleStable = () => runWithStableScroll(() => deleteVehicleChar());
  const clearFiltersStable = () =>
    runWithStableScroll(() => {
      setSaleFilters(new Set());
      setSaleStatusFilters(new Set());
      setVehicleSearch("");
      setStaffFilters(new Set());
      setItemStatusFilters(new Set());
      setVisibleLimit(ORDERS_PAGE_SIZE);
    });

  useLayoutEffect(() => {
    if (pendingScrollYRef.current == null) return;
    const y = pendingScrollYRef.current;
    pendingScrollYRef.current = null;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: y, left: 0, behavior: "auto" });
      window.setTimeout(() => {
        window.scrollTo({ top: y, left: 0, behavior: "auto" });
      }, 0);
    });
  }, [saleStatusFilters, vehicleSearch, itemStatusFilters, staffFilters, visibleLimit, saleFilters]);

  /** ซิงก์ข้ามเครื่อง: เมื่อมีคนแก้ order_items / order_task_updates ให้ดึงข้อมูลหน้าใหม่ (ต้องเปิด Realtime ในคอนโซล Supabase) */
  useEffect(() => {
    if (usingDemoFallback) return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!url || !key) return;

    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      if (cancelled) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = undefined;
        router.refresh();
      }, 500);
    };

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const channel = supabase
      .channel("mobile-order-tracking-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: ORDER_ITEMS_TABLE_NAME },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: ORDER_TASK_UPDATES_TABLE_NAME },
        scheduleRefresh
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (debounce) clearTimeout(debounce);
      void supabase.removeChannel(channel);
    };
  }, [router, usingDemoFallback]);

  /** ดึงลงเมื่ออยู่บนสุดของหน้า → router.refresh() (ชดเชยกรณี Realtime ไม่ทำงานหรือหน้าอื่นไม่ได้ subscribe) */
  useEffect(() => {
    const el = orderTrackingRootRef.current;
    if (typeof window === "undefined" || !el) return;

    const scrollAtTop = () => window.scrollY <= 2;

    const clearPullVisual = () => {
      ptrArmRef.current = false;
      ptrPullRef.current = 0;
      setPtrPullPx(0);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (!scrollAtTop() || ptrRefreshingRef.current) return;
      ptrArmRef.current = true;
      ptrStartYRef.current = e.touches[0].clientY;
      ptrStartXRef.current = e.touches[0].clientX;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!ptrArmRef.current || ptrRefreshingRef.current) return;
      if (!scrollAtTop()) {
        clearPullVisual();
        return;
      }
      const dy = e.touches[0].clientY - ptrStartYRef.current;
      const dx = e.touches[0].clientX - ptrStartXRef.current;
      if (dy < 6) return;
      if (Math.abs(dx) > Math.abs(dy) * 0.75) return;
      const damped = Math.min(dy * 0.35, 72);
      ptrPullRef.current = damped;
      setPtrPullPx(damped);
      if (damped > 4) e.preventDefault();
    };

    const endPull = () => {
      if (!ptrArmRef.current) return;
      ptrArmRef.current = false;
      const shouldRefresh = ptrPullRef.current >= PTR_RELEASE_DAMPED_PX && !ptrRefreshingRef.current;
      ptrPullRef.current = 0;
      setPtrPullPx(0);
      if (shouldRefresh) {
        ptrRefreshingRef.current = true;
        setPtrRefreshing(true);
        startTransition(() => {
          router.refresh();
        });
        window.setTimeout(() => {
          ptrRefreshingRef.current = false;
          setPtrRefreshing(false);
        }, 900);
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", endPull);
    el.addEventListener("touchcancel", clearPullVisual);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", endPull);
      el.removeEventListener("touchcancel", clearPullVisual);
    };
  }, [router]);

  return (
    <>
      {ptrPullPx > 2 || ptrRefreshing ? (
        <div
          className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-3"
          style={{
            top: 0,
            paddingTop: "max(env(safe-area-inset-top, 0px), 6px)",
            transform: `translateY(${ptrRefreshing ? 0 : Math.max(0, ptrPullPx - 10)}px)`,
          }}
          aria-live="polite"
        >
          <div className="flex max-w-[min(100%,20rem)] items-center gap-2 rounded-full bg-slate-900/92 px-3.5 py-2 text-center text-[11px] font-semibold leading-snug text-white shadow-lg ring-1 ring-white/10">
            {ptrRefreshing ? (
              <>
                <span
                  className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-white/35 border-t-white animate-spin"
                  aria-hidden
                />
                <span>{uiLang === "en" ? "Loading data..." : "กำลังโหลดข้อมูล…"}</span>
              </>
            ) : ptrPullPx >= PTR_RELEASE_DAMPED_PX ? (
              <span>{uiLang === "en" ? "Release to refresh" : "ปล่อยเพื่อรีเฟรช"}</span>
            ) : (
              <span>{uiLang === "en" ? "Pull to refresh" : "ดึงลงเพื่อรีเฟรช"}</span>
            )}
          </div>
        </div>
      ) : null}
      <div
        ref={orderTrackingRootRef}
        className="flex min-h-0 min-h-full w-full flex-1 flex-col bg-slate-100 antialiased text-[15px] leading-normal text-slate-800"
      >
      <div className="mx-auto flex min-h-0 min-h-full w-full max-w-none flex-1 flex-col overflow-x-clip bg-slate-100">
        <div className="sticky top-0 z-40 bg-slate-100/95 px-0 pb-2 pt-2 backdrop-blur sm:px-3">
          <div className="mb-2 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-200/60">
            <div className="flex w-full flex-nowrap items-center gap-2 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
                }}
                title={uiLang === "en" ? "Scroll to top" : "เลื่อนหน้าจอไปบนสุด"}
                aria-label={uiLang === "en" ? "Scroll to top" : "เลื่อนหน้าจอไปบนสุด"}
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 px-3 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 touch-manipulation active:bg-slate-200/90"
              >
                {uiLang === "en" ? "Top" : "บนสุด"}
              </button>
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => setUiLang((prev) => (prev === "th" ? "en" : "th"))}
                className="inline-flex h-10 min-w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 px-2.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 touch-manipulation active:bg-slate-200/90"
                title={uiLang === "en" ? "Switch language" : "สลับภาษา"}
                aria-label={uiLang === "en" ? "Switch language" : "สลับภาษา"}
              >
                {uiLang === "th" ? <OrderTrackingToolbarFlagTh /> : <OrderTrackingToolbarFlagGb />}
              </button>
              <span className="shrink-0 text-sm font-semibold text-slate-900">{uiLang === "en" ? "Search" : "ค้นหา"}</span>
              <input
                type="text"
                inputMode="text"
                enterKeyHint="search"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                value={vehicleSearch}
                onChange={(e) => setVehicleSearch(sanitizeVehicleSearchInput(e.target.value))}
                onPaste={(e) => {
                  e.preventDefault();
                  const raw = e.clipboardData.getData("text/plain");
                  const cleaned = sanitizeVehicleSearchPaste(raw);
                  if (cleaned) setVehicleSearch(cleaned);
                }}
                placeholder={uiLang === "en" ? "Plate / Chassis…" : "ทะเบียน / เลขถัง…"}
                title={uiLang === "en" ? "Type or long-press to paste from clipboard" : "แตะแล้วพิมพ์ หรือกดค้างเพื่อวางจากคลิปบอร์ด"}
                aria-label={uiLang === "en" ? "Search plate or chassis, type or paste from clipboard" : "ค้นหาทะเบียนหรือเลขตัวถัง พิมพ์หรือวางจากคลิปบอร์ด"}
                className={cn(
                  "min-h-11 min-w-0 flex-1 rounded-2xl bg-slate-950 px-3 py-2.5 text-center text-base font-semibold tabular-nums tracking-normal text-white",
                  "outline-none ring-0 placeholder:text-white/45",
                  "focus-visible:ring-2 focus-visible:ring-white/35"
                )}
              />
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={deleteVehicleStable}
                className="h-10 shrink-0 rounded-2xl bg-slate-950 px-3 text-xs font-semibold text-white touch-manipulation"
              >
                {uiLang === "en" ? "Del" : "ลบ"}
              </button>
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={clearVehicleStable}
                className="h-10 shrink-0 rounded-2xl bg-slate-100 px-3 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 touch-manipulation"
              >
                {uiLang === "en" ? "Clear" : "ล้าง"}
              </button>
            </div>
          </div>
        </div>
        <header className="bg-slate-100/95 px-0 py-2 sm:px-3 sm:py-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 px-2 sm:px-0">
            <h1 className="text-[1.35rem] font-bold tracking-tight text-slate-900">Order Tracking</h1>
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => void translateAllLegacyItems()}
              disabled={translateAllBusy}
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-snug ring-1 touch-manipulation",
                translateAllBusy
                  ? "cursor-not-allowed bg-slate-200 text-slate-500 ring-slate-300/80"
                  : "bg-blue-50 text-blue-900 ring-blue-200/90"
              )}
              title={
                uiLang === "en"
                  ? "Re-translate item names and Thai notes (latest rows; API limit applies)"
                  : "แปลใหม่ทั้งชื่อรายการและหมายเหตุไทยแบบกลุ่ม (เรียงจากแถวล่าสุด จำกัดจำนวนตามเซิร์ฟเวอร์)"
              }
            >
              {translateAllBusy
                ? (uiLang === "en" ? "Translating..." : "กำลังแปล...")
                : (uiLang === "en" ? "Re-translate all" : "แปลใหม่ทั้งหมด")}
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={toggleFilterChipModeStable}
              title={
                filterChipMultiSelect
                  ? (uiLang === "en"
                      ? "Current mode: multi-select chips per row. Tap to switch to single-select."
                      : "โหมดปัจจุบัน: เลือกหลายชิปต่อแถว · แตะเพื่อสลับเป็นเลือกทีละหนึ่ง")
                  : (uiLang === "en"
                      ? "Current mode: single-select per row. Tap to switch to multi-select."
                      : "โหมดปัจจุบัน: เลือกทีละหนึ่งต่อแถว · แตะเพื่อสลับเป็นเลือกหลายชิป")
              }
              aria-pressed={filterChipMultiSelect}
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-snug ring-1 touch-manipulation",
                filterChipMultiSelect
                  ? "bg-slate-950 text-white ring-slate-800"
                  : "bg-amber-100 text-amber-950 ring-amber-300/90"
              )}
            >
              {filterChipMultiSelect
                ? (uiLang === "en" ? "Multi Select" : "เลือกหลายชิป")
                : (uiLang === "en" ? "Single Select" : "เลือกทีละหนึ่ง")}
            </button>
          </div>
          {translateAllMessage ? (
            <div className="mb-2 rounded-2xl bg-sky-50 px-3 py-2 text-xs font-medium leading-snug text-sky-900">
              {translateAllMessage}
            </div>
          ) : null}
          {usingDemoFallback ? (
            <div className="mb-2 rounded-2xl bg-amber-50 px-3 py-2.5 text-sm font-medium leading-snug text-amber-900">
              {uiLang === "en"
                ? "Demo fallback mode: live cars data not found from Supabase"
                : "Demo fallback mode: ไม่พบข้อมูลรถจริงจาก Supabase"}
            </div>
          ) : null}
          {isDeferredHydrationLoading ? (
            <div className="mb-2 rounded-2xl bg-sky-50 px-3 py-2.5 text-sm font-medium leading-snug text-sky-900">
              {uiLang === "en"
                ? `Loading car list in the background... ${deferredHydrationPercent}%`
                : `กำลังโหลดรายการรถในพื้นหลัง... ${deferredHydrationPercent}%`}
            </div>
          ) : null}
          {dataWarnings.length > 0 && !suppressDataWarningsDuringDeferredHydration ? (
            <div className="mb-2 rounded-2xl bg-rose-50 px-3 py-2.5 text-sm font-medium leading-snug text-rose-800">
              Data warning: {dataWarnings[0]}
            </div>
          ) : null}
          <>
              <div className="mb-2 rounded-2xl bg-white p-2">
                <div className="mb-2 rounded-2xl bg-slate-100/80 p-2">
                  <div className="mb-1.5">
                    <span className="text-xs font-semibold tracking-wide text-slate-600">{uiLang === "en" ? "Sale Code" : "เซลล์"}</span>
                  </div>
                  <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(72px, 1fr))" }}>
                    {salesChipsOrdered.map((sale) => (
                      <button
                        key={sale}
                        type="button"
                        onClick={() => toggleSaleChipStable(sale)}
                        className={cn(
                          "min-h-[48px] rounded-2xl px-1.5 py-2 text-center transition-colors",
                          sale === "ALL"
                            ? saleFilters.size === 0
                              ? "bg-slate-950 text-white"
                              : "bg-slate-100 text-slate-700 hover:bg-slate-200/70"
                            : saleFilters.has(sale)
                              ? "bg-slate-950 text-white"
                              : "bg-slate-100 text-slate-700 hover:bg-slate-200/70"
                        )}
                      >
                        <div className="truncate text-xs font-medium leading-snug">{sale}</div>
                        <div className="text-base font-semibold tabular-nums leading-none">{saleCounts[sale] ?? 0}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-2 rounded-2xl bg-slate-100/80 p-2">
                  <div className="mb-1.5">
                    <span className="text-xs font-semibold tracking-wide text-slate-600">{uiLang === "en" ? "Sale Status" : "สถานะขาย"}</span>
                  </div>
                  <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(72px, 1fr))" }}>
                    {SALE_STATUSES.map((s) => {
                      const active = s === "ทั้งหมด" ? saleStatusFilters.size === 0 : saleStatusFilters.has(s);
                      const showShipExpand = s === "รอส่ง" && bookedShippingRounds.length > 0;
                      const showBuyerExpand = s === "จอง" && bookedBuyerRounds.length > 0;
                      const showShippedSoldExpand = s === "ส่งแล้ว" && shippedSoldToolbarStats.soldCount > 0;
                      const showVacantModelYearExpand = s === "ว่าง" && vacantSaleToolbarStats.vacantCount > 0;
                      if (showShipExpand) {
                        return (
                          <div
                            key={s}
                            className={cn(
                              "flex min-h-[48px] min-w-0 overflow-hidden rounded-2xl ring-1 transition-colors",
                              active ? "bg-slate-950 text-white ring-slate-800" : "bg-slate-100 text-slate-700 ring-slate-200/80"
                            )}
                          >
                            <button
                              type="button"
                              onPointerDown={(e) => e.preventDefault()}
                              onClick={() => toggleSaleStatusChipStable(s)}
                              className={cn(
                                "flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center px-1.5 py-2 text-center transition-colors touch-manipulation",
                                active ? "text-white" : "hover:bg-slate-200/70"
                              )}
                            >
                              <div className="truncate text-xs font-medium leading-snug">{displaySaleStatusLabel(s, uiLang)}</div>
                              <div className="text-base font-semibold tabular-nums leading-none">
                                {saleStatusCounts[s] ?? 0}
                              </div>
                            </button>
                            <button
                              type="button"
                              onPointerDown={(e) => e.preventDefault()}
                              onClick={() => setBookedShippingPanelExpanded((open) => !open)}
                              aria-expanded={bookedShippingPanelExpanded}
                              aria-label={
                                bookedShippingPanelExpanded
                                  ? "ย่อรอบส่ง booked shipping"
                                  : "ขยายรอบส่ง booked shipping"
                              }
                              title="รอบส่ง (booked shipping)"
                              className={cn(
                                "flex w-9 shrink-0 flex-col items-center justify-center text-base font-semibold leading-none touch-manipulation",
                                active
                                  ? "border-l border-white/25 text-white hover:bg-white/10"
                                  : "border-l border-slate-200/90 text-slate-600 hover:bg-slate-200/60"
                              )}
                            >
                              {bookedShippingPanelExpanded ? "⌃" : "⌄"}
                            </button>
                          </div>
                        );
                      }
                      if (showBuyerExpand) {
                        return (
                          <div
                            key={s}
                            className={cn(
                              "flex min-h-[48px] min-w-0 overflow-hidden rounded-2xl ring-1 transition-colors",
                              active ? "bg-slate-950 text-white ring-slate-800" : "bg-slate-100 text-slate-700 ring-slate-200/80"
                            )}
                          >
                            <button
                              type="button"
                              onPointerDown={(e) => e.preventDefault()}
                              onClick={() => toggleSaleStatusChipStable(s)}
                              className={cn(
                                "flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center px-1.5 py-2 text-center transition-colors touch-manipulation",
                                active ? "text-white" : "hover:bg-slate-200/70"
                              )}
                            >
                              <div className="truncate text-xs font-medium leading-snug">{displaySaleStatusLabel(s, uiLang)}</div>
                              <div className="text-base font-semibold tabular-nums leading-none">
                                {saleStatusCounts[s] ?? 0}
                              </div>
                            </button>
                            <button
                              type="button"
                              onPointerDown={(e) => e.preventDefault()}
                              onClick={() => setBookedBuyerPanelExpanded((open) => !open)}
                              aria-expanded={bookedBuyerPanelExpanded}
                              aria-label={
                                bookedBuyerPanelExpanded
                                  ? "ย่อกลุ่มตามชื่อลูกค้า (จอง)"
                                  : "ขยายกลุ่มตามชื่อลูกค้า (จอง)"
                              }
                              title="ลูกค้า (จอง)"
                              className={cn(
                                "flex w-9 shrink-0 flex-col items-center justify-center text-base font-semibold leading-none touch-manipulation",
                                active
                                  ? "border-l border-white/25 text-white hover:bg-white/10"
                                  : "border-l border-slate-200/90 text-slate-600 hover:bg-slate-200/60"
                              )}
                            >
                              {bookedBuyerPanelExpanded ? "⌃" : "⌄"}
                            </button>
                          </div>
                        );
                      }
                      if (showShippedSoldExpand) {
                        return (
                          <div
                            key={s}
                            className={cn(
                              "flex min-h-[48px] min-w-0 overflow-hidden rounded-2xl ring-1 transition-colors",
                              active ? "bg-slate-950 text-white ring-slate-800" : "bg-slate-100 text-slate-700 ring-slate-200/80"
                            )}
                          >
                            <button
                              type="button"
                              onPointerDown={(e) => e.preventDefault()}
                              onClick={() => toggleSaleStatusChipStable(s)}
                              className={cn(
                                "flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center px-1.5 py-2 text-center transition-colors touch-manipulation",
                                active ? "text-white" : "hover:bg-slate-200/70"
                              )}
                            >
                              <div className="truncate text-xs font-medium leading-snug">{displaySaleStatusLabel(s, uiLang)}</div>
                              <div className="text-base font-semibold tabular-nums leading-none">
                                {saleStatusCounts[s] ?? 0}
                              </div>
                            </button>
                            <button
                              type="button"
                              onPointerDown={(e) => e.preventDefault()}
                              onClick={() => setShippedSoldExtrasPanelExpanded((open) => !open)}
                              aria-expanded={shippedSoldExtrasPanelExpanded}
                              aria-label={
                                shippedSoldExtrasPanelExpanded
                                  ? "ย่อกรอง shipped / model year (ส่งแล้ว)"
                                  : "ขยายกรอง shipped / model year (ส่งแล้ว)"
                              }
                              title="shipped · model year"
                              className={cn(
                                "flex w-9 shrink-0 flex-col items-center justify-center text-base font-semibold leading-none touch-manipulation",
                                active
                                  ? "border-l border-white/25 text-white hover:bg-white/10"
                                  : "border-l border-slate-200/90 text-slate-600 hover:bg-slate-200/60"
                              )}
                            >
                              {shippedSoldExtrasPanelExpanded ? "⌃" : "⌄"}
                            </button>
                          </div>
                        );
                      }
                      if (showVacantModelYearExpand) {
                        return (
                          <div
                            key={s}
                            className={cn(
                              "flex min-h-[48px] min-w-0 overflow-hidden rounded-2xl ring-1 transition-colors",
                              active ? "bg-slate-950 text-white ring-slate-800" : "bg-slate-100 text-slate-700 ring-slate-200/80"
                            )}
                          >
                            <button
                              type="button"
                              onPointerDown={(e) => e.preventDefault()}
                              onClick={() => toggleSaleStatusChipStable(s)}
                              className={cn(
                                "flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center px-1.5 py-2 text-center transition-colors touch-manipulation",
                                active ? "text-white" : "hover:bg-slate-200/70"
                              )}
                            >
                              <div className="truncate text-xs font-medium leading-snug">{displaySaleStatusLabel(s, uiLang)}</div>
                              <div className="text-base font-semibold tabular-nums leading-none">
                                {saleStatusCounts[s] ?? 0}
                              </div>
                            </button>
                            <button
                              type="button"
                              onPointerDown={(e) => e.preventDefault()}
                              onClick={() => setVacantSaleModelYearPanelExpanded((open) => !open)}
                              aria-expanded={vacantSaleModelYearPanelExpanded}
                              aria-label={
                                vacantSaleModelYearPanelExpanded
                                  ? "ย่อกรอง model year (ว่าง)"
                                  : "ขยายกรอง model year (ว่าง)"
                              }
                              title="Model year (ว่าง)"
                              className={cn(
                                "flex w-9 shrink-0 flex-col items-center justify-center text-base font-semibold leading-none touch-manipulation",
                                active
                                  ? "border-l border-white/25 text-white hover:bg-white/10"
                                  : "border-l border-slate-200/90 text-slate-600 hover:bg-slate-200/60"
                              )}
                            >
                              {vacantSaleModelYearPanelExpanded ? "⌃" : "⌄"}
                            </button>
                          </div>
                        );
                      }
                      return (
                        <button
                          key={s}
                          type="button"
                          onPointerDown={(e) => e.preventDefault()}
                          onClick={() => toggleSaleStatusChipStable(s)}
                          className={cn(
                            "min-h-[48px] rounded-2xl px-1.5 py-2 text-center transition-colors touch-manipulation",
                            active ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200/70"
                          )}
                        >
                          <div className="truncate text-xs font-medium leading-snug">{displaySaleStatusLabel(s, uiLang)}</div>
                          <div className="text-base font-semibold tabular-nums leading-none">{saleStatusCounts[s] ?? 0}</div>
                        </button>
                      );
                    })}
                  </div>
                  {bookedShippingPanelExpanded && bookedShippingRounds.length > 0 ? (
                    <div className="mt-2 rounded-2xl border border-indigo-200/80 bg-indigo-50/90 p-2 ring-1 ring-indigo-100/80">
                      <div className="mb-1.5">
                        <span className="text-xs font-semibold tracking-wide text-indigo-950">{uiLang === "en" ? "Shipping Round - booked shipping" : "รอบส่ง — booked shipping"}</span>
                        <p className="mt-0.5 text-[10px] font-normal leading-snug text-indigo-900/75">
                          {uiLang === "en"
                            ? "Grouped by shipping value on car (one chip per round). Only for sale status \"Waiting Ship\". Multi-select enabled."
                            : "แยกตามค่าในรถ (รอบละชิป) · เฉพาะสถานะขาย \"รอส่ง\" · เลือกหลายรอบได้"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-end gap-2 overflow-x-auto pb-1">
                        {bookedShippingRounds.map((r) => (
                          <button
                            key={r.token}
                            type="button"
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={() => toggleStaffChipStable(r.token)}
                            className={cn(
                              "flex min-h-[52px] min-w-[4.5rem] max-w-[10rem] shrink-0 flex-col items-center justify-center gap-1 rounded-full px-2.5 py-2 text-center font-semibold ring-1 transition-[filter,box-shadow] touch-manipulation",
                              staffFilters.has(r.token)
                                ? "bg-indigo-600 text-white ring-indigo-500/50"
                                : "bg-white text-indigo-900 ring-indigo-200/90 hover:bg-indigo-100/90"
                            )}
                          >
                            <span className="line-clamp-3 max-w-full text-xs font-medium leading-snug">{r.label}</span>
                            <span className="text-base font-semibold leading-none tabular-nums">{r.count}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {bookedBuyerPanelExpanded && bookedBuyerRounds.length > 0 ? (
                    <div className="mt-2 rounded-2xl border border-emerald-200/80 bg-emerald-50/90 p-2 ring-1 ring-emerald-100/80">
                      <div className="mb-1.5">
                        <span className="text-xs font-semibold tracking-wide text-emerald-950">{uiLang === "en" ? "Buyer - Booked" : "ลูกค้า — จอง"}</span>
                        <p className="mt-0.5 text-[10px] font-normal leading-snug text-emerald-900/75">
                          {uiLang === "en"
                            ? "Grouped by buyer name (one chip per buyer). Only for sale status \"Booked\". Multi-select enabled."
                            : "แยกตามชื่อลูกค้า (ชิปละชื่อ) · เฉพาะสถานะขาย \"จอง\" · เลือกหลายชื่อได้"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-end gap-2 overflow-x-auto pb-1">
                        {bookedBuyerRounds.map((r) => (
                          <button
                            key={r.token}
                            type="button"
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={() => toggleStaffChipStable(r.token)}
                            className={cn(
                              "flex min-h-[52px] min-w-[4.5rem] max-w-[10rem] shrink-0 flex-col items-center justify-center gap-1 rounded-full px-2.5 py-2 text-center font-semibold ring-1 transition-[filter,box-shadow] touch-manipulation",
                              staffFilters.has(r.token)
                                ? "bg-emerald-600 text-white ring-emerald-500/50"
                                : "bg-white text-emerald-900 ring-emerald-200/90 hover:bg-emerald-100/90"
                            )}
                          >
                            <span className="line-clamp-3 max-w-full text-xs font-medium leading-snug">{r.label}</span>
                            <span className="text-base font-semibold leading-none tabular-nums">{r.count}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {shippedSoldExtrasPanelExpanded && shippedSoldToolbarStats.soldCount > 0 ? (
                    <div className="mt-2 space-y-2 rounded-2xl border border-violet-200/85 bg-violet-50/90 p-2 ring-1 ring-violet-100/80">
                      <div className="mb-0.5">
                        <span className="text-xs font-semibold tracking-wide text-violet-950">{uiLang === "en" ? "Shipped - Advanced Filters" : "ส่งแล้ว — กรองเพิ่ม"}</span>
                        <p className="mt-0.5 text-[10px] font-normal leading-snug text-violet-900/75">
                          {uiLang === "en"
                            ? "cars.shipped and model year filters. Multi-select in each row (OR); rows are combined with AND."
                            : "cars.shipped และ model year · แถวเดียวกันเลือกได้หลายชิป (OR) · สองแถว AND กัน"}
                        </p>
                      </div>
                      <div className="rounded-xl border border-sky-200/80 bg-sky-50/95 p-2">
                        <div className="mb-1.5">
                          <span className="text-[11px] font-semibold text-sky-950">Shipped</span>
                          <p className="text-[10px] text-sky-900/75">{uiLang === "en" ? "All = any shipped value, Empty = cars.shipped is blank" : "ทั้งหมด = ไม่จำกัดข้อความ shipped · ว่าง = ไม่มีข้อความใน cars.shipped"}</p>
                        </div>
                        <div className="flex flex-wrap items-end gap-2 overflow-x-auto pb-0.5">
                          <button
                            type="button"
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={clearSoldShippedDimStable}
                            className={cn(
                              "flex min-h-[52px] min-w-[4.5rem] max-w-[9rem] shrink-0 flex-col items-center justify-center gap-1 rounded-full px-2.5 py-2 text-center font-semibold ring-1 transition-[filter,box-shadow] touch-manipulation",
                              !soldShippedDimActive
                                ? "bg-sky-600 text-white ring-sky-500/50"
                                : "bg-white text-sky-900 ring-sky-200/90 hover:bg-sky-100/90"
                            )}
                          >
                            <span className="line-clamp-2 max-w-full text-xs font-medium leading-snug">{uiLang === "en" ? "All" : "ทั้งหมด"}</span>
                            <span className="text-base font-semibold leading-none tabular-nums">
                              {shippedSoldToolbarStats.soldCount}
                            </span>
                          </button>
                          {shippedSoldToolbarStats.shippedEmpty > 0 ? (
                            <button
                              type="button"
                              onPointerDown={(e) => e.preventDefault()}
                              onClick={() => toggleStaffChipStable(STAFF_FILTER_SOLD_SHIPPED_EMPTY)}
                              className={cn(
                                "flex min-h-[52px] min-w-[4.5rem] max-w-[9rem] shrink-0 flex-col items-center justify-center gap-1 rounded-full px-2.5 py-2 text-center font-semibold ring-1 transition-[filter,box-shadow] touch-manipulation",
                                staffFilters.has(STAFF_FILTER_SOLD_SHIPPED_EMPTY)
                                  ? "bg-sky-600 text-white ring-sky-500/50"
                                  : "bg-white text-sky-900 ring-sky-200/90 hover:bg-sky-100/90"
                              )}
                            >
                              <span className="line-clamp-2 max-w-full text-xs font-medium leading-snug">{uiLang === "en" ? "Empty" : "ว่าง"}</span>
                              <span className="text-base font-semibold leading-none tabular-nums">
                                {shippedSoldToolbarStats.shippedEmpty}
                              </span>
                            </button>
                          ) : null}
                          {shippedSoldToolbarStats.shippedRounds.map((r) => (
                            <button
                              key={r.token}
                              type="button"
                              onPointerDown={(e) => e.preventDefault()}
                              onClick={() => toggleStaffChipStable(r.token)}
                              className={cn(
                                "flex min-h-[52px] min-w-[4.5rem] max-w-[10rem] shrink-0 flex-col items-center justify-center gap-1 rounded-full px-2.5 py-2 text-center font-semibold ring-1 transition-[filter,box-shadow] touch-manipulation",
                                staffFilters.has(r.token)
                                  ? "bg-sky-600 text-white ring-sky-500/50"
                                  : "bg-white text-sky-900 ring-sky-200/90 hover:bg-sky-100/90"
                              )}
                            >
                              <span className="line-clamp-3 max-w-full text-xs font-medium leading-snug">{r.label}</span>
                              <span className="text-base font-semibold leading-none tabular-nums">{r.count}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-xl border border-amber-200/80 bg-amber-50/95 p-2">
                        <div className="mb-1.5">
                          <span className="text-[11px] font-semibold text-amber-950">Model year</span>
                          <p className="text-[10px] text-amber-900/75">{uiLang === "en" ? "All = any year, Empty = no model_year / c_year" : "ทั้งหมด = ไม่จำกัดปี · ว่าง = ไม่มี model_year / c_year"}</p>
                        </div>
                        <div className="flex flex-wrap items-end gap-2 overflow-x-auto pb-0.5">
                          <button
                            type="button"
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={clearSoldModelYearDimStable}
                            className={cn(
                              "flex min-h-[52px] min-w-[4.5rem] max-w-[9rem] shrink-0 flex-col items-center justify-center gap-1 rounded-full px-2.5 py-2 text-center font-semibold ring-1 transition-[filter,box-shadow] touch-manipulation",
                              !soldModelYearDimActive
                                ? "bg-amber-600 text-white ring-amber-500/50"
                                : "bg-white text-amber-900 ring-amber-200/90 hover:bg-amber-100/90"
                            )}
                          >
                            <span className="line-clamp-2 max-w-full text-xs font-medium leading-snug">{uiLang === "en" ? "All" : "ทั้งหมด"}</span>
                            <span className="text-base font-semibold leading-none tabular-nums">
                              {shippedSoldToolbarStats.soldCount}
                            </span>
                          </button>
                          {shippedSoldToolbarStats.modelYearEmpty > 0 ? (
                            <button
                              type="button"
                              onPointerDown={(e) => e.preventDefault()}
                              onClick={() => toggleStaffChipStable(STAFF_FILTER_SOLD_MODEL_YEAR_EMPTY)}
                              className={cn(
                                "flex min-h-[52px] min-w-[4.5rem] max-w-[9rem] shrink-0 flex-col items-center justify-center gap-1 rounded-full px-2.5 py-2 text-center font-semibold ring-1 transition-[filter,box-shadow] touch-manipulation",
                                staffFilters.has(STAFF_FILTER_SOLD_MODEL_YEAR_EMPTY)
                                  ? "bg-amber-600 text-white ring-amber-500/50"
                                  : "bg-white text-amber-900 ring-amber-200/90 hover:bg-amber-100/90"
                              )}
                            >
                              <span className="line-clamp-2 max-w-full text-xs font-medium leading-snug">{uiLang === "en" ? "Empty" : "ว่าง"}</span>
                              <span className="text-base font-semibold leading-none tabular-nums">
                                {shippedSoldToolbarStats.modelYearEmpty}
                              </span>
                            </button>
                          ) : null}
                          {shippedSoldToolbarStats.modelYearRounds.map((r) => (
                            <button
                              key={r.token}
                              type="button"
                              onPointerDown={(e) => e.preventDefault()}
                              onClick={() => toggleStaffChipStable(r.token)}
                              className={cn(
                                "flex min-h-[52px] min-w-[4.5rem] max-w-[10rem] shrink-0 flex-col items-center justify-center gap-1 rounded-full px-2.5 py-2 text-center font-semibold ring-1 transition-[filter,box-shadow] touch-manipulation",
                                staffFilters.has(r.token)
                                  ? "bg-amber-600 text-white ring-amber-500/50"
                                  : "bg-white text-amber-900 ring-amber-200/90 hover:bg-amber-100/90"
                              )}
                            >
                              <span className="line-clamp-3 max-w-full text-xs font-medium leading-snug">{r.label}</span>
                              <span className="text-base font-semibold leading-none tabular-nums">{r.count}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {vacantSaleModelYearPanelExpanded && vacantSaleToolbarStats.vacantCount > 0 ? (
                    <div className="mt-2 rounded-2xl border border-rose-200/85 bg-rose-50/90 p-2 ring-1 ring-rose-100/80">
                      <div className="mb-1.5">
                        <span className="text-xs font-semibold tracking-wide text-rose-950">{uiLang === "en" ? "Model Year - Available" : "Model year — ว่าง"}</span>
                        <p className="mt-0.5 text-[10px] font-normal leading-snug text-rose-900/75">
                          {uiLang === "en"
                            ? "Only for sale status \"Available\". All = any year, Empty = no model_year / c_year, multi chips = OR."
                            : "เฉพาะสถานะขาย \"ว่าง\" · ทั้งหมด = ไม่จำกัดปี · ว่าง = ไม่มี model_year / c_year · หลายชิป = OR"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-end gap-2 overflow-x-auto pb-0.5">
                        <button
                          type="button"
                          onPointerDown={(e) => e.preventDefault()}
                          onClick={clearVacantSaleModelYearDimStable}
                          className={cn(
                            "flex min-h-[52px] min-w-[4.5rem] max-w-[9rem] shrink-0 flex-col items-center justify-center gap-1 rounded-full px-2.5 py-2 text-center font-semibold ring-1 transition-[filter,box-shadow] touch-manipulation",
                            !vacantSaleModelYearDimActive
                              ? "bg-rose-600 text-white ring-rose-500/50"
                              : "bg-white text-rose-900 ring-rose-200/90 hover:bg-rose-100/90"
                          )}
                        >
                          <span className="line-clamp-2 max-w-full text-xs font-medium leading-snug">{uiLang === "en" ? "All" : "ทั้งหมด"}</span>
                          <span className="text-base font-semibold leading-none tabular-nums">
                            {vacantSaleToolbarStats.vacantCount}
                          </span>
                        </button>
                        {vacantSaleToolbarStats.modelYearEmpty > 0 ? (
                          <button
                            type="button"
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={() => toggleStaffChipStable(STAFF_FILTER_VACANT_MODEL_YEAR_EMPTY)}
                            className={cn(
                              "flex min-h-[52px] min-w-[4.5rem] max-w-[9rem] shrink-0 flex-col items-center justify-center gap-1 rounded-full px-2.5 py-2 text-center font-semibold ring-1 transition-[filter,box-shadow] touch-manipulation",
                              staffFilters.has(STAFF_FILTER_VACANT_MODEL_YEAR_EMPTY)
                                ? "bg-rose-600 text-white ring-rose-500/50"
                                : "bg-white text-rose-900 ring-rose-200/90 hover:bg-rose-100/90"
                            )}
                          >
                            <span className="line-clamp-2 max-w-full text-xs font-medium leading-snug">{uiLang === "en" ? "Empty" : "ว่าง"}</span>
                            <span className="text-base font-semibold leading-none tabular-nums">
                              {vacantSaleToolbarStats.modelYearEmpty}
                            </span>
                          </button>
                        ) : null}
                        {vacantSaleToolbarStats.modelYearRounds.map((r) => (
                          <button
                            key={r.token}
                            type="button"
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={() => toggleStaffChipStable(r.token)}
                            className={cn(
                              "flex min-h-[52px] min-w-[4.5rem] max-w-[10rem] shrink-0 flex-col items-center justify-center gap-1 rounded-full px-2.5 py-2 text-center font-semibold ring-1 transition-[filter,box-shadow] touch-manipulation",
                              staffFilters.has(r.token)
                                ? "bg-rose-600 text-white ring-rose-500/50"
                                : "bg-white text-rose-900 ring-rose-200/90 hover:bg-rose-100/90"
                            )}
                          >
                            <span className="line-clamp-3 max-w-full text-xs font-medium leading-snug">{r.label}</span>
                            <span className="text-base font-semibold leading-none tabular-nums">{r.count}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="rounded-2xl bg-slate-100/80 p-2">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold tracking-wide text-slate-600">{uiLang === "en" ? "Staff (Item Owners)" : "พนักงาน (รายการงาน)"}</span>
                    <button
                      type="button"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => setShowStaffManager((open) => !open)}
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                        showStaffManager ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200/60"
                      )}
                      aria-expanded={showStaffManager}
                    >
                      {(uiLang === "en" ? "Manage Staff" : "จัดการพนักงาน") + (showStaffManager ? " ⌃" : " ⌄")}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-end gap-2 overflow-x-auto pb-1">
                    <button
                      type="button"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => toggleStaffChipStable("ทั้งหมด")}
                      className={cn(
                        "flex min-h-[52px] min-w-[4.5rem] shrink-0 flex-col items-center justify-center gap-1 rounded-full px-3 py-2 text-center transition-colors touch-manipulation",
                        staffFilters.size === 0 ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200/70"
                      )}
                    >
                      <span className="text-xs font-medium leading-tight">{uiLang === "en" ? "All" : "ทั้งหมด"}</span>
                      <span className="text-base font-semibold leading-none tabular-nums">{staffAssigneeItemCounts.grandTotal}</span>
                    </button>
                    {staffUnassignedChipInToolbar ? (
                      <button
                        type="button"
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => toggleStaffChipStable(STAFF_FILTER_UNASSIGNED)}
                        className={cn(
                          "flex min-h-[52px] min-w-[4.25rem] max-w-[7.5rem] shrink-0 flex-col items-center justify-center gap-1 rounded-full px-2.5 py-2 text-center font-semibold ring-1 transition-[filter,box-shadow] touch-manipulation",
                          assigneeStaffFilterChipClasses(STAFF_FILTER_UNASSIGNED_LABEL, staffFilters.has(STAFF_FILTER_UNASSIGNED))
                        )}
                      >
                        <span className="line-clamp-2 max-w-full text-xs font-medium leading-snug">{displayStaffFilterUnassignedLabel(uiLang)}</span>
                        <span className="text-base font-semibold leading-none tabular-nums">{staffAssigneeItemCounts.unassigned}</span>
                      </button>
                    ) : null}
                    {staffFilterChipNamesForToolbar.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => toggleStaffChipStable(s)}
                        className={cn(
                          "flex min-h-[52px] min-w-[4.25rem] max-w-[7.5rem] shrink-0 flex-col items-center justify-center gap-1 rounded-full px-2.5 py-2 text-center font-semibold ring-1 transition-[filter,box-shadow] touch-manipulation",
                          assigneeStaffFilterChipClasses(
                            s,
                            staffFilters.has(s),
                            staffToolbarAssigneePaletteIndexByName.get(s)
                          )
                        )}
                      >
                        <span className="line-clamp-2 max-w-full text-xs font-medium leading-snug">{s}</span>
                        <span className="text-base font-semibold leading-none tabular-nums">{staffAssigneeItemCounts.byAssignee[s] ?? 0}</span>
                      </button>
                    ))}
                  </div>
                  {showStaffManager ? (
                    <div className="mt-2 space-y-2 rounded-2xl bg-slate-100 p-2.5">
                      <p className="text-xs font-normal leading-snug text-slate-600">
                        {uiLang === "en"
                          ? "Manage owner names here only. Add/remove filter roster names (saved on server, cached locally if server unavailable)."
                          : "เปิดจากที่นี่เท่านั้น — เพิ่ม/ลบชื่อในรายชื่อกรอง (เก็บบนเซิร์ฟเวอร์ · แคชในเครื่องถ้าเซิร์ฟเวอร์ไม่พร้อม)"}
                      </p>
                      <ul className="max-h-40 space-y-1 overflow-y-auto">
                        {staffRoster.length === 0 ? (
                          <li className="text-[11px] font-semibold text-slate-400">{uiLang === "en" ? "No names yet (add below)" : "ยังไม่มีชื่อ (เพิ่มด้านล่าง)"}</li>
                        ) : (
                          staffRoster.map((name) => (
                            <li key={name} className="flex items-center justify-between gap-2 rounded-xl bg-white px-2 py-1.5">
                              <span className="min-w-0 truncate text-sm font-medium text-slate-800">{name}</span>
                              <button
                                type="button"
                                onPointerDown={(e) => e.preventDefault()}
                                onClick={() => removeStaffFromRoster(name)}
                                className="shrink-0 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-800"
                              >
                                {uiLang === "en" ? "Remove" : "ลบ"}
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                      <div className="flex gap-2">
                        <input
                          value={staffNameInput}
                          onChange={(e) => setStaffNameInput(e.target.value)}
                          placeholder={uiLang === "en" ? "Type name then add" : "พิมพ์ชื่อแล้วกดเพิ่ม"}
                          className="min-w-0 flex-1 rounded-2xl bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none ring-1 ring-slate-200/80"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addStaffToRoster(staffNameInput);
                              setStaffNameInput("");
                            }
                          }}
                        />
                        <button
                          type="button"
                          onPointerDown={(e) => e.preventDefault()}
                          onClick={() => {
                            addStaffToRoster(staffNameInput);
                            setStaffNameInput("");
                          }}
                          className="shrink-0 rounded-2xl bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white touch-manipulation"
                        >
                          {uiLang === "en" ? "Add" : "เพิ่ม"}
                        </button>
                      </div>
                      <div className="border-t border-slate-200/80 pt-2">
                        <p className="mb-2 text-xs font-semibold tracking-wide text-slate-600">
                          {uiLang === "en" ? "Map Sale Code -> Owner" : "จับคู่เซลล์ → พนักงานรับผิดชอบ"}
                        </p>
                        <p className="mb-2 text-[11px] font-normal leading-snug text-slate-500">
                          {uiLang === "en"
                            ? "After mapping, new items auto-select owner by sale code (fallback: first name in roster)."
                            : "ตั้งค่าแล้ว เวลากดเพิ่มงานในการ์ดจะเลือกชื่อพนักงานให้ตามเซลล์ของรถ (ถ้าไม่ได้จับคู่จะใช้ชื่อแรกในรายการด้านบนเหมือนเดิม)"}
                        </p>
                        <ul className="max-h-56 space-y-1.5 overflow-y-auto">
                          {ORDER_TRACKING_SALE_CODES.map((code) => (
                            <li
                              key={code}
                              className="flex min-h-[44px] items-center gap-2 rounded-xl bg-white px-2 py-1.5 ring-1 ring-slate-200/60"
                            >
                              <span className="w-14 shrink-0 text-center text-xs font-bold tabular-nums text-slate-800">
                                {code}
                              </span>
                              <select
                                aria-label={uiLang === "en" ? `Owner for sale code ${code}` : `พนักงานสำหรับเซลล์ ${code}`}
                                value={saleAssignees[code] ?? ""}
                                onChange={(e) => setSaleAssigneeForCode(code, e.target.value)}
                                className="min-w-0 flex-1 rounded-xl bg-slate-50 px-2 py-2 text-sm font-medium text-slate-900 outline-none ring-1 ring-slate-200/80"
                              >
                                <option value="">{uiLang === "en" ? "— Unassigned —" : "— ไม่ระบุ —"}</option>
                                {staffRoster.map((n) => (
                                  <option key={n} value={n}>
                                    {n}
                                  </option>
                                ))}
                              </select>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}
                  <div className="mb-1 mt-3 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold tracking-wide text-slate-600">{uiLang === "en" ? "Item Status" : "สถานะรายการ"}</span>
                    <button
                      type="button"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => setShowStatusManager((open) => !open)}
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                        showStatusManager ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200/60"
                      )}
                      aria-expanded={showStatusManager}
                    >
                      {(uiLang === "en" ? "Manage Status" : "จัดการสถานะ") + (showStatusManager ? " ⌃" : " ⌄")}
                    </button>
                  </div>
                  {showStatusManager ? (
                    <div className="mt-2 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80">
                      <div className="max-h-[min(72vh,32rem)] space-y-0 overflow-y-auto overscroll-contain px-3 py-3 touch-pan-y">
                        <div>
                          <p className="text-xs font-semibold leading-snug text-slate-900">
                            {uiLang === "en" ? "Item status — all in one panel" : "ตั้งค่าสถานะรายการ — ในแผงเดียว"}
                          </p>
                          <p className="mt-1 text-[11px] font-normal leading-snug text-slate-600">
                            {uiLang === "en"
                              ? "Toolbar order & labels cache on device. Deposit / SLA / “Due today” sync to the server when available."
                              : "ลำดับและชื่อชิปเก็บในเคื่อง · การนับวันฝาก / SLA / ชิปมาวันนี้ ซิงก์เมื่อมีเซิร์ฟเวอร์"}
                          </p>
                        </div>

                        <div className="mt-4 border-t border-slate-200/70 pt-4">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {uiLang === "en" ? "Filter bar" : "แถบกรองชิป"}
                          </p>
                          <p className="mt-2 text-[10px] font-normal leading-relaxed text-slate-600">
                            {uiLang === "en"
                              ? "On each active row: edit the chip text, tap Up / Down to reorder left-to-right on the bar, tap Remove from bar to tuck it below. dashed rows → Add to bar restores it."
                              : "ในแถวที่อยู่แถบ: ช่องกลางคือแก้ไขชื่อบนชิป · ปุ่ม “ขึ้น/ลง” เปลี่ยนลำดับชิปบนแถบ · “ลบจากแถบ” เอาออกจากแถบ (ไปอยู่กลุ่มเส้นประด้านล่าง) · แถวเส้นประมีปุ่ม “เพิ่มเข้าแถบ”"}
                          </p>
                          <div className="mt-3 rounded-xl bg-white p-2.5 ring-1 ring-slate-200/70">
                            <p className="text-[11px] font-semibold leading-snug text-slate-800">
                              {uiLang === "en" ? "All statuses (code → chip label)" : "รายการสถานะทั้งหมด (โค้ดไทย → ชื่อบนชิป)"}
                            </p>
                            <p className="mt-1 text-[10px] text-slate-500">
                              {uiLang === "en"
                                ? "Fixed system codes · label follows your edits above when on the bar."
                                : "โค้ดในระบบคงที่ · ชื่อบนชิปตามที่แก้ในรายการด้านล่างเมื่ออยู่ในแถบ"}
                            </p>
                            <ol className="mt-2 max-h-[11.5rem] list-decimal space-y-1.5 overflow-y-auto overscroll-contain pl-[1.125rem] pr-1 marker:text-[10px] marker:font-semibold marker:text-slate-400 touch-pan-y sm:max-h-none sm:marker:text-[11px]">
                              {sortItemStatusesForFilterToolbar([...ITEM_STATUSES]).map((st) => (
                                <li key={`ref-status-${st}`} className="pl-1 text-[11px] leading-snug text-slate-800">
                                  <span className="font-bold">{st}</span>
                                  <span className="text-slate-400"> → </span>
                                  <span className="font-medium text-slate-700">
                                    {statusLabel(st as ItemStatusFilterValue)}
                                  </span>
                                </li>
                              ))}
                            </ol>
                          </div>
                          <ul className="mt-3 space-y-2">
                          {itemStatusRoster.length === 0 ? (
                            <li className="rounded-xl bg-slate-50 px-2 py-2 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-100 leading-relaxed">
                              {uiLang === "en"
                                ? "Default: all statuses show on the bar. Remove at least one status here → it moves into the dashed list below until you tap Add to bar."
                                : "เริ่มต้นแถบครบทุกสถานะ · แตะ “ลบจากแถบ” แถวใดหนึ่งบน เพื่อเริ่มกำหนดเอง สถานะที่เหลือจะโผล่ในกลุ่มเส้นประ ใช้ปุ่ม “เพิ่มเข้าแถบ” คืนได้"}
                            </li>
                          ) : null}
                          {itemStatusRoster.map((st, rank) => (
                              <li key={st} className="rounded-2xl bg-slate-50 p-2.5 ring-1 ring-slate-100">
                                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-stretch sm:gap-3">
                                  <div className="flex shrink-0 flex-row items-center gap-2 sm:w-[5.75rem] sm:flex-col sm:items-stretch">
                                    <span className="inline-flex w-fit rounded-lg bg-white px-2 py-1 text-center text-[11px] font-bold tracking-tight text-slate-800 ring-1 ring-slate-200/90">
                                      {st}
                                    </span>
                                    <span className="text-[10px] font-medium leading-snug text-slate-500 sm:flex-1 sm:pt-0.5">
                                      {uiLang === "en" ? `${rank + 1} on bar` : `ลำดับที่ ${rank + 1} บนแถบ`}
                                    </span>
                                  </div>
                                  <div className="min-w-0 flex-1 space-y-1">
                                    <label
                                      htmlFor={`item-status-chip-label-${encodeURIComponent(st)}`}
                                      className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500"
                                    >
                                      {uiLang === "en" ? "Edit chip label" : "แก้ไขชื่อบนชิป"}
                                    </label>
                                    <input
                                      id={`item-status-chip-label-${encodeURIComponent(st)}`}
                                      value={itemStatusLabels[st] ?? st}
                                      onChange={(e) => updateItemStatusLabel(st, e.target.value)}
                                      placeholder={st}
                                      aria-label={
                                        uiLang === "en"
                                          ? `Display label on filter chip (${st})`
                                          : `ชื่อแสดงบนชิปสถานะ ${st}`
                                      }
                                      className="min-h-11 w-full rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none ring-1 ring-slate-200/80 placeholder:text-slate-400 focus:ring-2 focus:ring-slate-400/50"
                                    />
                                  </div>
                                  <div className="flex shrink-0 gap-1.5 max-sm:flex-1">
                                    <button
                                      type="button"
                                      onPointerDown={(e) => e.preventDefault()}
                                      onClick={() => moveItemStatusInRoster(st, -1)}
                                      className="min-h-11 min-w-[4.25rem] flex-1 touch-manipulation rounded-xl bg-slate-200/90 px-2 text-[11px] font-bold text-slate-800 shadow-sm active:bg-slate-300 sm:min-w-[3.5rem] sm:flex-none"
                                      aria-label={uiLang === "en" ? `Move «${st}» up on bar` : `เลื่อน ${st} ขึ้น`}
                                      title={uiLang === "en" ? "Move up · earlier on bar" : "ขึ้น · เร็วขึ้นบนชุดชิป"}
                                    >
                                      {uiLang === "en" ? "↑ Up" : "↑ ขึ้น"}
                                    </button>
                                    <button
                                      type="button"
                                      onPointerDown={(e) => e.preventDefault()}
                                      onClick={() => moveItemStatusInRoster(st, 1)}
                                      className="min-h-11 min-w-[4.25rem] flex-1 touch-manipulation rounded-xl bg-slate-200/90 px-2 text-[11px] font-bold text-slate-800 shadow-sm active:bg-slate-300 sm:min-w-[3.5rem] sm:flex-none"
                                      aria-label={uiLang === "en" ? `Move «${st}» down on bar` : `เลื่อน ${st} ลง`}
                                      title={uiLang === "en" ? "Move down · later on bar" : "ลง · ช้าลงในชุดชิป"}
                                    >
                                      {uiLang === "en" ? "↓ Down" : "↓ ลง"}
                                    </button>
                                    <button
                                      type="button"
                                      onPointerDown={(e) => e.preventDefault()}
                                      onClick={() => removeItemStatusFromRoster(st)}
                                      className="min-h-11 touch-manipulation rounded-xl bg-rose-100 px-3 text-[11px] font-bold text-rose-900 ring-1 ring-rose-200/80 active:bg-rose-200/80 sm:px-2.5"
                                      aria-label={uiLang === "en" ? `Remove «${st}» from bar` : `ลบ ${st} ออกจากแถบกรอง`}
                                      title={uiLang === "en" ? "Remove from bar (restore below)" : "ลบจากแถบ (ไปกลุ่มเส้นประ)"}
                                    >
                                      {uiLang === "en" ? "Remove" : "ลบจากแถบ"}
                                    </button>
                                  </div>
                                </div>
                              </li>
                            ))}
                          {itemStatusRoster.length > 0 && addableItemStatuses.length > 0
                            ? addableItemStatuses.map((st) => {
                                const lbl = statusLabel(st as ItemStatusFilterValue);
                                return (
                                  <li
                                    key={`toolbar-off-${st}`}
                                    className="rounded-2xl border border-dashed border-slate-300/80 bg-slate-50/40 p-2.5"
                                  >
                                    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
                                      <span className="inline-flex w-fit shrink-0 rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200/80">
                                        {st}
                                      </span>
                                      <div className="min-w-0 flex-1">
                                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                          {uiLang === "en" ? "Not on bar" : "ยังไม่อยู่ในแถบกรอง"}
                                        </p>
                                        <p className="truncate text-sm font-semibold text-slate-700">{lbl}</p>
                                      </div>
                                      <button
                                        type="button"
                                        onPointerDown={(e) => e.preventDefault()}
                                        onClick={() => addItemStatusToRoster(st)}
                                        className="min-h-11 shrink-0 touch-manipulation rounded-xl bg-slate-950 px-4 text-xs font-bold text-white shadow-sm active:bg-slate-800"
                                        aria-label={
                                          uiLang === "en"
                                            ? `Add «${st}» to filter bar`
                                            : `เพิ่ม ${st} เข้าแถบกรอง`
                                        }
                                        title={uiLang === "en" ? "Add to bar" : "เพิ่มเข้าแถบกรอง"}
                                      >
                                        {uiLang === "en" ? "+ Add to bar" : "+ เพิ่มเข้าแถบ"}
                                      </button>
                                    </div>
                                  </li>
                                );
                              })
                            : null}
                        </ul>
                        </div>

                        <div className="mt-4 border-t border-slate-200/70 pt-4">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {uiLang === "en" ? "Due-today chip" : "ชิปมาวันนี้"}
                          </p>
                          <p className="mt-1 text-[10px] font-normal leading-snug text-slate-500">
                            {uiLang === "en"
                              ? "Includes items whose status is selected and Thailand due-date offset equals the number (0 = due today)."
                              : "เลือกสถานะที่เข้ากลุ่ม แล้วกำหนดค่าระยะจากวันนี้ถึง due (0 = พอดีวันนี้, กทม.)"}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {ITEM_STATUSES.map((st) => {
                              const on = itemStatusPoliciesNormalized.dueToday.statuses.includes(st);
                              return (
                                <button
                                  key={st}
                                  type="button"
                                  onPointerDown={(e) => e.preventDefault()}
                                  onClick={() => toggleDueTodayPolicyStatus(st)}
                                  className={cn(
                                    "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors touch-manipulation",
                                    on ? "bg-slate-950 text-white" : "bg-slate-200/80 text-slate-700"
                                  )}
                                >
                                  {statusLabel(st as ItemStatusFilterValue)}
                                </button>
                              );
                            })}
                          </div>
                          <label className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-700">
                            <span className="shrink-0">{uiLang === "en" ? "Match daysUntil" : "เทียบ daysUntilBangkok"}</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              step={1}
                              value={itemStatusPoliciesNormalized.dueToday.matchDaysUntilDueBangkok}
                              onChange={(e) => setDueTodayPolicyMatchDays(e.target.value)}
                              className="w-24 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm font-semibold tabular-nums outline-none ring-1 ring-transparent focus:ring-slate-300"
                            />
                          </label>
                        </div>

                        <div className="mt-4 border-t border-slate-200/70 pt-4">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {uiLang === "en" ? "Rules per status code" : "โค้ดสถานะ · due / ฝาก / SLA"}
                          </p>
                          <ul className="mt-2 space-y-1.5">
                          {ITEM_STATUSES.map((st) => {
                            const row = itemStatusPoliciesNormalized.byStatus[st];
                            return (
                              <li key={st} className="rounded-xl bg-slate-50 px-2 py-1.5 ring-1 ring-slate-100">
                                <div className="text-[11px] font-bold leading-tight text-slate-900">
                                  <span>{st}</span>
                                  <span className="ml-1 font-normal text-slate-600">· {statusLabel(st as ItemStatusFilterValue)}</span>
                                </div>
                                <div className="mt-2 flex flex-col gap-2">
                                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px] font-medium text-slate-700">
                                    <label className="inline-flex cursor-pointer items-center gap-1.5">
                                      <input
                                        type="checkbox"
                                        checked={row.arrivalDueDate}
                                        onChange={() =>
                                          patchItemStatusPolicy(st, { arrivalDueDate: !row.arrivalDueDate })
                                        }
                                        className="h-4 w-4 shrink-0 rounded border-slate-300"
                                      />
                                      {uiLang === "en" ? "Due date drives arrival ETA" : "ใช้ due เป็นกำหนดมา"}
                                    </label>
                                    <label className="inline-flex cursor-pointer items-center gap-1.5">
                                      <input
                                        type="checkbox"
                                        checked={row.storeDepositClock}
                                        onChange={() => {
                                          const nextOn = !row.storeDepositClock;
                                          patchItemStatusPolicy(st, {
                                            storeDepositClock: nextOn,
                                            storeDepositMaxDays: nextOn
                                              ? row.storeDepositMaxDays ?? DEFAULT_STORE_DEPOSIT_MAX_DAYS
                                              : row.storeDepositMaxDays,
                                          });
                                        }}
                                        className="h-4 w-4 shrink-0 rounded border-slate-300"
                                      />
                                      {uiLang === "en" ? "Store deposit cap" : "เพดานวันฝากสโตร์"}
                                    </label>
                                  </div>
                                  <div className="flex flex-wrap gap-3">
                                    {row.storeDepositClock ? (
                                      <label className="flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
                                        <span className="font-medium">{uiLang === "en" ? "Cap days" : "เพดานวัน"}</span>
                                        <input
                                          type="number"
                                          inputMode="numeric"
                                          min={1}
                                          max={730}
                                          value={row.storeDepositMaxDays == null ? "" : String(row.storeDepositMaxDays)}
                                          onChange={(e) => {
                                            patchItemStatusPolicy(st, {
                                              storeDepositMaxDays: parseOptionalPolicyDay(e.target.value),
                                            });
                                          }}
                                          placeholder={String(DEFAULT_STORE_DEPOSIT_MAX_DAYS)}
                                          className="w-[4.25rem] rounded-lg bg-white px-1.5 py-1 text-xs font-semibold tabular-nums ring-1 ring-slate-200/80"
                                        />
                                      </label>
                                    ) : null}
                                    <label className="flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
                                      <span className="font-medium">{uiLang === "en" ? "Days in-status (warn)" : "อยู่สถานะเกินวัน (เตือน)"}</span>
                                      <input
                                        type="number"
                                        inputMode="numeric"
                                        min={1}
                                        max={730}
                                        value={row.slaMaxCalendarDaysInStatus == null ? "" : String(row.slaMaxCalendarDaysInStatus)}
                                        onChange={(e) => {
                                          patchItemStatusPolicy(st, {
                                            slaMaxCalendarDaysInStatus: parseOptionalPolicyDay(e.target.value),
                                          });
                                        }}
                                        placeholder="—"
                                        className="w-[4.25rem] rounded-lg bg-white px-1.5 py-1 text-xs font-semibold tabular-nums ring-1 ring-slate-200/80"
                                      />
                                    </label>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={clearItemStatusFiltersStable}
                      className={cn(
                        "flex min-h-[52px] min-w-[5rem] shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center touch-manipulation transition-colors",
                        itemStatusFilters.size === 0 ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200/70"
                      )}
                    >
                      <div className="text-xs font-medium leading-snug">{uiLang === "en" ? "Show all" : "แสดงทั้งหมด"}</div>
                      <div className="text-base font-semibold tabular-nums">{itemStatusTotalCount}</div>
                    </button>
                    <LineInboxAiToolbar
                      orders={lineInboxAiOrderPicks}
                      uiLang={uiLang}
                      preferredOrderId={initialFocusedOrderId}
                      onSaved={() => router.refresh()}
                    />
                    {itemStatusFilterOptionsForToolbar.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => toggleItemStatusChipStable(s)}
                        title={
                          s === ITEM_STATUS_DUE_TODAY
                            ? uiLang === "en"
                              ? `Matches due-day rule: statuses ${itemStatusPoliciesNormalized.dueToday.statuses.join(", ")} · daysUntilBangkok=${itemStatusPoliciesNormalized.dueToday.matchDaysUntilDueBangkok}`
                              : `ชิปมาวันนี้: สถานะ ${itemStatusPoliciesNormalized.dueToday.statuses.join(" · ")} · daysUntilBangkok=${itemStatusPoliciesNormalized.dueToday.matchDaysUntilDueBangkok}`
                            : undefined
                        }
                        className={cn(
                          "flex min-h-[52px] min-w-[4.25rem] max-w-[7rem] shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center transition-colors touch-manipulation",
                          toolbarItemStatusFilterChipClasses(s, itemStatusFilters.has(s))
                        )}
                      >
                        <span className="line-clamp-3 max-w-full text-xs font-medium leading-snug">{statusLabel(s)}</span>
                        <span className="text-base font-semibold tabular-nums">
                          {s === ITEM_STATUS_DUE_TODAY ? dueTodayItemCount : itemStatusCounts.get(s) ?? 0}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
          </>
        </header>
        <main className="px-0 pb-3 pt-0 sm:px-3">
            <div className="space-y-3 pb-4">
              {visiblePaged.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  uiLang={uiLang}
                  staffRosterNames={staffRoster}
                  saleAssigneesBySale={saleAssignees}
                  shareBaseUrl={shareBaseUrl}
                  itemStatusLabels={itemStatusLabels}
                  itemPoliciesNorm={itemStatusPoliciesNormalized}
                  itemStatusRosterForCard={itemStatusRoster}
                  toolbarStaffFilters={staffFilters}
                  toolbarStatusFilters={itemStatusFilters}
                  onLiveItemsChange={handleOrderLiveItemsChange}
                />
              ))}
              {hasMoreVisible ? (
                <div ref={loadMoreRef} className="h-9 w-full rounded-2xl bg-slate-100 text-center text-sm font-medium leading-9 text-slate-600">
                  {uiLang === "en" ? "Loading more..." : "กำลังโหลดเพิ่ม..."} ({visiblePaged.length}/{visible.length})
                </div>
              ) : null}
              {!visible.length ? (
                <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/60">
                  <p className="text-base font-semibold leading-snug text-slate-800">
                    {mappedOrders.length === 0
                      ? (uiLang === "en" ? "No orders found in system yet" : "ยังไม่มีงานในระบบ")
                      : (uiLang === "en" ? "No orders match current filters" : "ไม่พบงานที่ตรงกับตัวกรอง")}
                  </p>
                  {mappedOrders.length > 0 ? (
                    <>
                      <p className="mt-2 text-xs font-semibold leading-relaxed text-slate-500">
                        {uiLang === "en"
                          ? "Try clearing search, or changing sale code / sale status / owner / item status filters."
                          : "ลองล้างช่องค้นหา หรือเปลี่ยนเซลล์ / สถานะขาย / พนักงาน / สถานะรายการ"}
                      </p>
                      <button type="button" onClick={clearFiltersStable} className="mt-4 h-11 w-full max-w-[280px] rounded-2xl bg-slate-950 text-sm font-semibold text-white touch-manipulation">
                        {uiLang === "en" ? "Clear filters" : "ล้างตัวกรอง"}
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
        </main>
      </div>
    </div>
    </>
  );
}
