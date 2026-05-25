/**
 * Heuristic LINE text -> task lines (aligned with order-intake ai-split guardrails).
 * Mentions/tags and conversation noise are returned as ignored context, not order items.
 */
import { isLineInboxSystemAcknowledgementText } from "@/lib/line-inbox/acknowledgement";

export type SplitLineTextResult = {
  items: string[];
  grouped_items: Array<{ text: string; note: string }>;
  ignored_vehicle_spec_lines: string[];
  ignored_mention_lines: string[];
  ignored_noise_lines: string[];
};

const MENTION_RE = /@\S+/g;
const THAI_PLATE_RE = /(?<![\u0E00-\u0E7F])\d{0,2}[\u0E01-\u0E2E]{1,3}[-\s]?\d{2,4}/g;
const CHASSIS_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/i;
const VEHICLE_SPEC_RE =
  /(REVO|FORTUNER|HILUX|VIGO|RANGER|D-MAX|TRITON|CAMRY|2WD|4WD|AT|MT|DOUBLE[_\s-]?CAB|SMART[_\s-]?CAB|SILVER|BLACK|WHITE|GRAY|GREY|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|\b[123]\.\d\b|\b(?:19|20)\d{2}\b)/i;
const VEHICLE_BRAND_MODEL_RE =
  /(TOYOTA|NISSAN|NAVARA|ISUZU|MAZDA|MITSUBISHI|FORD|HONDA|REVO|FORTUNER|HILUX|VIGO|RANGER|D-MAX|DMAX|TRITON|CAMRY|ALTIS|YARIS|VIOS|MU-X|EVEREST|PAJERO|PRO4X|PRO-4X|RAPTOR)/i;
const VEHICLE_BODY_SPEC_RE =
  /(D[-\s]?CAB|DOUBLE[_\s-]?CAB|SMART[_\s-]?CAB|CAB|DC|2WD|4WD|AT|MT|7AT|6AT|STANDARD|HIGH|LOW|PRE[-\s]?RUNNER|\b[123]\.\d\b|ป้ายแดง)/i;
const VEHICLE_COLOR_YEAR_RE =
  /(SILVER|BLACK|WHITE|GRAY|GREY|BLUE|RED|GREEN|ORANGE|BRONZE|BROWN|GOLD|YELLOW|PEARL|ป้ายแดง|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|\b(?:19|20)\d{2}\b|[A-Z][a-z]{2}\d{2})/i;
