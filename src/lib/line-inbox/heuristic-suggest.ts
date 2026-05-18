import { normalizeLabelForMatch, tokenSet } from "./normalize-label";
import type { DuplicateStatus } from "./types";

export type SuggestedCategorySlug =
  | "parts_order"
  | "installation"
  | "repair"
  | "paint"
  | "document"
  | "storage"
  | "qc"
  | "other";

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** DB-safe status strings for order_items.status */
export function suggestCategoryAndStatus(raw: string): {
  suggested_category: SuggestedCategorySlug;
  suggested_status: string;
} {
  const t = raw.toLowerCase();
  const th = raw;

  if (/สี|เก็บสี|paint/i.test(th) || /paint/i.test(t)) {
    return { suggested_category: "paint", suggested_status: "ต้องสั่ง" };
  }
  if (/เอกสาร|ป้าย|ทะเบียน|document/i.test(th) || /document|paper/i.test(t)) {
    return { suggested_category: "document", suggested_status: "เช็ค" };
  }
  if (/ฝาก|คลัง|storage|โกดัง/i.test(th) || /storage/i.test(t)) {
    if (/กับรถ|in\s*car|incar/i.test(th)) {
      return { suggested_category: "storage", suggested_status: "ฝากกับรถ" };
    }
    return { suggested_category: "storage", suggested_status: "ฝากสโตร์" };
  }
  if (/qc|ตรวจ|เช็คก่อนส่ง/i.test(th) || /\bqc\b/i.test(t)) {
    return { suggested_category: "qc", suggested_status: "เช็ค" };
  }
  if (/ซ่อม|แก้|ชน|crash|repair/i.test(th) || /repair|fix/i.test(t)) {
    return { suggested_category: "repair", suggested_status: "ช่างนอก" };
  }
  if (/ติดตั้ง|ใส่|แต่ง|lift|ล้อ/i.test(th) || /install/i.test(t)) {
    return { suggested_category: "installation", suggested_status: "สั่ง" };
  }
  if (/สั่ง|อะไหล่|ของมา|กำหนดส่ง|due/i.test(th) || /order|parts/i.test(t)) {
    return { suggested_category: "parts_order", suggested_status: "สั่ง" };
  }
  if (/มาแล้ว|ของถึง|รับของ/i.test(th)) {
    return { suggested_category: "parts_order", suggested_status: "มา" };
  }
  if (/รถนอก|dealer|ศูนย์นอก/i.test(th)) {
    return { suggested_category: "parts_order", suggested_status: "รถนอก" };
  }
  if (/มีของ|พร้อม|stock/i.test(th)) {
    return { suggested_category: "parts_order", suggested_status: "มี" };
  }
  if (/จบ|เสร็จ|ปิดงาน/i.test(th)) {
    return { suggested_category: "other", suggested_status: "จบ" };
  }

  return { suggested_category: "other", suggested_status: "เช็ค" };
}

export function looksLikeUpdateFinishedJob(raw: string): boolean {
  const th = raw.toLowerCase();
  return /แก้งานเดิม|งานเดิม|รายการเดิม|อัปเดต|อัพเดต|update|reopen/i.test(th);
}

/** Classify duplicate vs existing rows */
export function classifyDuplicateLine(
  rawLine: string,
  existing: Array<{ id: string; label: string; status: string }>,
  carResolved: boolean
): {
  duplicate_status: DuplicateStatus;
  matched_order_item_id: string;
  matched_item_name: string;
  confidence: number;
  reason: string;
} {
  if (!carResolved) {
    return {
      duplicate_status: "unclear",
      matched_order_item_id: "",
      matched_item_name: "",
      confidence: 0.25,
      reason: "ยังไม่ผูกรถชัดเจน — เทียบซ้ำไม่ได้",
    };
  }

  const normLine = normalizeLabelForMatch(rawLine);
  const tokensLine = tokenSet(rawLine);

  let best:
    | {
        id: string;
        label: string;
        status: string;
        score: number;
      }
    | undefined;

  for (const row of existing) {
    const normExisting = normalizeLabelForMatch(row.label);
    if (normLine && normExisting && normLine === normExisting) {
      const done = String(row.status ?? "").trim() === "จบ";
      return {
        duplicate_status: done ? "new" : "duplicate",
        matched_order_item_id: done ? "" : row.id,
        matched_item_name: row.label,
        confidence: done ? 0.55 : 0.92,
        reason: done
          ? "ชื่อตรงกับรายการที่จบแล้ว — แนะนำเปิดงานใหม่เว้นแต่ข้อความบอกชัดว่าแก้ของเดิม"
          : "ชื่อตรงกับรายการที่ยังไม่จบ",
      };
    }
    const jac = jaccardSimilarity(tokensLine, tokenSet(row.label));
    if (
      jac >= 0.35 &&
      (!best || jac > best.score || (jac === best.score && row.label.length > best.label.length))
    ) {
      best = { id: row.id, label: row.label, status: row.status, score: jac };
    }
  }

  if (!best) {
    return {
      duplicate_status: "new",
      matched_order_item_id: "",
      matched_item_name: "",
      confidence: 0.65,
      reason: "ไม่พบรายการเดิมที่ชื่อใกล้เคียง",
    };
  }

  const done = String(best.status ?? "").trim() === "จบ";
  if (best.score >= 0.55) {
    if (done && !looksLikeUpdateFinishedJob(rawLine)) {
      return {
        duplicate_status: "new",
        matched_order_item_id: "",
        matched_item_name: best.label,
        confidence: 0.5,
        reason: "ใกล้เคียงรายการที่จบแล้ว — ค่าเริ่มต้นเป็นงานใหม่",
      };
    }
    return {
      duplicate_status: "possible_duplicate",
      matched_order_item_id: best.id,
      matched_item_name: best.label,
      confidence: 0.55 + best.score * 0.35,
      reason: done
        ? "ชื่อใกล้เคียงรายการที่จบ — อาจเป็นงานซ้ำหรืองานใหม่ ต้องยืนยัน"
        : "ชื่อใกล้เคียงรายการที่มีอยู่ — อาจซ้ำ",
    };
  }

  return {
    duplicate_status: "possible_duplicate",
    matched_order_item_id: best.id,
    matched_item_name: best.label,
    confidence: 0.4 + best.score * 0.3,
    reason: "ความคล้ายปานกลาง — ควรตรวจสอบกับงานเดิม",
  };
}
