/**
 * Heuristic LINE text → task lines (aligned with order-intake ai-split guardrails)
 */

function sanitizeLine(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * บรรทัดที่เป็นหัวรถ / ทะเบียน / สเปครถ / เลขตัวถัง / noise — ห้ามอยู่ในรายการงานอู่
 * ใช้ทั้ง heuristic แบ่งบรรทัด และกรองผลหลัง Groq/Gemini
 */
export function shouldDropAsVehicleLogisticsLine(line: string): boolean {
  const lineTrim = sanitizeLine(line);
  if (!lineTrim) return true;

  const mentions = lineTrim.match(/@\S+/g) ?? [];
  const wordCount = lineTrim.split(/\s+/).filter(Boolean).length;
  if (mentions.length >= 2 && mentions.length * 2 >= wordCount) return true;
  if (mentions.length >= 1 && wordCount <= 2) return true;

  const hasThaiPlateLike = /[ก-ฮ]{1,3}[-\s]?\d{1,4}/.test(lineTrim);
  const hasVehicleSpecToken =
    /(REVO|FORTUNER|HILUX|VIGO|RANGER|D-MAX|2WD|4WD|AT|MT|DOUBLE[_\s-]?CAB|SILVER|BLACK|WHITE|GRAY|GREY|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/i.test(
      lineTrim
    );
  if (hasThaiPlateLike && hasVehicleSpecToken) return true;
  if (/^[0-9]{0,2}[ก-ฮ]{1,3}[-\s]?[0-9]{1,4}$/i.test(lineTrim)) return true;
  const hasChassisKeyword = /(chassis|vin|เลขถัง|ตัวถัง)/i.test(lineTrim);
  const hasLongVinToken = /[a-z0-9-]{10,}/i.test(lineTrim);
  if (hasChassisKeyword || hasLongVinToken) return true;

  if (/^[a-zA-Z][a-zA-Z0-9 _-]{0,22}$/.test(lineTrim)) return true;

  /** บรรทัดที่เป็นแถวสเปครถล้วน (ตัวเลข+รุ่นยี่ห้อ ไทยเกือบไม่มี) */
  const thaiCount = (lineTrim.match(/[\u0E00-\u0E7F]/g) ?? []).length;
  if (
    thaiCount <= 2 &&
    lineTrim.length <= 140 &&
    /(VIGO|REVO|FORTUNER|HILUX|4WD|2WD|DOUBLE|CAB|AT\b|MT\b)/i.test(lineTrim)
  ) {
    return true;
  }

  return false;
}

/** ตัดป้ายไทย / token ยาวคล้าย VIN ที่แทรกในประโยคงาน — ก่อนตรวจ drop ซ้ำ */
export function stripEmbeddedPlateSpecChassis(line: string): string {
  const a = line.replace(/[0-9]{0,2}[ก-ฮ]{1,3}[-\s]?[0-9]{1,4}/g, " ");
  const b = a.replace(/(?:chassis|vin|เลขถัง|ตัวถัง)\s*[:#]?\s*[a-zA-Z0-9-]{8,}/gi, " ");
  return sanitizeLine(b);
}

/**
 * กรองผลจาก LLM ให้เหลือแต่งานอู่ — ไม่มีทะเบียน สเปคหัวรถ เลขถัง
 */
export function filterLlmExtractedTaskLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const s = stripEmbeddedPlateSpecChassis(sanitizeLine(raw));
    if (!s) continue;
    if (shouldDropAsVehicleLogisticsLine(s)) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= 60) break;
  }
  return out;
}

export function splitLineTextToTaskLines(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (shouldDropAsVehicleLogisticsLine(line)) continue;
    out.push(line);
  }

  const uniq = new Set<string>();
  const dedup: string[] = [];
  for (const l of out.map(sanitizeLine)) {
    const key = l.toLowerCase();
    if (uniq.has(key)) continue;
    uniq.add(key);
    dedup.push(l);
  }
  return dedup.slice(0, 60);
}
