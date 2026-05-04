"use client";

import React, { useMemo, useRef, useState, useEffect, useLayoutEffect, startTransition } from "react";
import { flushSync } from "react-dom";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import type { Car } from "@/types/car";
import { ORDER_ITEMS_TABLE_NAME, ORDER_TASK_UPDATES_TABLE_NAME } from "@/lib/data/orders";
import { isStaffRosterNameExcluded, normalizeStaffRosterNames } from "@/lib/orders/staff-roster-shared";

const SALE_STATUSES = ["ทั้งหมด", "จอง", "รอส่ง", "ส่งแล้ว", "ว่าง"] as const;
const ITEM_STATUSES = ["เช็ค", "มี", "ต้องสั่ง", "สั่ง", "มา", "รถนอก", "ช่างนอก", "ฝากสโตร์", "ฝากกับรถ", "จบ"] as const;
const WAITING = ["เช็ค", "ต้องสั่ง", "สั่ง"] as const;
const DONE = ["มี", "มา", "รถนอก", "ช่างนอก", "จบ"] as const;
const STATUS_ACTION_NOTE = "__NOTE__";
/** ความกว้างแถบเมื่อปัดเปิด — ปัดขวา=แก้ไข (ซ้าย) / ปัดซ้าย=ลบ (ขวา) (px) */
const SWIPE_ROW_ACTION_PX = 84;
/** ปัดเกินสัดส่วนนี้ของแถบแล้วปล่อย = สแนปเปิด (ต่ำ = ปัดง่ายขึ้น) */
const SWIPE_ROW_SNAP_RATIO = 0.22;
/** ดึงลงรีเฟรช — ระยะดึง (หลังลดแรง) ที่ปล่อยแล้วให้ refresh */
const PTR_RELEASE_DAMPED_PX = 28;
const STAFF_ROSTER_STORAGE_KEY = "vigo4u.orderTracking.staffRoster";
const ITEM_STATUS_ROSTER_STORAGE_KEY = "vigo4u.orderTracking.itemStatusRoster";
const STAFF_ROSTER_API_PATH = "/api/m/order-tracking/staff-roster";

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
/** เลือกเซลล์เพิ่มจากชีต */
const ALL_SALES = [
  "ALL",
  "AOR",
  "BAM",
  "FAH",
  "FAIRY",
  "GOOD",
  "GWANG",
  "KOI",
  "MAI",
  "NAT",
  "NOEY",
  "PANG",
  "PLOO",
  "SINE",
  "TARN",
  "WAN",
  "YING",
] as const;
const ORDERS_PAGE_SIZE = 40;
/** ความยาวสูงสุดช่องค้นหา (แป้น + วางจาก LINE / คลิปบอร์ด) */
const VEHICLE_SEARCH_MAX = 48;
const CHASSIS_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const SALE_STATUS_PRIORITY: Record<SaleStatusValue, number> = {
  รอส่ง: 0,
  จอง: 1,
  ว่าง: 2,
  ส่งแล้ว: 3,
};

type StaffValue = string;
type SaleValue = string;
type SaleStatusValue = Exclude<(typeof SALE_STATUSES)[number], "ทั้งหมด">;
type SaleStatusFilterValue = (typeof SALE_STATUSES)[number];
type ItemStatusValue = (typeof ITEM_STATUSES)[number];
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

const ALLOWED_ITEM_STATUS_SET = new Set<string>(ITEM_STATUSES);

function parseItemStatusRosterJson(raw: string | null): ItemStatusValue[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const seen = new Set<ItemStatusValue>();
    const unique: ItemStatusValue[] = [];
    for (const x of parsed) {
      const s = String(x).trim();
      if (!ALLOWED_ITEM_STATUS_SET.has(s)) continue;
      const st = s as ItemStatusValue;
      if (seen.has(st)) continue;
      seen.add(st);
      unique.push(st);
    }
    if (!unique.length) return null;
    const ordered = [...ITEM_STATUS_ORDER].filter((s) => seen.has(s));
    const extras = unique.filter((s) => !ordered.includes(s));
    return [...ordered, ...extras];
  } catch {
    return null;
  }
}

/** ชิปกรองสถานะรายการ — เหมือน roster พนักงาน · เก็บ localStorage เครื่องนี้ */
function readItemStatusRosterFromStorage(): ItemStatusValue[] {
  if (typeof window === "undefined") return [...ITEM_STATUS_ORDER];
  return parseItemStatusRosterJson(localStorage.getItem(ITEM_STATUS_ROSTER_STORAGE_KEY)) ?? [...ITEM_STATUS_ORDER];
}

function writeItemStatusRosterToStorage(roster: ItemStatusValue[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ITEM_STATUS_ROSTER_STORAGE_KEY, JSON.stringify(roster));
  } catch {
    /* ignore */
  }
}

const WAITING_SET = new Set<ItemStatusValue>(WAITING);
const DONE_SET = new Set<ItemStatusValue>(DONE);

type OrderItem = {
  id?: string | null;
  orderTaskId?: string | null;
  name: string;
  status: ItemStatusValue;
  assignee: string;
  dueDate?: string;
  /** ฝากสโตร์: วันเริ่มนับ 30 วัน (yyyy-mm-dd กทม.) จาก updated_at/created_at ใน DB */
  clockStartYmd?: string;
  note?: string;
  good?: boolean;
  supplier?: string;
  eta?: string;
  price?: string;
  overdue?: boolean;
};

type Order = {
  id: string;
  carRowId: string | null;
  carId: number | null;
  sale: string;
  modelYear: string;
  saleStatus: SaleStatusValue;
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

type MobileOrderTrackingHomeProps = {
  carsData?: Car[];
  orderItemsByCar?: Record<
    string,
    Array<{
      id?: string | null;
      order_task_id?: string | null;
      label: string;
      status: string;
      assignee_staff: string | null;
      due_date?: string | null;
      note?: string | null;
      outside_supplier: string | null;
      outside_eta_date: string | null;
      outside_price: number | null;
      clock_start_ymd?: string | null;
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
};

const ORDERS: Order[] = [
  {
    id: "OT-1024",
    carRowId: null,
    carId: null,
    sale: "WAN",
    saleStatus: "จอง",
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
async function readClipboardTextSafe(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}

/** บรรทัดแรกจากการวาง — ไทย / A–Z / เลข / ช่องว่าง */
function sanitizeVehicleSearchPaste(raw: string): string {
  const line = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean) ?? "";
  const cleaned = line
    .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, VEHICLE_SEARCH_MAX);
}

/** ข้อความในช่องแสดง — ตัวเลขอ่านลื่น, ว่างเป็น em dash, ยาวตัดท้าย */
function vehicleSearchFieldDisplay(raw: string, maxVisible = 14): string {
  const t = raw.trim();
  if (!t) return "—";
  if (t.length <= maxVisible) return t;
  return `…${t.slice(-(maxVisible - 1))}`;
}

/** สไตล์ช่องแสดงค่า — ตัวเลขอ่านสบาย */
const vehicleSearchFieldDisplayBase =
  "inline-flex min-h-11 min-w-[3rem] max-w-[min(100%,14rem)] shrink-0 items-center justify-center rounded-2xl bg-slate-950 px-3 py-2.5 text-center text-base font-semibold tabular-nums tracking-normal text-white";

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
    return String(a.name ?? "").localeCompare(String(b.name ?? ""), "th", { sensitivity: "base" });
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

function orderItemShareLine(item: OrderItem): string {
  const name = String(item.name ?? "").trim() || "(ไม่มีชื่อ)";
  const bits: string[] = [name, item.status];
  const asg = String(item.assignee ?? "").trim();
  if (asg) bits.push(asg);
  if (item.status === "ฝากสโตร์") {
    if (item.clockStartYmd?.trim()) {
      bits.push(`ลงข้อมูล ${formatDateInput(item.clockStartYmd)} · ${storeDeposit30DayLabel(item.clockStartYmd)}`);
    } else {
      bits.push(storeDeposit30DayLabel(undefined));
    }
  } else if (item.dueDate?.trim()) {
    bits.push(`มา ${formatDateInput(item.dueDate)}`);
  }
  const note = item.note?.trim();
  if (note) bits.push(`หมายเหตุ: ${note}`);
  return `• ${bits.join(" · ")}`;
}

function buildLineShareMessage(order: Order, shareItems: OrderItem[]): string {
  const carLine = carHeadlineForShare(order.fullPlate, order.car);
  const header = `งาน ${carLine}
${order.chassis}
Sale: ${order.sale}
ลูกค้า: ${order.buyer}`;
  const sorted = sortOrderItemsForShare(shareItems);
  const baseLines = sorted.map(orderItemShareLine);
  const footer = `

ลิงก์งาน:
${order.link}`;

  let lines = [...baseLines];
  const makeBody = (cur: string[]) => {
    if (cur.length === 0) return `\n\nรายการงาน: ยังไม่มี`;
    const omitted = baseLines.length - cur.length;
    if (omitted > 0) {
      return `\n\nรายการงาน (${sorted.length}) — แสดง ${cur.length} รายการ:\n${cur.join("\n")}\n… และอีก ${omitted} รายการ (ดูครบในแอป)`;
    }
    return `\n\nรายการงาน (${sorted.length}):\n${cur.join("\n")}`;
  };

  let body = makeBody(lines);
  let msg = header + body + footer;
  while (msg.length > LINE_SHARE_MAX_CHARS && lines.length > 1) {
    lines = lines.slice(0, -1);
    body = makeBody(lines);
    msg = header + body + footer;
  }
  if (msg.length > LINE_SHARE_MAX_CHARS) {
    msg = `${msg.slice(0, LINE_SHARE_MAX_CHARS - 24).trimEnd()}\n…ตัดข้อความ`;
  }
  return msg;
}

const BANGKOK_TZ = "Asia/Bangkok";

function todayBangkokYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: BANGKOK_TZ });
}

