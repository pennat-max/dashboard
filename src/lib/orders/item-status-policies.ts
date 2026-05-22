/**
 * นโยบายสถานะรายการ (order_tracking_item_status_prefs.policies + client defaults)
 */

export const ORDER_TRACKING_ITEM_STATUSES = [
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
] as const;

export type OrderTrackingItemStatusCode = (typeof ORDER_TRACKING_ITEM_STATUSES)[number];

const ALLOWED_ORDERED = [...ORDER_TRACKING_ITEM_STATUSES] as OrderTrackingItemStatusCode[];

/** ครบ SLA จากวันเปลี่ยนสถานะเมื่ออยู่สถานะนี้ >= N วันปฏิทิน (ไทย) — อย่านับวันเข้ามาเป็น วันแรก ใช้ max(0, today - entered) เหมือนนับผ่านมาแล้ว */
export function calendarDaysSinceStatusEnteredBangkok(statusChangedYmd: string | undefined): number | null {
  const raw = String(statusChangedYmd ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const todayYmd = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const t0 = new Date(`${todayYmd}T12:00:00+07:00`).getTime();
  const d0 = new Date(`${raw}T12:00:00+07:00`).getTime();
  if (Number.isNaN(t0) || Number.isNaN(d0)) return null;
  return Math.max(0, Math.round((t0 - d0) / (24 * 60 * 60 * 1000)));
}

export type ResolvedItemRowStatusPolicy = {
  arrivalDueDate: boolean;
  storeDepositClock: boolean;
  /** หลักวันปฏิทินเทียบ clockStart เมื่อ storeDepositClock; null = fallback ภายใน (เช่น 30) */
  storeDepositMaxDays: number | null;
  /** ค้างในสถานะนี้เกินจาก status_changed เทียบวันนี้ (ไทย) — null = ไม่บังคับ */
  slaMaxCalendarDaysInStatus: number | null;
};

export type DueTodayChipPolicy = {
  statuses: readonly OrderTrackingItemStatusCode[];
  /** เทียบกับฟังก์ชัน calendarDaysUntilDueBangkok (0 = พอดีวันนี้, 1 = พรุ่งนี้ฯลฯ) */
  matchDaysUntilDueBangkok: number;
};

/** ค่ารวมจาก JSON เก็บ + default */
export type ItemStatusPoliciesNormalized = {
  byStatus: Record<OrderTrackingItemStatusCode, ResolvedItemRowStatusPolicy>;
  dueToday: DueTodayChipPolicy;
};

/** จาก API / UI – ฟิลด์ย่อย optional */
export type ItemStatusPoliciesInput = {
  statuses?: Partial<
    Record<
      OrderTrackingItemStatusCode,
      {
        arrivalDueDate?: boolean | null;
        storeDepositClock?: boolean | null;
        storeDepositMaxDays?: number | null;
        slaMaxCalendarDaysInStatus?: number | null;
      }
    >
  >;
  dueToday?: {
    statuses?: unknown;
    matchDaysUntilDueBangkok?: unknown;
  };
};

export const DEFAULT_STORE_DEPOSIT_MAX_DAYS = 30;

const buildDefaultByStatus = (): Record<OrderTrackingItemStatusCode, ResolvedItemRowStatusPolicy> => {
  const base = Object.fromEntries(
    ALLOWED_ORDERED.map((k) => [
      k,
      {
        arrivalDueDate: false,
        storeDepositClock: false,
        storeDepositMaxDays: null as number | null,
        slaMaxCalendarDaysInStatus: null as number | null,
      } satisfies ResolvedItemRowStatusPolicy,
    ])
  ) as Record<OrderTrackingItemStatusCode, ResolvedItemRowStatusPolicy>;
  base["สั่ง"].arrivalDueDate = true;
  base["ช่างนอก"].arrivalDueDate = true;
  base["ฝากสโตร์"].storeDepositClock = true;
  base["ฝากสโตร์"].storeDepositMaxDays = DEFAULT_STORE_DEPOSIT_MAX_DAYS;
  return base;
};

/** immutable template — อย่า mutate โดยตรง */
export const DEFAULT_MERGED_ITEM_STATUS_POLICY_BY_STATUS = buildDefaultByStatus();

function cloneDefaultByStatus(): Record<OrderTrackingItemStatusCode, ResolvedItemRowStatusPolicy> {
  const next = {} as Record<OrderTrackingItemStatusCode, ResolvedItemRowStatusPolicy>;
  for (const c of ALLOWED_ORDERED) next[c] = { ...DEFAULT_MERGED_ITEM_STATUS_POLICY_BY_STATUS[c] };
  return next;
}

const DEFAULT_NORMALIZED_STATIC: ItemStatusPoliciesNormalized = {
  byStatus: DEFAULT_MERGED_ITEM_STATUS_POLICY_BY_STATUS,
  dueToday: {
    statuses: ["สั่ง", "ช่างนอก"],
    matchDaysUntilDueBangkok: 0,
  },
};

export function defaultItemStatusPoliciesNormalized(): ItemStatusPoliciesNormalized {
  return {
    byStatus: cloneDefaultByStatus(),
    dueToday: { statuses: [...DEFAULT_NORMALIZED_STATIC.dueToday.statuses], matchDaysUntilDueBangkok: 0 },
  };
}

export function normalizedItemPoliciesToStoredJson(norm: ItemStatusPoliciesNormalized): ItemStatusPoliciesInput {
  const statuses: NonNullable<ItemStatusPoliciesInput["statuses"]> = {};
  for (const code of ALLOWED_ORDERED) {
    const d = DEFAULT_MERGED_ITEM_STATUS_POLICY_BY_STATUS[code];
    const cur = norm.byStatus[code];
    if (
      cur.arrivalDueDate !== d.arrivalDueDate ||
      cur.storeDepositClock !== d.storeDepositClock ||
      cur.storeDepositMaxDays !== d.storeDepositMaxDays ||
      cur.slaMaxCalendarDaysInStatus !== d.slaMaxCalendarDaysInStatus
    ) {
      statuses[code] = {
        arrivalDueDate: cur.arrivalDueDate,
        storeDepositClock: cur.storeDepositClock,
        storeDepositMaxDays: cur.storeDepositMaxDays,
        slaMaxCalendarDaysInStatus: cur.slaMaxCalendarDaysInStatus,
      };
    }
  }
  const defDt = DEFAULT_NORMALIZED_STATIC.dueToday;
  const dueTodayChip: ItemStatusPoliciesInput["dueToday"] = {};
  if (
    JSON.stringify(norm.dueToday.statuses) !== JSON.stringify(defDt.statuses) ||
    norm.dueToday.matchDaysUntilDueBangkok !== defDt.matchDaysUntilDueBangkok
  ) {
    dueTodayChip.statuses = [...norm.dueToday.statuses];
    dueTodayChip.matchDaysUntilDueBangkok = norm.dueToday.matchDaysUntilDueBangkok;
  }
  const out: ItemStatusPoliciesInput = {};
  if (Object.keys(statuses).length) out.statuses = statuses;
  if (Object.keys(dueTodayChip).length) out.dueToday = dueTodayChip;
  return out;
}

function clampIntDays(n: number | null | undefined, min = 1, max = 730): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const r = Math.round(Number(n));
  if (!Number.isFinite(r)) return null;
  return Math.min(max, Math.max(min, r));
}