const RED_PLATE_CONTEXT_RE = /^ป้ายแดง$/i;
const STOCK_NUMBER_RE = /\b\d{4,6}\b/;
const THAI_STOCK_IDENTITY_RE =
  /^(?:ทะเบียน|เลขทะเบียน|stock|สต็อก|สต๊อก|ref|reference)\s*[:#：-]?\s*\d{4,6}\b/i;
const LEADING_CAR_IDENTITY_RE =
  /^(?:ทะเบียน|เลขทะเบียน|stock|สต็อก|สต๊อก|ref|reference)\s*[:#：-]?\s*\d{4,6}\b|^\d{0,2}[\u0E01-\u0E2E]{1,3}[-\s]?\d{2,4}\b|^[A-HJ-NPR-Z0-9]{17}\b/i;
const LEADING_NUMERIC_STOCK_RE = /^\d{4,6}\b/;
const MIXED_LINE_WORK_START_RE =
  /(คิ้วล้อ|กรอไมล์|เลขไมล์|กุญแจ|กันสาด|กันแมลง|โรบาร์|สปอร์ตบาร์|โรลเลอร์|สติ๊กเกอร์|สติกเกอร์|ฟิล์ม|บันได|กันชน|กันแคร้ง|แร็ค|แรค|ฝาครอบ|ไฟ|กล้อง|เซ็นเซอร์|แม็ก|แม้ค|ยาง|ล้อ|แบต|แบตเตอรี่|โช้ค|ยกสูง|เอกสาร|ซ่อม|เปลี่ยน|ขาด|แตก|เสีย|หาย|ต้องสั่ง|สั่ง|ส่งอู่|ทำสี|ตรวจ|เช็ค|ติดตั้ง|ติด|เพิ่ม|ใส่|แปลง|ล้าง|ขัด|เคลือบ|เก็บงาน|ประเมิน|รับงาน|แต่งเหมือน\s*รูป|เหมือน\s*รูป|ตาม\s*(?:รูป|ภาพ)|ยกเลิก|ไม่ต้องติด|ไม่เอา|เอาออก|เบิก|รอ\s*ตรวจ|รอตรวจ|เอา\s*รถ\s*ไป\s*เช็ค)/i;
const WORK_INTENT_RE =
  /(กรอไมล์|เลขไมล์|กันสาด|โรบาร์|สติ๊กเกอร์|ฟิล์ม|บันได|กันชน|แร็ค|แรค|ฝาครอบ|ไฟ|กล้อง|เซ็นเซอร์|ยาง|ล้อ|แบต|แบตเตอรี่|โช้ค|ยกสูง|ป้าย|เอกสาร|ซ่อม|เปลี่ยน|ขาด|แตก|เสีย|หาย|ต้องสั่ง|ส่งอู่|ทำสี|ตรวจ|เช็ค|ติด|ติดตั้ง|เพิ่ม|ใส่|แปลง|ล้าง|ขัด|เคลือบ|เก็บงาน|ประเมิน|รับงาน|งาน)/i;
const STRONG_WORK_INTENT_RE =
  /(กรอไมล์|เลขไมล์|กุญแจ|กันสาด|โรบาร์|สติ๊กเกอร์|ฟิล์ม|บันได|กันชน|แร็ค|แรค|ฝาครอบ|ไฟ|กล้อง|เซ็นเซอร์|ยาง|ล้อ|แบต|แบตเตอรี่|โช้ค|ยกสูง|เอกสาร|ซ่อม|เปลี่ยน|ขาด|แตก|เสีย|หาย|ต้องสั่ง|สั่ง|ส่งอู่|ทำสี|ตรวจ|เช็ค|ติด|ติดตั้ง|เพิ่ม|ใส่|แปลง|ล้าง|ขัด|เคลือบ|เก็บงาน|ประเมิน|รับงาน|งาน)/i;
const LINE_PHOTO_WORK_INTENT_RE =
  /(แต่ง|เหมือน\s*รูป|ตาม\s*(?:รูป|ภาพ)|รูปทุกอย่าง|ยกเลิก|ไม่ต้อง|เบิก|รอ\s*ตรวจ|รอตรวจ|เอา\s*รถ\s*ไป\s*เช็ค)/i;
const STANDALONE_CONTROL_LINE_RE = /^(?:เพิ่ม|เพิ่มงาน|งานใหม่)$/i;
const CAR_REFERENCE_META_RE =
  /(ใส่\s*ปี.*(?:chassis|chasis|เลขถัง|ตัวถัง)|(?:chassis|chasis|เลขถัง|ตัวถัง).*(?:ปี|link|ลิงก์|ถูก|ทุกครั้ง|หลายที่)|(?:ปี|link|ลิงก์).*(?:chassis|chasis|เลขถัง|ตัวถัง))/i;
const REAL_WORK_EXCLUDING_GENERIC_ENTRY_RE =
  /(กรอไมล์|เลขไมล์|กุญแจ|กันสาด|โรบาร์|สติ๊กเกอร์|ฟิล์ม|บันได|กันชน|แร็ค|แรค|ฝาครอบ|ไฟ|กล้อง|เซ็นเซอร์|ยาง|ล้อ|แบต|แบตเตอรี่|โช้ค|ยกสูง|เอกสาร|ซ่อม|เปลี่ยน|ขาด|แตก|เสีย|หาย|ต้องสั่ง|สั่ง|ส่งอู่|ทำสี|ตรวจ|เช็ค|ติดตั้ง|เพิ่ม|แปลง|ล้าง|ขัด|เคลือบ|เก็บงาน|ประเมิน|รับงาน)/i;
const ROLE_OR_PERSON_NOISE_RE =
  /^(?:[A-Za-z.'"-]+|\bTH\b|\bChecker\b|\bSale\b|\bSales\b|\bSupport\b|\bStore\b|\bGarage\b|\bAdmin\b|\bTeam\b|\bStaff\b|\bQC\b|\bLoSo\b|\bManbappe\b|\bAof\b|\bFrank\b|\bKik\b|\bNutkun\b|\bJoy\b|\bMint\b|\bPrew\b|\bGwang\b|\bAor\b|\bWan\b|\bMai\b|\bNat\b|\bNoey\b|\bSine\b|\bPloo\b|\bYing\b|\bFairy\b|\bFah\b|\bBam\b|\bKoi\b|\bTarn\b)+$/i;
const LINE_PERSON_CONTEXT_RE =
  /(?:\bLoSo\b|\bAekkarach\b|\bTH\b|\bChecker\b|\bManbappe\b|\bAof\b|\bFrank\b|\bKik\b|\bNutkun\b|\bJoy\b|\bMint\b|\bPrew\b|\bGwang\b|\bAor\b|\bWan\b|\bMai\b|\bNat\b|\bNoey\b|\bSine\b|\bPloo\b|\bYing\b|\bFairy\b|\bFah\b|\bBam\b|\bKoi\b|\bTarn\b|กวาง|ออฟ|นัท|แฟรงค์|จอย|มิ้นท์|พริว|เอ๋|เช็คเกอร์)/i;
const EMOJI_OR_SYMBOL_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}%^*:*]/u;
const DETAIL_LINE_RE =
  /(%|เปอร์เซ็น|เปอร์|ประตู|กระจก|บานหน้า|บานหลัง|ด้านหน้า|ด้านหลัง|ซ้าย|ขวา|หน้า|หลัง|ฝั่ง|แถว|ชิ้น|จุด|\b\d+(?:\.\d+)?\s*(?:cm|mm|inch|in|นิ้ว)\b)/i;
const DETAIL_PARENT_RE =
  /(ฟิล์ม|สี|paint|ติด|ติดตั้ง|ใส่|เปลี่ยน|ซ่อม|repair|install|แปลง|แต่ง|ยกสูง|โรบาร์|กันชน|บันได|แร็ค|แรค|ฝาครอบ|สติ๊กเกอร์|ขัด|เคลือบ|เก็บงาน)/i;

function sanitizeLine(raw: string): string {
  return raw
    .replace(/^[\s\-•*]+/, "")
    .replace(/[\s*•!！]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function addUnique(target: string[], value: string) {
  const clean = sanitizeLine(value);
  if (!clean) return;
  const key = clean.toLowerCase();
  if (target.some((v) => v.toLowerCase() === key)) return;
  target.push(clean);
}

function removeMentions(raw: string): string {
  return sanitizeLine(raw.replace(MENTION_RE, " "));
}

function removeCarIdentityFragments(raw: string): string {
  const clean = sanitizeLine(raw);
  if (/^\d{4,6}\s+/.test(clean) && !startsWithCarIdentity(clean)) return clean;
  return sanitizeLine(
    clean
      .replace(THAI_PLATE_RE, " ")
      .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, " ")
      .replace(/^(?:ช่วย|รบกวน|ฝาก)\s*/i, "")
  );
}

function semanticTokens(raw: string): string[] {
  return raw.match(/[A-Za-zก-ฮ0-9]+/g) ?? [];
}

function hasWorkIntent(raw: string): boolean {
  return WORK_INTENT_RE.test(raw) || LINE_PHOTO_WORK_INTENT_RE.test(raw);
}

function hasStrongWorkIntent(raw: string): boolean {
  return STRONG_WORK_INTENT_RE.test(raw) || LINE_PHOTO_WORK_INTENT_RE.test(raw);
}

function looksLikeMentionOnly(raw: string): boolean {
  const mentions = raw.match(MENTION_RE) ?? [];
  if (mentions.length === 0 || hasWorkIntent(raw)) return false;

  const withoutMentions = removeMentions(raw);
  const tokens = semanticTokens(withoutMentions);
  if (tokens.length === 0) return true;

  const hasThai = /[ก-ฮ]/.test(withoutMentions);
  if (mentions.length >= 2 && !hasThai) return true;

  const compact = tokens.join("");
  return ROLE_OR_PERSON_NOISE_RE.test(compact);
}

function looksLikeLinePersonContext(raw: string): boolean {
  if (hasStrongWorkIntent(raw)) return false;
  if (looksLikeStockSpecContext(raw)) return false;

  const noMentions = removeMentions(raw);
  const tokens = semanticTokens(noMentions);
  if (tokens.length === 0) return true;
  if (tokens.length > 8) return false;

  const compact = tokens.join("");
  if (ROLE_OR_PERSON_NOISE_RE.test(compact)) return true;

  const hasPersonContext = LINE_PERSON_CONTEXT_RE.test(noMentions);
  if (!hasPersonContext) return false;

  const hasLineDecoration = EMOJI_OR_SYMBOL_RE.test(raw) || /\.\.\.|["'@]/.test(raw);
  const latinTokens = tokens.filter((token) => /^[A-Za-z][A-Za-z.'-]*$/.test(token));
  const thaiTokens = tokens.filter((token) => /[ก-ฮ]/.test(token));
  return hasLineDecoration || latinTokens.length >= 2 || thaiTokens.length <= 2;
}

function looksLikeNoiseOnly(raw: string): boolean {
  if (looksLikeLinePersonContext(raw)) return true;
  if (hasWorkIntent(raw)) return false;
  const noMentions = removeMentions(raw);
  const tokens = semanticTokens(noMentions);
  if (tokens.length === 0) return true;
  if (/^[a-zA-Z][a-zA-Z0-9 _.'"-]{0,32}$/.test(noMentions) && !VEHICLE_SPEC_RE.test(noMentions)) {
    return true;
  }
  return false;
}

function looksLikeCarReferenceMeta(raw: string): boolean {
  if (!CAR_REFERENCE_META_RE.test(raw)) return false;
  return !REAL_WORK_EXCLUDING_GENERIC_ENTRY_RE.test(raw);
}

function vehicleSignalScore(raw: string): number {
  let score = 0;
  if (STOCK_NUMBER_RE.test(raw)) score += 2;
  if (VEHICLE_BRAND_MODEL_RE.test(raw)) score += 2;
  if (VEHICLE_BODY_SPEC_RE.test(raw)) score += 1;
  if (VEHICLE_SPEC_RE.test(raw)) score += 1;
  if (VEHICLE_COLOR_YEAR_RE.test(raw)) score += 1;
  if (THAI_PLATE_RE.test(raw)) score += 2;
  THAI_PLATE_RE.lastIndex = 0;
  if (CHASSIS_RE.test(raw)) score += 3;
  return score;
}

function looksLikeStockSpecContext(raw: string): boolean {
  const tokens = semanticTokens(raw);
  if (tokens.length < 3) return false;

  const score = vehicleSignalScore(raw);
  if (score < 4) return false;

  // "ป้ายแดง" is vehicle context, not the actionable "ป้าย" task.
  const withoutRedPlate = raw.replace(/ป้ายแดง/gi, " ");
  const hasStrongWork = hasStrongWorkIntent(withoutRedPlate);
  if (hasStrongWork && score < 6) return false;

  return true;
}

function looksLikeThaiStockIdentityContext(raw: string): boolean {
  return THAI_STOCK_IDENTITY_RE.test(raw) && vehicleSignalScore(raw) >= 4;
}

function looksLikeVehicleContext(raw: string): boolean {
  if (RED_PLATE_CONTEXT_RE.test(raw)) return true;
  if (looksLikeThaiStockIdentityContext(raw)) return true;
  if (looksLikeStockSpecContext(raw)) return true;
  if (hasStrongWorkIntent(raw)) return false;
  const hasThaiPlateLike = THAI_PLATE_RE.test(raw);
  THAI_PLATE_RE.lastIndex = 0;
  if (hasThaiPlateLike && VEHICLE_SPEC_RE.test(raw)) return true;
  if (/^[0-9]{0,2}[ก-ฮ]{1,3}[-\s]?[0-9]{2,4}$/i.test(raw)) return true;
  if (/(chassis|vin|เลขถัง|ตัวถัง)/i.test(raw) || CHASSIS_RE.test(raw)) return true;
  if (VEHICLE_SPEC_RE.test(raw) && semanticTokens(raw).length <= 8) return true;
  return false;
}

function cleanWorkLine(raw: string): string {
  return removeCarIdentityFragments(stripLeadingVehicleContextFromMixedWorkLine(removeMentions(raw)));
}

function normalizeWorkItemText(raw: string): string {
  return sanitizeLine(raw)
    .replace(/([\u0E00-\u0E7F])([A-Z]{2,})\b/g, "$1 $2")
    .replace(/รอแจ้งกรอไมล์\s+อีกที/gi, "รอแจ้งกรอไมล์อีกที")
    .replace(/ติด\s*ฟิล์ม\s*รอบคัน/gi, "ติดฟิล์มรอบคัน")
    .replace(/ฟิล์ม\s*รอบคัน/gi, "ฟิล์มรอบคัน");
}

function startsWithCarIdentity(raw: string): boolean {
  if (LEADING_CAR_IDENTITY_RE.test(raw)) return true;
  const stock = raw.match(LEADING_NUMERIC_STOCK_RE);
  if (!stock) return false;
  const rest = raw.slice(stock[0].length);
  return VEHICLE_BRAND_MODEL_RE.test(rest) || VEHICLE_BODY_SPEC_RE.test(rest) || VEHICLE_SPEC_RE.test(rest);
}

function cleanupMixedLineWorkContext(raw: string): string {
  return normalizeWorkItemText(raw)
    .replace(/^(?:เมื่อวาน|เมือวาน)\s*(?:มี)?\s*/i, "")
    .replace(/^มี\s*/i, "")
    .replace(/\s+แล้ว$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingVehicleContextFromMixedWorkLine(raw: string): string {
  const clean = sanitizeLine(raw);
  if (!clean || !startsWithCarIdentity(clean)) return clean;

  const match = clean.match(MIXED_LINE_WORK_START_RE);
  if (!match || match.index == null || match.index <= 0) return clean;

  const prefix = clean.slice(0, match.index);
  const prefixScore = vehicleSignalScore(prefix);
  if (prefixScore < 2 && !startsWithCarIdentity(prefix)) return clean;

  const rest = cleanupMixedLineWorkContext(clean.slice(match.index));
  if (!rest || !hasWorkIntent(rest)) return clean;
  return rest;
}

function lineKey(raw: string): string {
  return String(raw ?? "").replace(/\s+/g, "").toLowerCase();
}

function canAcceptDetail(raw: string): boolean {
  return DETAIL_PARENT_RE.test(raw);
}

function looksLikeDetailLine(raw: string): boolean {
  if (!raw) return false;
  if (hasStrongWorkIntent(raw)) return false;
  if (looksLikeVehicleContext(raw) || looksLikeLinePersonContext(raw) || looksLikeCarReferenceMeta(raw)) return false;
  if (DETAIL_LINE_RE.test(raw)) return true;
  return /[0-9]/.test(raw) && /[ก-ฮ]/.test(raw) && semanticTokens(raw).length <= 6;
}

function looksLikeShortContinuationLine(raw: string): boolean {
  if (!raw || raw.length > 32) return false;
  if (hasStrongWorkIntent(raw) || looksLikeVehicleContext(raw) || looksLikeMentionOnly(raw)) return false;
  const tokens = semanticTokens(raw);
  if (tokens.length === 0 || tokens.length > 3) return false;
  return /^[A-Za-z0-9&.'\-\s]+$/.test(raw);
}

function addWorkItem(target: Array<{ text: string; note: string }>, value: string) {
  const clean = normalizeWorkItemText(value);
  if (!clean) return;
  const key = lineKey(clean);
  if (target.some((item) => lineKey(item.text) === key)) return;
  target.push({ text: clean, note: "" });
}

function splitCompoundWorkLine(value: string): string[] {
  const clean = normalizeWorkItemText(value);
  if (!clean || STANDALONE_CONTROL_LINE_RE.test(clean)) return [];

  const hardSegments = clean
    .split(/\s*(?:\/|\\|\|)\s*/g)
    .map((part) => normalizeWorkItemText(part))
    .filter(Boolean);

  return hardSegments
    .flatMap((part) =>
      part
        .replace(/\s+(รถมีตรวจ)/gi, "|||$1")
        .replace(/\s+(รอแจ้งกรอไมล์)/gi, "|||$1")
        .replace(/\s+(เอา\s*รถ\s*ไป\s*เช็ค|เอารถไปเช็ค)/gi, "|||$1")
        .replace(/\s+(ถ้ามีอะไรเสีย)/gi, "|||$1")
        .replace(/\s+(ยกเลิก|ไม่ต้อง|เบิก|รอ\s*ตรวจ|รอตรวจ|ใส่|เปลี่ยน)/gi, "|||$1")
        .split("|||")
    )
    .map((part) => normalizeWorkItemText(part))
    .filter(Boolean);
}

function addWorkLines(target: Array<{ text: string; note: string }>, value: string) {
  for (const part of splitCompoundWorkLine(value)) {
    addWorkItem(target, part);
  }
}

function addDetailToLast(target: Array<{ text: string; note: string }>, value: string): boolean {
  const clean = sanitizeLine(value);
  if (!clean || target.length === 0) return false;
  const last = target[target.length - 1];
  if (!last || !canAcceptDetail(last.text)) return false;
  const parts = last.note ? last.note.split(/\s*\/\s*/) : [];
  if (!parts.some((part) => lineKey(part) === lineKey(clean))) parts.push(clean);
  last.note = parts.join(" / ");
  return true;
}

function addShortContinuationToLastText(target: Array<{ text: string; note: string }>, value: string): boolean {
  const clean = sanitizeLine(value);
  if (!clean || target.length === 0) return false;
  const last = target[target.length - 1];
  if (!last) return false;
  if (!/(ทะเบียน|ป้ายทะเบียน|สติก|สติ๊ก|สต็อก|สต๊อก)$/i.test(last.text)) return false;
  if (lineKey(last.text).includes(lineKey(clean))) return true;
  last.text = `${last.text} ${clean}`.replace(/\s+/g, " ").trim();
  return true;
}

export function splitLineTextForInbox(text: string): SplitLineTextResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => sanitizeLine(l))
    .filter(Boolean);

  const groupedItems: Array<{ text: string; note: string }> = [];
  const ignoredVehicle: string[] = [];
  const ignoredMentions: string[] = [];
  const ignoredNoise: string[] = [];

  if (isLineInboxSystemAcknowledgementText(text)) {
    return {
      items: [],
      grouped_items: [],
      ignored_vehicle_spec_lines: [],
      ignored_mention_lines: [],
      ignored_noise_lines: lines.slice(0, 30),
    };
  }

  for (const rawLine of lines) {
    if (looksLikeMentionOnly(rawLine)) {
      addUnique(ignoredMentions, rawLine);
      continue;
    }

    const continuationLine = cleanWorkLine(rawLine);
    if (looksLikeShortContinuationLine(continuationLine) && addShortContinuationToLastText(groupedItems, continuationLine)) {
      continue;
    }

    if (looksLikeLinePersonContext(rawLine)) {
      addUnique(ignoredMentions, rawLine);
      continue;
    }

    if (looksLikeCarReferenceMeta(rawLine)) {
      addUnique(ignoredNoise, rawLine);
      continue;
    }

    const line = cleanWorkLine(rawLine);
    if (!line) {
      addUnique((rawLine.match(MENTION_RE) ?? []).length > 0 ? ignoredMentions : ignoredNoise, rawLine);
      continue;
    }

    const strippedMixedVehicleContext = lineKey(line) !== lineKey(rawLine) && hasWorkIntent(line);
    if (looksLikeVehicleContext(line) || (!strippedMixedVehicleContext && looksLikeVehicleContext(rawLine))) {
      addUnique(ignoredVehicle, rawLine);
      continue;
    }

    if (looksLikeDetailLine(line) || looksLikeShortContinuationLine(line)) {
      if (addDetailToLast(groupedItems, line)) continue;
      addUnique(ignoredNoise, rawLine);
      continue;
    }

    if (looksLikeNoiseOnly(line)) {
      addUnique((rawLine.match(MENTION_RE) ?? []).length > 0 ? ignoredMentions : ignoredNoise, rawLine);
      continue;
    }

    const beforeCount = groupedItems.length;
    addWorkLines(groupedItems, line);
    if (groupedItems.length === beforeCount) addUnique(ignoredNoise, rawLine);
  }

  const grouped = groupedItems.slice(0, 60);
  return {
    items: grouped.map((item) => item.text),
    grouped_items: grouped,
    ignored_vehicle_spec_lines: ignoredVehicle.slice(0, 30),
    ignored_mention_lines: ignoredMentions.slice(0, 30),
    ignored_noise_lines: ignoredNoise.slice(0, 30),
  };
}

export function splitLineTextToTaskLines(text: string): string[] {
  return splitLineTextForInbox(text).items;
}