/** จำนวนวันปฏิทินจากวันนี้ (กทม.) ถึงวันครบ (yyyy-mm-dd) — ลบ = เลยกำหนดแล้ว, 0 = วันนี้ครบ, 1 = พรุ่งนี้ครบ */
function calendarDaysUntilDueBangkok(dueYmd: string | undefined): number | null {
  const raw = String(dueYmd ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const todayYmd = new Date().toLocaleDateString("en-CA", { timeZone: BANGKOK_TZ });
  const t0 = new Date(`${todayYmd}T12:00:00+07:00`).getTime();
  const d0 = new Date(`${raw}T12:00:00+07:00`).getTime();
  if (Number.isNaN(t0) || Number.isNaN(d0)) return null;
  return Math.round((d0 - t0) / (24 * 60 * 60 * 1000));
}

/** เหลือง = เหลือ 1 วันก่อนวันมา · แดง = วันนี้ครบหรือเลยกำหนด */
function dueDateArrivalButtonTone(dueYmd: string | undefined): "amber" | "red" | "sky" {
  const days = calendarDaysUntilDueBangkok(dueYmd);
  if (days == null) return "sky";
  if (days <= 0) return "red";
  if (days === 1) return "amber";
  return "sky";
}

const STORE_DEPOSIT_ALLOWANCE_DAYS = 30;

/** วันอ้างอิง yyyy-mm-dd (กทม.) → จำนวนวันปฏิทินที่ผ่านมาถึงวันนี้ (วันเดียวกัน = 0) — ใช้กับ ฝากสโตร์ */
function calendarDaysSinceDepositBangkok(depositYmd: string | undefined): number | null {
  const raw = String(depositYmd ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const todayYmd = new Date().toLocaleDateString("en-CA", { timeZone: BANGKOK_TZ });
  const t0 = new Date(`${todayYmd}T12:00:00+07:00`).getTime();
  const d0 = new Date(`${raw}T12:00:00+07:00`).getTime();
  if (Number.isNaN(t0) || Number.isNaN(d0)) return null;
  return Math.round((t0 - d0) / (24 * 60 * 60 * 1000));
}

/** นับ 30 วันปฏิทิน (กทม.) จากวันที่ลงข้อมูลในระบบ (clock ymd) — เกินแล้ว "หมดเวลา" */
function storeDeposit30DayLabel(clockYmd: string | undefined): string {
  const elapsed = calendarDaysSinceDepositBangkok(clockYmd);
  if (elapsed == null) return "ไม่มีวันลงข้อมูล";
  if (elapsed < 0) return "ไม่มีวันลงข้อมูล";
  const left = STORE_DEPOSIT_ALLOWANCE_DAYS - elapsed;
  if (left <= 0) return "หมดเวลา";
  return `เหลือ ${left} วัน`;
}

function storeDepositCountdownTone(clockYmd: string | undefined): "amber" | "red" | "sky" {
  const elapsed = calendarDaysSinceDepositBangkok(clockYmd);
  if (elapsed == null || elapsed < 0) return "sky";
  const left = STORE_DEPOSIT_ALLOWANCE_DAYS - elapsed;
  if (left <= 0) return "red";
  if (left <= 3) return "red";
  if (left <= 7) return "amber";
  return "sky";
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
      status,
      assignee,
      /** fetchOrderItemsByCars รวม due_date + outside_eta_date, note + outside_note แล้ว */
      dueDate: item.due_date?.trim() ? item.due_date.trim().slice(0, 10) : undefined,
      clockStartYmd: (() => {
        const raw = String((item as { clock_start_ymd?: unknown }).clock_start_ymd ?? "").trim().slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
      })(),
      note: item.note?.trim() || undefined,
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

/** แป้นค้นหา — แตะช่องตัวเลข = วางจากคลิปบอร์ด · ค้นหา = พับ */
function VehicleSearchPad({
  value,
  onPressChar,
  onClear,
  onDelete,
  onCollapse,
  onPaste,
}: {
  value: string;
  onPressChar: (ch: string) => void;
  onClear: () => void;
  onDelete?: () => void;
  onCollapse?: () => void;
  onPaste?: () => void;
}) {
  const displayValue = vehicleSearchFieldDisplay(value);
  return (
    <div className="rounded-2xl bg-slate-100/90 p-3 ring-1 ring-slate-200/60">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          {onCollapse ? (
            <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={onCollapse} className="text-left">
              <span className="text-sm font-semibold text-slate-900">ค้นหา</span>
            </button>
          ) : (
            <span className="text-sm font-semibold text-slate-900">ค้นหา</span>
          )}
        </div>
        {onPaste ? (
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={onPaste}
            title="แตะเพื่อวางจากคลิปบอร์ด"
            aria-label="วางจากคลิปบอร์ด"
            className={cn(vehicleSearchFieldDisplayBase, "cursor-pointer truncate active:bg-slate-800")}
          >
            {displayValue}
          </button>
        ) : (
          <div className={cn(vehicleSearchFieldDisplayBase, "cursor-default select-none truncate")}>{displayValue}</div>
        )}
        {onDelete ? (
          <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={onDelete} className="h-10 shrink-0 rounded-2xl bg-slate-950 px-3 text-xs font-semibold text-white touch-manipulation">
            ลบ
          </button>
        ) : null}
        <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={onClear} className="h-10 shrink-0 rounded-2xl bg-white px-3 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 touch-manipulation">
          ล้าง
        </button>
      </div>
      <div className="mb-2 grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((n) => (
          <button
            key={n}
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => onPressChar(String(n))}
            className={cn(
              "h-11 rounded-2xl text-base font-semibold tabular-nums tracking-normal",
              value.endsWith(String(n)) ? "bg-slate-950 text-white" : "bg-white ring-1 ring-slate-200/80 shadow-sm"
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="grid max-h-36 grid-cols-5 gap-2 overflow-y-auto pr-0.5">
        {CHASSIS_LETTERS.map((letter) => (
          <button
            key={letter}
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => onPressChar(letter)}
            className={cn(
              "h-10 rounded-2xl text-sm font-semibold",
              value.endsWith(letter) ? "bg-slate-950 text-white" : "bg-white ring-1 ring-slate-200/80 shadow-sm"
            )}
          >
            {letter}
          </button>
        ))}
      </div>
    </div>
  );
}

type OrderItemRow = OrderItem & { uid: string };

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

function OrderCard({
  order,
  staffRosterNames,
  onAddStaffToRoster,
}: {
  order: Order;
  staffRosterNames: string[];
  onAddStaffToRoster: (name: string) => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<OrderItemRow[]>(() =>
    (order.items || []).map((item, index) => ({
      ...item,
      uid: String(item.id ?? "").trim() ? String(item.id) : `row-${order.id}-${index}-${norm(item.name)}`,
    }))
  );
  const [showAllItems, setShowAllItems] = useState(false);
  const [showCost, setShowCost] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savingItemUid, setSavingItemUid] = useState<string | null>(null);
  const [showInlineIntake, setShowInlineIntake] = useState(false);
  const [inlineText, setInlineText] = useState("");
  const [inlineItems, setInlineItems] = useState<Array<{ id: string; name: string; duplicate: boolean; assignee: string; status: ItemStatusValue }>>([]);
  const [inlineSaving, setInlineSaving] = useState(false);
  const [inlineMessage, setInlineMessage] = useState("");
  const [newStaff, setNewStaff] = useState("");
  const [noteOpenUid, setNoteOpenUid] = useState<string | null>(null);
  const [datePickerUid, setDatePickerUid] = useState<string | null>(null);
  const itemsRef = useRef<OrderItemRow[]>(items);
  const noteDebounceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const nameDebounceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const rowSwipeGestureRef = useRef<{ uid: string; startX: number; base: number; lastOffset: number } | null>(null);
  const [rowSwipePx, setRowSwipePx] = useState<Record<string, number>>({});
  const lastPersistedSigByUidRef = useRef<Record<string, string>>({});

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

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
    const mapped = (order.items || []).map((item, index) => ({
      ...item,
      uid: String(item.id ?? "").trim() ? String(item.id) : `row-${order.id}-${index}-${norm(item.name)}`,
    }));
    setItems(mapped);
    const nextSigs: Record<string, string> = {};
    for (const row of mapped) {
      nextSigs[row.uid] = orderItemPersistSignature(row);
    }
    lastPersistedSigByUidRef.current = nextSigs;
  }, [order.items, order.id]);

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
    return Array.from(names).sort((a, b) => a.localeCompare(b, "th"));
  }, [items, staffRosterNames]);

  /** เพิ่มงาน (LINE intake): พนักงานเริ่มต้น = ชื่อแรกในรายชื่อตั้งค่า (ลำดับในรายการจัดการพนักงาน) */
  const defaultIntakeAssignee = useMemo(() => {
    for (const n of staffRosterNames) {
      const t = String(n).trim();
      if (t && !isStaffRosterNameExcluded(t)) return t;
    }
    return "";
  }, [staffRosterNames]);

  const waiting = items.filter((item) => WAITING_SET.has(item.status));
  const done = items.filter((item) => item.good || DONE_SET.has(item.status));
  const activeItems = items.filter((item) => item.status !== "จบ");
  const hiddenDoneItems = items.filter((item) => item.status === "จบ");
  /** คงลำดับแถวตามข้อมูลเดิม — ไม่เรียงตามสถานะเวลาเปลี่ยนสถานะในการ์ด */
  const compareItems = showAllItems ? items : activeItems;
  const allDone = done.length >= items.length && items.length > 0;
  const lineShareText = useMemo(() => buildLineShareMessage(order, items), [order, items]);
  const lineShareUrl = useMemo(
    () => `https://line.me/R/msg/text/?${encodeURIComponent(lineShareText)}`,
    [lineShareText]
  );

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
    rowSwipeGestureRef.current = null;
    setRowSwipePx({});
  };

  const persistItem = async (prevItem: OrderItemRow, nextItem: OrderItemRow) => {
    const sig = orderItemPersistSignature(nextItem);
    const prevSig = lastPersistedSigByUidRef.current[nextItem.uid];
    if (prevSig !== undefined && prevSig === sig) {
      return;
    }
    setSavingItemUid(nextItem.uid);
    setSaveError("");
    try {
      const res = await fetch("/api/m/order-items/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        }),
      });
      const payload = (await res.json()) as { error?: string; order_item_id?: string | null; order_task_id?: string | null };
      if (!res.ok) throw new Error(payload.error ?? res.statusText);
      lastPersistedSigByUidRef.current[nextItem.uid] = sig;
      const todayY = todayBangkokYmd();
      const becameStoreDeposit = nextItem.status === "ฝากสโตร์" && prevItem.status !== "ฝากสโตร์";
      setItems((current) =>
        current.map((candidate) => {
          if (candidate.uid !== nextItem.uid) return candidate;
          const merged = {
            ...candidate,
            id: payload.order_item_id ?? candidate.id ?? null,
            orderTaskId: payload.order_task_id ?? candidate.orderTaskId ?? null,
          };
          if (nextItem.status !== "ฝากสโตร์") return merged;
          const nextClock = becameStoreDeposit ? todayY : merged.clockStartYmd ?? todayY;
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
        };
        return prev.map((item) => (item.uid === uid ? next : item));
      });
      noteDebounceTimersRef.current[uid] = setTimeout(() => {
        delete noteDebounceTimersRef.current[uid];
        const live = itemsRef.current.find((row) => row.uid === uid);
        if (live) void persistItem(live, live);
      }, 480);
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
        };
        return prev.map((item) => (item.uid === uid ? next : item));
      });
      nameDebounceTimersRef.current[uid] = setTimeout(() => {
        delete nameDebounceTimersRef.current[uid];
        const live = itemsRef.current.find((row) => row.uid === uid);
        if (live) void persistItem(live, live);
      }, 520);
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

  const addStaffOption = () => {
    const value = newStaff.trim();
    if (!value) return;
    if (!staffRosterNames.includes(value)) onAddStaffToRoster(value);
    setNewStaff("");
  };

  const splitInlineText = () => {
    setInlineItems(
      inlineText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((name, index) => ({
          id: `${order.id}-new-${index}`,
          name,
          duplicate: items.some((old) => norm(old.name).includes(norm(name)) || norm(name).includes(norm(old.name))),
          assignee: defaultIntakeAssignee,
          status: "เช็ค" as ItemStatusValue,
        }))
    );
  };

  const removeInlineItem = (id: string) => {
    setInlineItems((prev) => prev.filter((item) => item.id !== id));
  };

  const updateInlineItem = (
    id: string,
    patch: Partial<Pick<{ name: string; status: ItemStatusValue; assignee: string }, "name" | "status" | "assignee">>
  ) => {
    setInlineItems((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const nextName = patch.name !== undefined ? patch.name : row.name;
        const next = { ...row, ...patch, name: nextName };
        const trimmed = nextName.trim();
        const duplicate =
          trimmed.length > 0 &&
          items.some((old) => norm(old.name).includes(norm(trimmed)) || norm(trimmed).includes(norm(old.name)));
        return { ...next, duplicate };
      })
    );
  };

  const pushEmptyInlineItem = () => {
    setInlineItems((prev) => [
      ...prev,
      {
        id: `${order.id}-manual-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: "",
        duplicate: false,
        assignee: defaultIntakeAssignee,
        status: "เช็ค" as ItemStatusValue,
      },
    ]);
  };

  const addInlineItemsToOrder = async () => {
    if (!inlineItems.length) return;
    const cleaned = inlineItems.map((item) => ({ ...item, name: item.name.trim() })).filter((item) => item.name.length > 0);
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
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? res.statusText);
      setInlineItems([]);
      setInlineText("");
      setShowInlineIntake(false);
      router.refresh();
    } catch (error) {
      setInlineMessage(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
    } finally {
      setInlineSaving(false);
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
    return Array.from(s).sort((x, y) => x.localeCompare(y, "th"));
  };

  const focusItemNameInput = (uid: string) => {
    closeSwipeRows();
    requestAnimationFrame(() => {
      const el = document.getElementById(`order-item-name-${uid}`) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
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
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    let baseFromState = 0;
    setRowSwipePx((prev) => {
      baseFromState = prev[uid] ?? 0;
      return { [uid]: baseFromState };
    });
    rowSwipeGestureRef.current = {
      uid,
      startX: e.clientX,
      base: baseFromState,
      lastOffset: baseFromState,
    };
  };

  const onRowPointerMove = (e: React.PointerEvent, uid: string) => {
    const g = rowSwipeGestureRef.current;
    if (!g || g.uid !== uid) return;
    e.preventDefault();
    const dx = e.clientX - g.startX;
    const offset = Math.max(-SWIPE_ROW_ACTION_PX, Math.min(SWIPE_ROW_ACTION_PX, g.base + dx));
    g.lastOffset = offset;
    setRowSwipePx((prev) => ({ ...prev, [uid]: offset }));
  };

  const onRowPointerUpOrCancel = (e: React.PointerEvent, uid: string) => {
    const g = rowSwipeGestureRef.current;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!g || g.uid !== uid) return;
    rowSwipeGestureRef.current = null;
    const cur = g.lastOffset;
    const thresh = SWIPE_ROW_ACTION_PX * SWIPE_ROW_SNAP_RATIO;
    let snap = 0;
    if (cur < -thresh) snap = -SWIPE_ROW_ACTION_PX;
    else if (cur > thresh) snap = SWIPE_ROW_ACTION_PX;
    setRowSwipePx((prev) => {
      const next = { ...prev };
      if (snap === 0) delete next[uid];
      else next[uid] = snap;
      return next;
    });
  };

  return (
    <article className="rounded-none bg-white px-2 py-2.5 shadow-sm ring-1 ring-slate-200/60 sm:rounded-2xl sm:px-3 sm:py-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <a href={order.photo} target="_blank" rel="noopener noreferrer" className="block text-slate-900">
            <span className="text-[15px] font-semibold leading-snug sm:text-base">{order.car}</span>
            <span className="mt-1 block break-all font-mono text-xs font-normal leading-normal text-slate-500">{order.chassis}</span>
          </a>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-medium leading-snug text-slate-600">
            <span className="rounded-full bg-slate-100 px-2.5 py-1">{order.sale}</span>
            <span className="min-w-0 max-w-full truncate rounded-full bg-slate-100 px-2.5 py-1">{order.buyer} · {formatUsd(order.salePrice)}</span>
            <button type="button" onClick={() => setShowCost(!showCost)} className="rounded-full bg-slate-200/80 px-2.5 py-1 text-xs font-semibold text-slate-800 touch-manipulation">
              COST {formatUsd(order.cost)} {showCost ? "⌃" : "⌄"}
            </button>
          </div>
          {showCost ? (
            <div className="mt-2 overflow-hidden rounded-2xl bg-slate-50 text-sm font-medium leading-relaxed text-slate-700">
              <div className="flex items-center justify-between gap-2 bg-slate-950 px-3 py-2.5 text-white">
                <span className="text-sm font-semibold tracking-tight">สรุปต้นทุน</span>
                {order.expensePdf ? (
                  <a
                    href={order.expensePdf}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white hover:bg-white/25"
                  >
                    ค่าอะไหล่/ของแต่ง
                  </a>
                ) : (
                  <span
                    className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/50"
                    title="ยังไม่มีลิงก์ค่าอะไหล่/ของแต่ง (part_accessories)"
                  >
                    ค่าอะไหล่/ของแต่ง
                  </span>
                )}
              </div>
              <div className="space-y-2 p-3">
                <div className="rounded-2xl bg-white p-2.5">
                  <div className="mb-1 text-xs font-semibold tracking-wide text-slate-500">ต้นทุนรวม</div>
                  <p className="whitespace-pre-wrap break-words leading-relaxed text-slate-800">{order.costDetail || order.costBreakdown || order.cost || "-"}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-2xl bg-white p-2.5">
                    <div className="mb-1 text-xs font-semibold tracking-wide text-slate-500">ซ่อม</div>
                    <p className="whitespace-pre-wrap break-words leading-relaxed text-slate-700">{order.repairDetail || order.repairDetails || "-"}</p>
                  </div>
                  <div className="rounded-2xl bg-white p-2.5">
                    <div className="mb-1 text-xs font-semibold tracking-wide text-slate-500">เอกสาร</div>
                    <p className="whitespace-pre-wrap break-words leading-relaxed text-slate-700">{order.documentDetail || "-"}</p>
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
          onClick={() => setShowInlineIntake((v) => !v)}
          className="shrink-0 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 touch-manipulation"
        >
          เพิ่มงาน
        </button>
        {items.length > 0 ? (
          <span
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium",
              allDone ? "bg-emerald-50 text-emerald-800" : "bg-amber-100 text-amber-900"
            )}
          >
            {allDone ? `จบ ${done.length}/${items.length}` : `รอ ${waiting.length}/${items.length}`}
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-900">ยังไม่มีรายการ</span>
        )}
        <a
          href={lineShareUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 touch-manipulation"
        >
          แชร์
        </a>
      </div>

      <div className="space-y-1">
        {compareItems.map((item) => {
          const isWaiting = WAITING_SET.has(item.status);
          const isSaving = savingItemUid === item.uid;
          const showNoteRow = noteOpenUid === item.uid || Boolean(item.note?.trim());
          const swipeX = rowSwipePx[item.uid] ?? 0;
          return (
            <div key={item.uid} className="relative overflow-hidden rounded-2xl">
              <div className="absolute inset-y-0 left-0 z-0 flex items-stretch bg-sky-600" style={{ width: SWIPE_ROW_ACTION_PX }}>
                <button
                  type="button"
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={() => focusItemNameInput(item.uid)}
                  className="flex flex-1 items-center justify-center text-xs font-semibold text-white"
                >
                  แก้ไข
                </button>
              </div>
              <div className="absolute inset-y-0 right-0 z-0 flex items-stretch bg-rose-600" style={{ width: SWIPE_ROW_ACTION_PX }}>
                <button
                  type="button"
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={() => void handleDeleteItem(item)}
                  disabled={isSaving}
                  className="flex flex-1 items-center justify-center text-xs font-semibold text-white disabled:opacity-50"
                >
                  ลบ
                </button>
              </div>
              <div
                style={{ transform: `translateX(${swipeX}px)` }}
                onPointerDown={(e) => onRowPointerDown(e, item.uid)}
                onPointerMove={(e) => onRowPointerMove(e, item.uid)}
                onPointerUp={(e) => onRowPointerUpOrCancel(e, item.uid)}
                onPointerCancel={(e) => onRowPointerUpOrCancel(e, item.uid)}
                className={cn(
                  "relative z-[1] flex touch-manipulation flex-col rounded-2xl py-1.5 pl-0.5 pr-2 will-change-transform sm:py-2 sm:pr-3",
                  item.overdue ? "bg-red-50" : isWaiting ? "bg-amber-50" : "bg-slate-100"
                )}
              >
              <div className="flex min-w-0 w-full flex-1 flex-row items-stretch">
              <div
                className="flex w-8 shrink-0 flex-col items-center justify-center gap-0.5 rounded-l-xl border border-slate-300/35 bg-slate-200/35 px-1 touch-none select-none text-slate-500 active:bg-slate-300/55 sm:w-9"
                aria-label="ลากเพื่อเปิดลบหรือแก้ไข"
                title="ปัดขวา = แก้ไข · ปัดซ้าย = ลบ"
              >
                <span className="block h-1 w-1 shrink-0 rounded-full bg-current opacity-55" />
                <span className="block h-1 w-1 shrink-0 rounded-full bg-current opacity-55" />
                <span className="block h-1 w-1 shrink-0 rounded-full bg-current opacity-55" />
              </div>
              <div
                className={cn(
                  "min-w-0 flex-1",
                  showNoteRow ? "flex flex-col gap-1.5" : "flex flex-nowrap items-center gap-1 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch]"
                )}
              >
                <div
                  className={cn(
                    "flex min-w-0 w-full items-center gap-1",
                    showNoteRow ? "flex-nowrap overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch]" : "contents"
                  )}
                >
                  <input
                    id={`order-item-name-${item.uid}`}
                    value={item.name}
                    onChange={(e) => patchItem(item, { name: e.target.value })}
                    onBlur={() => void flushPendingNamePersist(item.uid)}
                    placeholder="ชื่องาน"
                    className={cn(
                      "min-w-0 rounded-xl bg-transparent px-1.5 py-1.5 text-sm font-medium text-slate-900 outline-none focus:bg-white focus:ring-2 focus:ring-slate-300/80 sm:text-[15px]",
                      showNoteRow ? "w-full flex-1 basis-0 sm:min-w-[40%]" : "flex-1 basis-0"
                    )}
                  />
                  <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
                    <select
                      value={item.assignee || ""}
                      onChange={(e) => patchItem(item, { assignee: e.target.value })}
                      title="พนักงาน"
                      className="h-10 min-h-[40px] w-[76px] min-w-[4.5rem] shrink-0 touch-manipulation rounded-full border-0 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 shadow-sm outline-none ring-1 ring-slate-200/80 sm:w-[88px]"
                    >
                      <option value="">—</option>
                      {assigneeSelectOptions(item.assignee).map((staffName) => (
                        <option key={staffName} value={staffName}>
                          {staffName}
                        </option>
                      ))}
                    </select>

                    {item.status === "สั่ง" ? (
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
                        {item.dueDate ? `มา ${formatDateInput(item.dueDate)}` : "เลือกวันที่"}
                      </button>
                    ) : null}

                    {item.status === "ฝากสโตร์" ? (
                      <span
                        className={cn(
                          "shrink-0 max-w-[9.5rem] truncate rounded-full px-2 py-1 text-[11px] font-semibold leading-tight ring-1 sm:max-w-[11rem]",
                          (() => {
                            const tone = storeDepositCountdownTone(item.clockStartYmd);
                            if (tone === "amber") return "bg-amber-100 text-amber-950 ring-amber-400/50";
                            if (tone === "red") return "bg-red-100 text-red-900 ring-red-400/50";
                            return "bg-slate-200/90 text-slate-800 ring-slate-400/40";
                          })()
                        )}
                        title="นับ 30 วันปฏิทิน (เวลาไทย) จากวันที่ลงข้อมูลในระบบ (อัปเดตล่าสุดของแถว)"
                      >
                        {item.clockStartYmd ? `${formatDateInput(item.clockStartYmd)} · ` : ""}
                        {storeDeposit30DayLabel(item.clockStartYmd)}
                      </span>
                    ) : null}

                    <select
                      value={item.status}
                      onChange={(e) => updateStatus(item.uid, e.target.value)}
                      title="สถานะรายการ"
                      className={cn(
                        "h-10 min-h-[40px] w-[5.5rem] shrink-0 touch-manipulation rounded-full border-0 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 shadow-sm outline-none ring-1 ring-slate-200/80 sm:w-[6.25rem]",
                        isWaiting ? "text-amber-900" : "text-emerald-900"
                      )}
                    >
                      {ITEM_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                      <option value={STATUS_ACTION_NOTE}>หมายเหตุ</option>
                    </select>
                  </div>
                </div>

                {showNoteRow ? (
                  <div className="flex min-w-0 w-full flex-wrap items-center gap-1.5 border-t border-slate-200/70 pt-1.5">
                    <span className="shrink-0 rounded-full bg-white px-2 py-1 text-xs font-medium text-sky-800 ring-1 ring-sky-200/80">
                      หมายเหตุ
                    </span>
                    <input
                      value={item.note ?? ""}
                      onChange={(e) => patchItem(item, { note: e.target.value })}
                      onBlur={() => void flushPendingNotePersist(item.uid)}
                      placeholder="พิมพ์…"
                      className="min-h-[2.25rem] min-w-0 flex-1 rounded-lg bg-white px-2 py-1.5 text-xs font-medium text-slate-800 outline-none ring-1 ring-slate-200/80 placeholder:text-slate-400 sm:min-w-[12rem]"
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
                      เสร็จ
                    </button>
                  </div>
                ) : null}
              </div>
              </div>

              <div className="mt-1 flex flex-wrap items-center justify-end gap-1 pl-8 text-xs text-slate-500 sm:pl-9">
                {isSaving ? <span className="font-medium">กำลังบันทึก…</span> : null}
              </div>
              </div>
            </div>
          );
        })}
        {saveError ? <p className="text-xs font-medium leading-snug text-rose-700">บันทึกไม่สำเร็จ: {saveError}</p> : null}
        {hiddenDoneItems.length > 0 ? (
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

      {showInlineIntake && !!inlineItems.length ? (
        <div className="mt-2 space-y-1.5">
          {inlineItems.map((row) => (
            <div key={row.id} className={cn("rounded-2xl px-2.5 py-2", row.duplicate ? "bg-red-50" : "bg-slate-100")}>
              <input
                value={row.name}
                onChange={(e) => updateInlineItem(row.id, { name: e.target.value })}
                placeholder="ชื่องาน"
                className="mb-2 w-full rounded-xl border-0 bg-white px-2.5 py-2.5 text-sm font-medium text-slate-900 outline-none ring-1 ring-slate-200/80 focus:ring-2 focus:ring-slate-300/80"
              />
              <div className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch]">
                <select
                  value={row.status}
                  onChange={(e) => updateInlineItem(row.id, { status: e.target.value as ItemStatusValue })}
                  title="สถานะ"
                  className="h-10 min-h-[40px] w-[5.75rem] shrink-0 touch-manipulation rounded-full border-0 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 shadow-sm outline-none ring-1 ring-slate-200/80"
                >
                  {ITEM_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
                <select
                  value={row.assignee || ""}
                  onChange={(e) => updateInlineItem(row.id, { assignee: e.target.value })}
                  title="พนักงาน"
                  className="h-10 min-h-[40px] w-[84px] min-w-[4.75rem] touch-manipulation rounded-full border-0 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 shadow-sm outline-none ring-1 ring-slate-200/80 sm:w-[92px]"
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
                  ลบ
                </button>
              </div>
              <p className="mt-1.5 text-xs font-medium">
                {row.duplicate ? <span className="text-red-600">ซ้ำกับรายการบนการ์ด</span> : <span className="text-emerald-600">รายการใหม่</span>}
              </p>
            </div>
          ))}
          <button
            type="button"
            onClick={() => void addInlineItemsToOrder()}
            disabled={inlineSaving}
            className={cn("h-10 w-full rounded-2xl text-sm font-semibold text-white touch-manipulation", inlineSaving ? "bg-slate-400" : "bg-emerald-600")}
          >
            {inlineSaving ? "กำลังบันทึก…" : "เพิ่มรายการเข้ารถคันนี้"}
          </button>
          {inlineMessage ? <p className="text-xs font-medium leading-snug text-rose-700">{inlineMessage}</p> : null}
        </div>
      ) : null}

      {showInlineIntake ? (
        <div className="mt-2 rounded-2xl bg-slate-100 p-2">
          <p className="mb-2 text-sm font-medium leading-snug text-slate-600">รับงานจาก LINE · รถคันนี้เท่านั้น</p>
          <div className="mb-2 flex gap-2">
            <input
              value={newStaff}
              onChange={(e) => setNewStaff(e.target.value)}
              className="min-w-0 flex-1 rounded-2xl bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none ring-1 ring-slate-200/80"
              placeholder="เพิ่มชื่อพนักงาน"
            />
            <button type="button" onClick={addStaffOption} className="rounded-2xl bg-slate-950 px-3 py-2 text-sm font-semibold text-white touch-manipulation">
              เพิ่ม
            </button>
          </div>
          <textarea
            value={inlineText}
            onChange={(e) => setInlineText(e.target.value)}
            className="min-h-28 w-full rounded-2xl bg-white p-3 text-sm font-medium leading-relaxed text-slate-900 outline-none ring-1 ring-slate-200/80"
            placeholder="วางข้อความจาก LINE ของรถคันนี้..."
          />
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={splitInlineText} className="h-11 flex-1 rounded-2xl bg-slate-950 text-sm font-semibold text-white touch-manipulation">
              แยก + เทียบรายการเดิม
            </button>
            <button
              type="button"
              onClick={pushEmptyInlineItem}
              className="h-11 flex-1 rounded-2xl border border-slate-300 bg-white text-sm font-semibold text-slate-800 touch-manipulation"
            >
              เพิ่มแถวว่าง
            </button>
          </div>
        </div>
      ) : null}

      {datePickerUid ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3">
          <div className="w-full max-w-md rounded-2xl bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <b className="text-sm font-semibold text-slate-950">เลือกวันที่ของมา</b>
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

export function MobileOrderTrackingHome({ carsData = [], orderItemsByCar = {}, orderUpdatesByCar = {}, dataWarnings = [] }: MobileOrderTrackingHomeProps) {
  const router = useRouter();
  const orderTrackingRootRef = useRef<HTMLDivElement | null>(null);
  const [ptrPullPx, setPtrPullPx] = useState(0);
  const [ptrRefreshing, setPtrRefreshing] = useState(false);
  const ptrArmRef = useRef(false);
  const ptrStartYRef = useRef(0);
  const ptrStartXRef = useRef(0);
  const ptrPullRef = useRef(0);
  const ptrRefreshingRef = useRef(false);
  const staffRosterPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usingDemoFallback = carsData.length === 0;
  const mappedOrders = useMemo(() => {
    if (carsData.length === 0) return ORDERS;
    return carsData.map((car, index) => toOrderFromCar(car, index, orderItemsByCar, orderUpdatesByCar));
  }, [carsData, orderItemsByCar, orderUpdatesByCar]);
  const [saleFilter, setSaleFilter] = useState<string>("ALL");
  const [saleStatusFilter, setSaleStatusFilter] = useState<SaleStatusFilterValue>("ทั้งหมด");
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [showVehiclePad, setShowVehiclePad] = useState(false);
  const [status, setStatus] = useState<ItemStatusValue | "">("");
  const [staff, setStaff] = useState<StaffValue>("ทั้งหมด");
  const [staffRoster, setStaffRoster] = useState<string[]>(() => []);
  const [staffNameInput, setStaffNameInput] = useState("");
  const [showStaffManager, setShowStaffManager] = useState(false);
  const [itemStatusRoster, setItemStatusRoster] = useState<ItemStatusValue[]>(() => [...ITEM_STATUS_ORDER]);
  const [showStatusManager, setShowStatusManager] = useState(false);
  const [itemStatusAddPick, setItemStatusAddPick] = useState<ItemStatusValue | "">("");
  const [visibleLimit, setVisibleLimit] = useState(ORDERS_PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollYRef = useRef<number | null>(null);
  /** ซ่อนชิปที่นับเป็น 0 เฉพาะตอนโหลดครั้งแรก — หลังล็อกแล้วชิปไม่หายเวลาเปลี่ยนสถานะในการ์ด */
  const staffChipsStickyAfterPrimeRef = useRef<Set<string> | null>(null);
  const itemStatusChipsStickyAfterPrimeRef = useRef<Set<ItemStatusValue> | null>(null);
  const [filterChipLayoutPrimed, setFilterChipLayoutPrimed] = useState(false);

  const saleCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const s of ALL_SALES) {
      acc[s] = s === "ALL" ? mappedOrders.length : mappedOrders.filter((o) => String(o.sale).toUpperCase() === String(s).toUpperCase()).length;
    }
    return acc;
  }, [mappedOrders]);
  /** ชิปเซลล์: ALL อยู่แรกเสมอ ที่เหลือเรียงตามจำนวนจากมากไปน้อย */
  const salesChipsOrdered = useMemo(() => {
    const rest = ALL_SALES.filter((sale) => sale !== "ALL" && (saleCounts[sale] ?? 0) > 0);
    rest.sort((a, b) => {
      const diff = (saleCounts[b] ?? 0) - (saleCounts[a] ?? 0);
      return diff !== 0 ? diff : String(a).localeCompare(String(b), "en", { sensitivity: "base" });
    });
    return ["ALL", ...rest] as const;
  }, [saleCounts]);
  const staffKey = staff === "ทั้งหมด" ? "" : staff;

  /** จำนวนรายการต่อ assignee — ขอบเขตเหมือนชิปสถานะรายการ (ไม่กรองตามพนักงาน) */
  const staffAssigneeItemCounts = useMemo(() => {
    const baseFiltered = mappedOrders.filter((order) => {
      const saleOk = saleFilter === "ALL" || String(order.sale).toUpperCase() === String(saleFilter).toUpperCase();
      const saleStatusOk = saleStatusFilter === "ทั้งหมด" || order.saleStatus === saleStatusFilter;
      const vehicleOk = matchesVehicleSearch(order, vehicleSearch);
      return saleOk && saleStatusOk && vehicleOk;
    });
    const byAssignee: Record<string, number> = {};
    let grandTotal = 0;
    for (const order of baseFiltered) {
      for (const item of order.items) {
        grandTotal += 1;
        const a = String(item.assignee ?? "").trim();
        if (a) byAssignee[a] = (byAssignee[a] ?? 0) + 1;
      }
    }
    return { grandTotal, byAssignee };
  }, [mappedOrders, saleFilter, saleStatusFilter, vehicleSearch]);

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
      return a.localeCompare(b, "th", { sensitivity: "base" });
    });
    for (const n of fromData) push(n);
    return out;
  }, [staffRoster, staffAssigneeItemCounts]);

  /** ชิปพนักงานที่แสดง — ซ่อนเมื่อจำนวนรายการ = 0 */
  const staffFilterChipNamesVisible = useMemo(
    () => staffFilterChipNames.filter((s) => (staffAssigneeItemCounts.byAssignee[s] ?? 0) > 0),
    [staffFilterChipNames, staffAssigneeItemCounts]
  );

  useEffect(() => {
    setItemStatusRoster(readItemStatusRosterFromStorage());
  }, []);

  const flushStaffRosterToServer = React.useCallback(async (names: string[]) => {
    try {
      const res = await fetch(STAFF_ROSTER_API_PATH, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names }),
        cache: "no-store",
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const scheduleStaffRosterPersist = React.useCallback(
    (names: string[]) => {
      writeStaffRosterToStorage(names);
      if (staffRosterPersistTimerRef.current) clearTimeout(staffRosterPersistTimerRef.current);
      staffRosterPersistTimerRef.current = setTimeout(() => {
        staffRosterPersistTimerRef.current = null;
        void flushStaffRosterToServer(names);
      }, 450);
    },
    [flushStaffRosterToServer]
  );

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;

    (async () => {
      const local = readStaffRosterFromStorage();
      try {
        const res = await fetch(STAFF_ROSTER_API_PATH, { cache: "no-store", signal: ac.signal });
        const json = (await res.json()) as { names?: unknown; error?: string };
        if (cancelled) return;
        const serverNames = normalizeStaffRosterNames(json.names);

        if (!res.ok) {
          if (res.status === 503) {
            setStaffRoster(local);
            return;
          }
          setStaffRoster(local.length ? local : serverNames);
          return;
        }

        if (serverNames.length === 0 && local.length > 0) {
          try {
            await fetch(STAFF_ROSTER_API_PATH, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ names: local }),
              cache: "no-store",
              signal: ac.signal,
            });
          } catch {
            /* ignore */
          }
          if (!cancelled) {
            setStaffRoster(local);
            writeStaffRosterToStorage(local);
          }
          return;
        }

        if (!cancelled) {
          setStaffRoster(serverNames);
          writeStaffRosterToStorage(serverNames);
        }
      } catch {
        if (!cancelled) setStaffRoster(readStaffRosterFromStorage());
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
        scheduleStaffRosterPersist(next);
        return next;
      });
    },
    [scheduleStaffRosterPersist]
  );

  const removeStaffFromRoster = React.useCallback(
    (name: string) => {
      setStaffRoster((prev) => {
        const next = prev.filter((n) => n !== name);
        scheduleStaffRosterPersist(next);
        return next;
      });
    },
    [scheduleStaffRosterPersist]
  );

  const addableItemStatuses = useMemo(
    () => ITEM_STATUSES.filter((s) => !itemStatusRoster.includes(s)),
    [itemStatusRoster]
  );

  const addItemStatusToRoster = React.useCallback((st: ItemStatusValue) => {
    setItemStatusRoster((prev) => {
      if (prev.includes(st)) return prev;
      const next = [...prev, st];
      writeItemStatusRosterToStorage(next);
      return next;
    });
  }, []);

  const removeItemStatusFromRoster = React.useCallback((st: ItemStatusValue) => {
    setItemStatusRoster((prev) => {
      const next = prev.filter((x) => x !== st);
      const fallback = next.length ? next : [...ITEM_STATUS_ORDER];
      writeItemStatusRosterToStorage(fallback);
      return fallback;
    });
  }, []);

  const staffFilterChipNamesForToolbar = useMemo(() => {
    const sticky = staffChipsStickyAfterPrimeRef.current;
    if (!filterChipLayoutPrimed || !sticky) {
      return staffFilterChipNamesVisible;
    }
    return staffFilterChipNames.filter(
      (s) => sticky.has(s) || (staffAssigneeItemCounts.byAssignee[s] ?? 0) > 0
    );
  }, [filterChipLayoutPrimed, staffFilterChipNames, staffFilterChipNamesVisible, staffAssigneeItemCounts]);

  useEffect(() => {
    if (staff !== "ทั้งหมด" && !staffFilterChipNamesForToolbar.includes(staff)) {
      setStaff("ทั้งหมด");
    }
  }, [staff, staffFilterChipNamesForToolbar]);

  useEffect(() => {
    if (status && !itemStatusRoster.includes(status)) {
      setStatus("");
    }
  }, [status, itemStatusRoster]);

  const saleStatusCounts = useMemo(() => {
    const baseOrders = mappedOrders.filter((order) => {
      const saleOk = saleFilter === "ALL" || String(order.sale).toUpperCase() === String(saleFilter).toUpperCase();
      const staffOk = !staffKey || order.items.some((item) => item.assignee === staffKey);
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
  }, [mappedOrders, saleFilter, staffKey]);
  const visible = useMemo(
    () =>
      mappedOrders
        .filter((order) => {
          const saleOk = saleFilter === "ALL" || String(order.sale).toUpperCase() === String(saleFilter).toUpperCase();
          const saleStatusOk = saleStatusFilter === "ทั้งหมด" || order.saleStatus === saleStatusFilter;
          const vehicleOk = matchesVehicleSearch(order, vehicleSearch);
          const staffOk = !staffKey || order.items.some((item) => item.assignee === staffKey);
          const statusOk =
            !status ||
            order.items.length === 0 ||
            (status === "จบ"
              ? order.items.every((item) => item.status === "จบ" || item.good)
              : order.items.some((item) => item.status.includes(status)));
          return saleOk && saleStatusOk && vehicleOk && staffOk && statusOk;
        })
        .sort((a, b) => {
          const onlyEmptySelected = saleStatusFilter === "ว่าง";
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
    [saleStatusFilter, vehicleSearch, staffKey, status, mappedOrders, saleFilter]
  );
  /** Per-status item counts from current `mappedOrders` (Supabase-backed or in-file `ORDERS` demo) with same filters as the list. */
  const itemStatusCounts = useMemo(() => {
    const counts = new Map<ItemStatusValue, number>();
    for (const s of ITEM_STATUSES) counts.set(s, 0);
    const baseFiltered = mappedOrders.filter((order) => {
      const saleOk = saleFilter === "ALL" || String(order.sale).toUpperCase() === String(saleFilter).toUpperCase();
      const saleStatusOk = saleStatusFilter === "ทั้งหมด" || order.saleStatus === saleStatusFilter;
      const vehicleOk = matchesVehicleSearch(order, vehicleSearch);
      return saleOk && saleStatusOk && vehicleOk;
    });
    for (const order of baseFiltered) {
      for (const item of order.items) {
        if (staffKey && item.assignee !== staffKey) continue;
        counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
      }
    }
    return counts;
  }, [mappedOrders, saleStatusFilter, vehicleSearch, staffKey, saleFilter]);

  /** ชิปสถานะที่แสดง — ซ่อนเมื่อจำนวนรายการ = 0 (เฉพาะก่อนล็อกครั้งแรก; หลังล็อกใช้ itemStatusRosterForToolbar) */
  const itemStatusRosterVisible = useMemo(
    () => itemStatusRoster.filter((s) => (itemStatusCounts.get(s) ?? 0) > 0),
    [itemStatusRoster, itemStatusCounts]
  );

  const itemStatusRosterForToolbar = useMemo(() => {
    const sticky = itemStatusChipsStickyAfterPrimeRef.current;
    if (!filterChipLayoutPrimed || !sticky) {
      return itemStatusRosterVisible;
    }
    return itemStatusRoster.filter((s) => sticky.has(s) || (itemStatusCounts.get(s) ?? 0) > 0);
  }, [filterChipLayoutPrimed, itemStatusRoster, itemStatusRosterVisible, itemStatusCounts]);

  useLayoutEffect(() => {
    if (filterChipLayoutPrimed) return;
    if (mappedOrders.length === 0 && staffAssigneeItemCounts.grandTotal === 0) return;
    staffChipsStickyAfterPrimeRef.current = new Set(staffFilterChipNamesVisible);
    itemStatusChipsStickyAfterPrimeRef.current = new Set(itemStatusRosterVisible);
    setFilterChipLayoutPrimed(true);
  }, [
    filterChipLayoutPrimed,
    mappedOrders.length,
    staffAssigneeItemCounts.grandTotal,
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

  useEffect(() => {
    setVisibleLimit(ORDERS_PAGE_SIZE);
  }, [saleStatusFilter, vehicleSearch, staffKey, status, saleFilter]);

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

  const pressVehicleAppend = (ch: string) =>
    setVehicleSearch((prev) => `${prev}${ch.toUpperCase()}`.slice(0, VEHICLE_SEARCH_MAX));
  const deleteVehicleChar = () => setVehicleSearch((prev) => prev.slice(0, -1));
  const runWithStableScroll = (action: () => void) => {
    pendingScrollYRef.current = window.scrollY;
    action();
  };
  const setSaleFilterStable = (value: string) => runWithStableScroll(() => setSaleFilter(value));
  const setSaleStatusFilterStable = (value: SaleStatusFilterValue) => runWithStableScroll(() => setSaleStatusFilter(value));
  const setStaffStable = (value: StaffValue) => runWithStableScroll(() => setStaff(value));
  const setStatusStable = (value: ItemStatusValue | "") => runWithStableScroll(() => setStatus(value));
  const pressVehicleStable = (ch: string) => runWithStableScroll(() => pressVehicleAppend(ch));
  const clearVehicleStable = () => runWithStableScroll(() => setVehicleSearch(""));
  const deleteVehicleStable = () => runWithStableScroll(() => deleteVehicleChar());
  const clearFiltersStable = () =>
    runWithStableScroll(() => {
      setSaleFilter("ALL");
      setSaleStatusFilter("ทั้งหมด");
      setVehicleSearch("");
      setStaff("ทั้งหมด");
      setStatus("");
      setShowVehiclePad(false);
    });

  const pasteVehicleStable = () => {
    pendingScrollYRef.current = window.scrollY;
    void (async () => {
      const raw = await readClipboardTextSafe();
      const cleaned = sanitizeVehicleSearchPaste(raw);
      if (cleaned) setVehicleSearch(cleaned);
    })();
  };

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
  }, [saleStatusFilter, vehicleSearch, status, staff, visibleLimit, saleFilter]);

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
                <span>กำลังโหลดข้อมูล…</span>
              </>
            ) : ptrPullPx >= PTR_RELEASE_DAMPED_PX ? (
              <span>ปล่อยเพื่อรีเฟรช</span>
            ) : (
              <span>ดึงลงเพื่อรีเฟรช</span>
            )}
          </div>
        </div>
      ) : null}
      <div
        ref={orderTrackingRootRef}
        className="flex min-h-0 min-h-full w-full flex-1 flex-col bg-slate-100 antialiased text-[15px] leading-normal text-slate-800"
      >
      <div className="mx-auto flex min-h-0 min-h-full w-full max-w-none flex-1 flex-col overflow-x-hidden bg-slate-100">
        <header className="sticky top-0 z-10 bg-slate-100/95 px-0 py-2 backdrop-blur sm:px-3 sm:py-3">
          <div className="mb-2 flex items-center justify-start px-2 sm:px-0">
            <h1 className="text-[1.35rem] font-bold tracking-tight text-slate-900">Order Tracking</h1>
          </div>
          {usingDemoFallback ? (
            <div className="mb-2 rounded-2xl bg-amber-50 px-3 py-2.5 text-sm font-medium leading-snug text-amber-900">
              Demo fallback mode: ไม่พบข้อมูลรถจริงจาก Supabase
            </div>
          ) : null}
          {dataWarnings.length > 0 ? (
            <div className="mb-2 rounded-2xl bg-rose-50 px-3 py-2.5 text-sm font-medium leading-snug text-rose-800">
              Data warning: {dataWarnings[0]}
            </div>
          ) : null}
          <>
              <div className="mb-2 rounded-2xl bg-white p-2">
                <div className="mb-2 rounded-2xl bg-slate-100/80 p-2">
                  <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(72px, 1fr))" }}>
                    {salesChipsOrdered.map((sale) => (
                      <button
                        key={sale}
                        type="button"
                        onClick={() => setSaleFilterStable(sale)}
                        className={cn(
                          "min-h-[48px] rounded-2xl px-1.5 py-2 text-center transition-colors",
                          saleFilter === sale ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200/70"
                        )}
                      >
                        <div className="truncate text-xs font-medium leading-snug">{sale}</div>
                        <div className="text-base font-semibold tabular-nums leading-none">{saleCounts[sale] ?? 0}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-2 rounded-2xl bg-slate-100/80 p-2">
                  <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(72px, 1fr))" }}>
                    {SALE_STATUSES.map((s) => {
                      const active = saleStatusFilter === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setSaleStatusFilterStable(s)}
                          className={cn(
                            "min-h-[48px] rounded-2xl px-1.5 py-2 text-center transition-colors",
                            active ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200/70"
                          )}
                        >
                          <div className="truncate text-xs font-medium leading-snug">{s}</div>
                          <div className="text-base font-semibold tabular-nums leading-none">{saleStatusCounts[s] ?? 0}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-100/80 p-2">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold tracking-wide text-slate-600">พนักงาน</span>
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
                      จัดการพนักงาน {showStaffManager ? "⌃" : "⌄"}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-end gap-2 overflow-x-auto pb-1">
                    <button
                      type="button"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => setStaffStable("ทั้งหมด")}
                      className={cn(
                        "flex min-h-[52px] min-w-[4.5rem] shrink-0 flex-col items-center justify-center gap-1 rounded-full px-3 py-2 text-center transition-colors touch-manipulation",
                        staff === "ทั้งหมด" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200/70"
                      )}
                    >
                      <span className="text-xs font-medium leading-tight">ทั้งหมด</span>
                      <span className="text-base font-semibold leading-none tabular-nums">{staffAssigneeItemCounts.grandTotal}</span>
                    </button>
                    {staffFilterChipNamesForToolbar.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => setStaffStable(s)}
                        className={cn(
                          "flex min-h-[52px] min-w-[4.25rem] max-w-[7.5rem] shrink-0 flex-col items-center justify-center gap-1 rounded-full px-2.5 py-2 text-center transition-colors touch-manipulation",
                          staff === s ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200/70"
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
                        เปิดจากที่นี่เท่านั้น — เพิ่ม/ลบชื่อในรายชื่อกรอง (เก็บบนเซิร์ฟเวอร์ · แคชในเครื่องถ้าเซิร์ฟเวอร์ไม่พร้อม)
                      </p>
                      <ul className="max-h-40 space-y-1 overflow-y-auto">
                        {staffRoster.length === 0 ? (
                          <li className="text-[11px] font-semibold text-slate-400">ยังไม่มีชื่อ (เพิ่มด้านล่าง)</li>
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
                                ลบ
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                      <div className="flex gap-2">
                        <input
                          value={staffNameInput}
                          onChange={(e) => setStaffNameInput(e.target.value)}
                          placeholder="พิมพ์ชื่อแล้วกดเพิ่ม"
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
                          เพิ่ม
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div className="mb-1 mt-3 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold tracking-wide text-slate-600">สถานะรายการ</span>
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
                      จัดการสถานะ {showStatusManager ? "⌃" : "⌄"}
                    </button>
                  </div>
                  {showStatusManager ? (
                    <div className="mt-2 space-y-2 rounded-2xl bg-slate-100 p-2.5">
                      <p className="text-xs font-normal leading-snug text-slate-600">
                        เพิ่ม/ลบชิปในส่วนกรอง (จำในเครื่องนี้ · localStorage) · การ์ดรายการยังเลือกสถานะครบจากชุดเดียวกับเดิม
                      </p>
                      <ul className="max-h-36 space-y-1 overflow-y-auto">
                        {itemStatusRoster.length === 0 ? (
                          <li className="text-[11px] font-semibold text-slate-400">กำลังใช้ลำดับเริ่มต้น</li>
                        ) : (
                          itemStatusRoster.map((st) => (
                            <li key={st} className="flex items-center justify-between gap-2 rounded-xl bg-white px-2 py-1.5">
                              <span className="min-w-0 truncate text-sm font-medium text-slate-800">{st}</span>
                              <button
                                type="button"
                                onPointerDown={(e) => e.preventDefault()}
                                onClick={() => removeItemStatusFromRoster(st)}
                                className="shrink-0 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-800"
                              >
                                ลบ
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                      <div className="flex gap-2">
                        <select
                          value={itemStatusAddPick}
                          onChange={(e) => setItemStatusAddPick((e.target.value || "") as ItemStatusValue | "")}
                          disabled={addableItemStatuses.length === 0}
                          className="min-w-0 flex-1 rounded-2xl bg-white px-2 py-2.5 text-sm font-medium text-slate-900 outline-none ring-1 ring-slate-200/80 disabled:opacity-50"
                          aria-label="เลือกสถานะเพื่อเพิ่มชิป"
                        >
                          <option value="">เลือกสถานะเพื่อเพิ่ม</option>
                          {addableItemStatuses.map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onPointerDown={(e) => e.preventDefault()}
                          onClick={() => {
                            if (!itemStatusAddPick) return;
                            addItemStatusToRoster(itemStatusAddPick as ItemStatusValue);
                            setItemStatusAddPick("");
                          }}
                          disabled={!itemStatusAddPick}
                          className="shrink-0 rounded-2xl bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50 touch-manipulation"
                        >
                          เพิ่ม
                        </button>
                      </div>
                      {addableItemStatuses.length === 0 ? (
                        <p className="text-[10px] font-semibold text-slate-400">แสดงครบชุดสถานะแล้ว</p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => setStatusStable("")}
                      className={cn(
                        "flex min-h-[52px] min-w-[5rem] shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center touch-manipulation transition-colors",
                        !status ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200/70"
                      )}
                    >
                      <div className="text-xs font-medium leading-snug">แสดงทั้งหมด</div>
                      <div className="text-base font-semibold tabular-nums">{itemStatusTotalCount}</div>
                    </button>
                    {itemStatusRosterForToolbar.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => setStatusStable(status === s ? "" : s)}
                        className={cn(
                          "flex min-h-[52px] min-w-[4.25rem] max-w-[7rem] shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center transition-colors touch-manipulation",
                          status === s ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200/70"
                        )}
                      >
                        <span className="line-clamp-3 max-w-full text-xs font-medium leading-snug">{s}</span>
                        <span className="text-base font-semibold tabular-nums">{itemStatusCounts.get(s) ?? 0}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mb-2 rounded-2xl bg-white p-2">
                {!showVehiclePad ? (
                  <>
                    <div className="flex w-full items-center gap-2">
                      <button type="button" onClick={() => setShowVehiclePad((open) => !open)} className="min-w-0 flex-1 text-left touch-manipulation">
                        <span className="text-sm font-semibold text-slate-900">ค้นหา</span>
                      </button>
                      <button
                        type="button"
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={pasteVehicleStable}
                        title="แตะเพื่อวางจากคลิปบอร์ด"
                        aria-label="วางจากคลิปบอร์ด"
                        className={cn(vehicleSearchFieldDisplayBase, "cursor-pointer truncate active:bg-slate-800")}
                      >
                        {vehicleSearchFieldDisplay(vehicleSearch)}
                      </button>
                      <button type="button" onClick={deleteVehicleStable} className="h-10 shrink-0 rounded-2xl bg-slate-950 px-3 text-xs font-semibold text-white touch-manipulation">
                        ลบ
                      </button>
                      <button type="button" onClick={clearVehicleStable} className="h-10 shrink-0 rounded-2xl bg-slate-100 px-3 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 touch-manipulation">
                        ล้าง
                      </button>
                    </div>
                    <p className="mt-1.5 px-0.5 text-xs leading-relaxed text-slate-500">แตะช่องตัวเลขเพื่อวางข้อความที่คัดลอก · กดคำว่าค้นหาเพื่อเปิดแป้น</p>
                  </>
                ) : (
                  <VehicleSearchPad
                    value={vehicleSearch}
                    onPressChar={pressVehicleStable}
                    onDelete={deleteVehicleStable}
                    onClear={clearVehicleStable}
                    onCollapse={() => setShowVehiclePad(false)}
                    onPaste={pasteVehicleStable}
                  />
                )}
              </div>
          </>
        </header>
        <main className="px-0 pb-3 pt-0 sm:px-3">
            <div className="space-y-3 pb-4">
              {visiblePaged.map((order) => (
                <OrderCard key={order.id} order={order} staffRosterNames={staffRoster} onAddStaffToRoster={addStaffToRoster} />
              ))}
              {hasMoreVisible ? (
                <div ref={loadMoreRef} className="h-9 w-full rounded-2xl bg-slate-100 text-center text-sm font-medium leading-9 text-slate-600">
                  กำลังโหลดเพิ่ม... ({visiblePaged.length}/{visible.length})
                </div>
              ) : null}
              {!visible.length ? (
                <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/60">
                  <p className="text-base font-semibold leading-snug text-slate-800">
                    {mappedOrders.length === 0 ? "ยังไม่มีงานในระบบ" : "ไม่พบงานที่ตรงกับตัวกรอง"}
                  </p>
                  {mappedOrders.length > 0 ? (
                    <>
                      <p className="mt-2 text-xs font-semibold leading-relaxed text-slate-500">
                        ลองล้างช่องค้นหา หรือเปลี่ยนเซลล์ / สถานะขาย / พนักงาน / สถานะรายการ
                      </p>
                      <button type="button" onClick={clearFiltersStable} className="mt-4 h-11 w-full max-w-[280px] rounded-2xl bg-slate-950 text-sm font-semibold text-white touch-manipulation">
                        ล้างตัวกรอง
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
