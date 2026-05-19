/**
 * Heuristic LINE text -> task lines.
 * Vehicle identity/spec lines are kept as context, but never returned as order items.
 */

export type SplitLineTextResult = {
  items: string[];
  ignored_vehicle_spec_lines: string[];
  detected_car_text: string;
};

function sanitizeLine(raw: string): string {
  return raw.replace(/^[\s\-•*]+/, "").replace(/\s+/g, " ").trim();
}

const THAI_PLATE_RE = /(?:\d{0,2}\s*)?[ก-ฮ]{1,3}[-\s]?\d{1,4}/;
const CHASSIS_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/i;

const VEHICLE_MODEL_RE =
  /\b(REVO|HILUX|VIGO|RANGER|TRITON|FORTUNER|CAMRY|D[-\s]?MAX|NAVARA|PAJERO|MU[-\s]?X|ALTIS|YARIS|VIOS|COMMUTER|HIACE|EVEREST|BT[-\s]?50|COLORADO|CR[-\s]?V|CIVIC|ACCORD)\b/i;

const VEHICLE_SPEC_RE =
  /\b(4WD|2WD|AT|MT|AUTO|MANUAL|DOUBLE[_\s-]?CAB|SMART[_\s-]?CAB|OPEN[_\s-]?CAB|SINGLE[_\s-]?CAB|CAB|PRERUNNER|HI[-\s]?RIDER|HIGH[-\s]?RIDER|STD|STANDARD|LOW|HIGH)\b|\b[123]\.\d\b|\b(?:19|20)\d{2}\b/i;

const VEHICLE_COLOR_RE =
  /\b(WHITE|BLACK|GRAY|GREY|SILVER|BLUE|RED|GREEN|BROWN|GOLD|ORANGE|YELLOW|PEARL|BRONZE)\b/i;

const MONTH_RE =
  /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(?:\d{2,4})?\b/i;

const WORK_INTENT_RE =
  /(กันสาด|โรบาร์|สติ๊กเกอร์|ฟิล์ม|บันได|กันชน|แร็ค|แรค|ฝาครอบ|ไฟ|กล้อง|เซ็นเซอร์|ยาง|ล้อ|แบต|แบตเตอรี่|โช้ค|ยกสูง|ป้าย|เอกสาร|ซ่อม|เปลี่ยน|ขาด|แตก|เสีย|หาย|ต้องสั่ง|ส่งอู่|ทำสี|ตรวจ|เช็ค|ติด|ติดตั้ง|เพิ่ม|ใส่|แปลง|ล้าง|ขัด|เคลือบ|เก็บงาน|ประเมิน|รับงาน|งาน)/i;

function hasWorkIntent(line: string): boolean {
  return WORK_INTENT_RE.test(line);
}

function hasVehicleSpecToken(line: string): boolean {
  return (
    VEHICLE_MODEL_RE.test(line) ||
    VEHICLE_SPEC_RE.test(line) ||
    VEHICLE_COLOR_RE.test(line) ||
    MONTH_RE.test(line)
  );
}

function looksLikeThaiPlateOnly(line: string): boolean {
  const compact = line.replace(/\s+/g, "");
  return /^[0-9]{0,2}[ก-ฮ]{1,3}-?[0-9]{1,4}$/.test(compact);
}

function looksLikeChassisOnly(line: string): boolean {
  if (hasWorkIntent(line)) return false;
  if (/(chassis|vin|เลขถัง|ตัวถัง)/i.test(line)) return true;
  const compact = line.replace(/[\s-]/g, "");
  return /^[A-HJ-NPR-Z0-9]{10,24}$/i.test(compact) && CHASSIS_RE.test(compact);
}

function looksLikePriceOrMileageOnly(line: string): boolean {
  if (hasWorkIntent(line)) return false;
  const cleaned = line.replace(/[,\s]/g, "");
  if (/^(?:cost|price|ราคา|ไมล์|เลขไมล์)?[$฿]?\d+(?:\.\d+)?(?:บาท|km|kms|กม\.?|ไมล์)?$/i.test(cleaned)) {
    return true;
  }
  return /^\d[\d,.\s]*(?:km|kms|กม\.?|ไมล์)$/i.test(line.trim());
}

function looksLikeVehicleSpecOnly(line: string): boolean {
  if (hasWorkIntent(line)) return false;
  const hasModel = VEHICLE_MODEL_RE.test(line);
  const specHits = [
    VEHICLE_SPEC_RE.test(line),
    VEHICLE_COLOR_RE.test(line),
    MONTH_RE.test(line),
    /\b(?:19|20)\d{2}\b/.test(line),
  ].filter(Boolean).length;
  const words = line.split(/\s+/).filter(Boolean).length;

  if (hasModel && specHits >= 1) return true;
  if (hasModel && words <= 4) return true;
  if (specHits >= 2 && words <= 8) return true;
  if (/^[A-Z0-9._\s-]{3,60}$/i.test(line) && hasVehicleSpecToken(line)) return true;
  return false;
}

function shouldSkipNonItemNoise(line: string): boolean {
  if (hasWorkIntent(line)) return false;
  if (/^(ตามรูป|รูป|ครับ|ค่ะ|คับ|ok|โอเค)$/i.test(line.trim())) return true;
  if (/^[a-zA-Z][a-zA-Z0-9 _-]{0,22}$/.test(line) && !hasVehicleSpecToken(line)) return true;
  return false;
}

function addUnique(target: string[], value: string) {
  const clean = sanitizeLine(value);
  if (!clean) return;
  const key = clean.toLowerCase();
  if (target.some((v) => v.toLowerCase() === key)) return;
  target.push(clean);
}

export function splitLineTextForInbox(text: string): SplitLineTextResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => sanitizeLine(l))
    .filter(Boolean);

  const items: string[] = [];
  const ignored: string[] = [];

  for (const line of lines) {
    const mentions = line.match(/@\S+/g) ?? [];
    const wordCount = line.split(/\s+/).filter(Boolean).length;
    if (mentions.length >= 2 && mentions.length * 2 >= wordCount) continue;
    if (mentions.length >= 1 && wordCount <= 2) continue;

    const hasThaiPlateLike = THAI_PLATE_RE.test(line);
    if (looksLikeThaiPlateOnly(line) || looksLikeChassisOnly(line)) {
      addUnique(ignored, line);
      continue;
    }

    if (hasThaiPlateLike && hasVehicleSpecToken(line) && !hasWorkIntent(line)) {
      addUnique(ignored, line);
      continue;
    }

    if (looksLikeVehicleSpecOnly(line) || looksLikePriceOrMileageOnly(line)) {
      addUnique(ignored, line);
      continue;
    }

    if (shouldSkipNonItemNoise(line)) continue;
    addUnique(items, line);
  }

  return {
    items: items.slice(0, 60),
    ignored_vehicle_spec_lines: ignored.slice(0, 30),
    detected_car_text: ignored.slice(0, 12).join("\n"),
  };
}

export function splitLineTextToTaskLines(text: string): string[] {
  return splitLineTextForInbox(text).items;
}