export function normalizeItemStatusPoliciesRaw(raw: unknown): ItemStatusPoliciesNormalized {
  const out = cloneDefaultByStatus();
  let dueTodayStatuses: OrderTrackingItemStatusCode[] | null = null;
  let dueTodayMatchDays = DEFAULT_NORMALIZED_STATIC.dueToday.matchDaysUntilDueBangkok;

  if (raw != null && typeof raw === "object") {
    const root = raw as ItemStatusPoliciesInput;
    const stIn = root.statuses;
    if (stIn != null && typeof stIn === "object") {
      for (const code of ALLOWED_ORDERED) {
        const ov = stIn[code];
        if (ov == null || typeof ov !== "object") continue;
        const prev = out[code];
        const next: ResolvedItemRowStatusPolicy = { ...prev };
        const arrival =
          ov.arrivalDueDate === true ? true : ov.arrivalDueDate === false ? false : undefined;
        const deposit =
          ov.storeDepositClock === true ? true : ov.storeDepositClock === false ? false : undefined;
        if (arrival !== undefined) next.arrivalDueDate = arrival;
        if (deposit !== undefined) next.storeDepositClock = deposit;
        if ("storeDepositMaxDays" in ov) {
          const v = ov.storeDepositMaxDays;
          if (v === null || v === undefined) next.storeDepositMaxDays = null;
          else {
            const n = Number(v);
            next.storeDepositMaxDays = clampIntDays(n);
          }
        }
        if ("slaMaxCalendarDaysInStatus" in ov) {
          const v = ov.slaMaxCalendarDaysInStatus;
          if (v === null || v === undefined) next.slaMaxCalendarDaysInStatus = null;
          else next.slaMaxCalendarDaysInStatus = clampIntDays(Number(v));
        }
        out[code] = next;
      }
    }
    const dt = root.dueToday;
    if (dt != null && typeof dt === "object") {
      const arrIn = dt.statuses;
      if (Array.isArray(arrIn)) {
        const seen = new Set<OrderTrackingItemStatusCode>();
        const picked: OrderTrackingItemStatusCode[] = [];
        for (const row of arrIn) {
          const s = String(row ?? "").trim() as OrderTrackingItemStatusCode;
          if (!ALLOWED_ORDERED.includes(s)) continue;
          if (seen.has(s)) continue;
          seen.add(s);
          picked.push(s);
        }
        if (picked.length) dueTodayStatuses = picked;
      }
      const m = dt.matchDaysUntilDueBangkok;
      if (typeof m === "number" && Number.isFinite(m)) {
        const r = Math.round(m);
        if (r >= -14 && r <= 90) dueTodayMatchDays = r;
      } else if (typeof m === "string" && m.trim()) {
        const r = Number(m);
        if (Number.isFinite(r) && r >= -14 && r <= 90) dueTodayMatchDays = Math.round(r);
      }
    }
  }

  /** เปิด clock แต่ไม่ใส่เลข — ใช้ default ฝากหลักหรือ 30 */
  for (const code of ALLOWED_ORDERED) {
    const row = out[code];
    if (row.storeDepositClock && row.storeDepositMaxDays == null) row.storeDepositMaxDays = DEFAULT_STORE_DEPOSIT_MAX_DAYS;
  }

  const dueToday: DueTodayChipPolicy = {
    statuses:
      dueTodayStatuses && dueTodayStatuses.length ? dueTodayStatuses : [...DEFAULT_NORMALIZED_STATIC.dueToday.statuses],
    matchDaysUntilDueBangkok: dueTodayMatchDays,
  };

  return { byStatus: out, dueToday };
}

