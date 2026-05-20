/**
 * Heuristic LINE text -> task lines (aligned with order-intake ai-split guardrails).
 * Mentions/tags and conversation noise are returned as ignored context, not order items.
 */

export type SplitLineTextResult = {
  items: string[];
  ignored_vehicle_spec_lines: string[];
  ignored_mention_lines: string[];
  ignored_noise_lines: string[];
};

const MENTION_RE = /@\S+/g;
const THAI_PLATE_RE = /\d{0,2}[ก-ฮ]{1,3}[-\s]?\d{2,4}/g;
const CHASSIS_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/i;
const VEHICLE_SPEC_RE =
  /(REVO|FORTUNER|HILUX|VIGO|RANGER|D-MAX|TRITON|CAMRY|2WD|4WD|AT|MT|DOUBLE[_\s-]?CAB|SMART[_\s-]?CAB|SILVER|BLACK|WHITE|GRAY|GREY|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|\b[123]\.\d\b|\b(?:19|20)\d{2}\b)/i;
const WORK_INTENT_RE =
  /(กันสาด|โรบาร์|สติ๊กเกอร์|ฟิล์ม|บันได|กันชน|แร็ค|แรค|ฝาครอบ|ไฟ|กล้อง|เซ็นเซอร์|ยาง|ล้อ|แบต|แบตเตอรี่|โช้ค|ยกสูง|ป้าย|เอกสาร|ซ่อม|เปลี่ยน|ขาด|แตก|เสีย|หาย|ต้องสั่ง|ส่งอู่|ทำสี|ตรวจ|เช็ค|ติด|ติดตั้ง|เพิ่ม|ใส่|แปลง|ล้าง|ขัด|เคลือบ|เก็บงาน|ประเมิน|รับงาน|งาน)/i;
const ROLE_OR_PERSON_NOISE_RE =
  /^(?:[A-Za-z.'"-]+|\bTH\b|\bChecker\b|\bSale\b|\bSales\b|\bSupport\b|\bStore\b|\bGarage\b|\bAdmin\b|\bTeam\b|\bStaff\b|\bQC\b|\bLoSo\b|\bManbappe\b|\bAof\b|\bFrank\b|\bKik\b|\bNutkun\b|\bJoy\b|\bMint\b|\bPrew\b|\bGwang\b|\bAor\b|\bWan\b|\bMai\b|\bNat\b|\bNoey\b|\bSine\b|\bPloo\b|\bYing\b|\bFairy\b|\bFah\b|\bBam\b|\bKoi\b|\bTarn\b)+$/i;

function sanitizeLine(raw: string): string {
  return raw.replace(/^[\s\-•*]+/, "").replace(/\s+/g, " ").trim();
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
  return sanitizeLine(
    raw
      .replace(THAI_PLATE_RE, " ")
      .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, " ")
      .replace(/^(?:ช่วย|รบกวน|ฝาก)\s*/i, "")
  );
}

function semanticTokens(raw: string): string[] {
  return raw.match(/[A-Za-zก-ฮ0-9]+/g) ?? [];
}

function looksLikeMentionOnly(raw: string): boolean {
  const mentions = raw.match(MENTION_RE) ?? [];
  if (mentions.length === 0 || WORK_INTENT_RE.test(raw)) return false;

  const withoutMentions = removeMentions(raw);
  const tokens = semanticTokens(withoutMentions);
  if (tokens.length === 0) return true;

  const hasThai = /[ก-ฮ]/.test(withoutMentions);
  if (mentions.length >= 2 && !hasThai) return true;

  const compact = tokens.join("");
  return ROLE_OR_PERSON_NOISE_RE.test(compact);
}

function looksLikeNoiseOnly(raw: string): boolean {
  if (WORK_INTENT_RE.test(raw)) return false;
  const noMentions = removeMentions(raw);
  const tokens = semanticTokens(noMentions);
  if (tokens.length === 0) return true;
  if (/^[a-zA-Z][a-zA-Z0-9 _.'"-]{0,32}$/.test(noMentions) && !VEHICLE_SPEC_RE.test(noMentions)) {
    return true;
  }
  return false;
}

function looksLikeVehicleContext(raw: string): boolean {
  if (WORK_INTENT_RE.test(raw)) return false;
  const hasThaiPlateLike = THAI_PLATE_RE.test(raw);
  THAI_PLATE_RE.lastIndex = 0;
  if (hasThaiPlateLike && VEHICLE_SPEC_RE.test(raw)) return true;
  if (/^[0-9]{0,2}[ก-ฮ]{1,3}[-\s]?[0-9]{2,4}$/i.test(raw)) return true;
  if (/(chassis|vin|เลขถัง|ตัวถัง)/i.test(raw) || CHASSIS_RE.test(raw)) return true;
  if (VEHICLE_SPEC_RE.test(raw) && semanticTokens(raw).length <= 8) return true;
  return false;
}

function cleanWorkLine(raw: string): string {
  return removeCarIdentityFragments(removeMentions(raw));
}

export function splitLineTextForInbox(text: string): SplitLineTextResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => sanitizeLine(l))
    .filter(Boolean);

  const items: string[] = [];
  const ignoredVehicle: string[] = [];
  const ignoredMentions: string[] = [];
  const ignoredNoise: string[] = [];

  for (const rawLine of lines) {
    if (looksLikeMentionOnly(rawLine)) {
      addUnique(ignoredMentions, rawLine);
      continue;
    }

    const line = cleanWorkLine(rawLine);
    if (!line) {
      addUnique((rawLine.match(MENTION_RE) ?? []).length > 0 ? ignoredMentions : ignoredNoise, rawLine);
      continue;
    }

    if (looksLikeVehicleContext(line) || looksLikeVehicleContext(rawLine)) {
      addUnique(ignoredVehicle, rawLine);
      continue;
    }

    if (looksLikeNoiseOnly(line)) {
      addUnique((rawLine.match(MENTION_RE) ?? []).length > 0 ? ignoredMentions : ignoredNoise, rawLine);
      continue;
    }

    addUnique(items, line);
  }

  return {
    items: items.slice(0, 60),
    ignored_vehicle_spec_lines: ignoredVehicle.slice(0, 30),
    ignored_mention_lines: ignoredMentions.slice(0, 30),
    ignored_noise_lines: ignoredNoise.slice(0, 30),
  };
}

export function splitLineTextToTaskLines(text: string): string[] {
  return splitLineTextForInbox(text).items;
}