export function arrivalDueCalendarDaysUntilBangkok(dueYmd: string | undefined): number | null {
  const raw = String(dueYmd ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const todayYmd = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const t0 = new Date(`${todayYmd}T12:00:00+07:00`).getTime();
  const d0 = new Date(`${raw}T12:00:00+07:00`).getTime();
  if (Number.isNaN(t0) || Number.isNaN(d0)) return null;
  return Math.round((d0 - t0) / (24 * 60 * 60 * 1000));
}

export function matchesDueTodayChip<
  T extends { status?: string; dueDate?: string | null },
>(item: T, norm: ItemStatusPoliciesNormalized["dueToday"]): boolean {
  const st = String(item.status ?? "").trim() as OrderTrackingItemStatusCode;
  const setDt = new Set(norm.statuses.map((x) => String(x).trim()));
  if (!setDt.has(st)) return false;
  const daysUntil = arrivalDueCalendarDaysUntilBangkok(item.dueDate ?? "");
  return daysUntil === norm.matchDaysUntilDueBangkok;
}

export function storeDepositEffectiveMaxDays(p: ResolvedItemRowStatusPolicy): number {
  const n =
    typeof p.storeDepositMaxDays === "number" &&
    Number.isFinite(p.storeDepositMaxDays) &&
    p.storeDepositMaxDays >= 1
      ? Math.round(p.storeDepositMaxDays)
      : DEFAULT_STORE_DEPOSIT_MAX_DAYS;
  return n;
}

export function storeDepositRemainingLabel(clockYmd: string | undefined, maxDays: number): string {
  const elapsed = calendarDaysSinceStatusEnteredBangkok(clockYmd);
  const cap = Math.max(1, maxDays);
  if (elapsed == null) return "ไม่มีวันลงข้อมูล";
  if (elapsed < 0) return "ไม่มีวันลงข้อมูล";
  const left = cap - elapsed;
  if (left <= 0) return "หมดเวลา";
  return `เหลือ ${left} วัน`;
}

export function storeDepositTone(
  clockYmd: string | undefined,
  maxDays: number
): "amber" | "red" | "sky" {
  const elapsed = calendarDaysSinceStatusEnteredBangkok(clockYmd);
  const cap = Math.max(1, maxDays);
  if (elapsed == null || elapsed < 0) return "sky";
  const left = cap - elapsed;
  if (left <= 0) return "red";
  if (left <= 3) return "red";
  if (left <= 7) return "amber";
  return "sky";
}

export function slaExceededInStatus(statusChangedAtYmd: string | undefined, slaMax: number | null): boolean {
  const cap = slaMax === null ? null : slaMax !== undefined ? Math.round(Number(slaMax)) : null;
  if (cap == null || !Number.isFinite(cap) || cap < 1) return false;
  const elapsed = calendarDaysSinceStatusEnteredBangkok(statusChangedAtYmd);
  if (elapsed == null) return false;
  return elapsed >= cap;
}
