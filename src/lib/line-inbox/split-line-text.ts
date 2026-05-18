/**
 * Heuristic LINE text → task lines (aligned with order-intake ai-split guardrails)
 */

function sanitizeLine(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
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

    const mentions = line.match(/@\S+/g) ?? [];
    const wordCount = line.split(/\s+/).filter(Boolean).length;
    if (mentions.length >= 2 && mentions.length * 2 >= wordCount) continue;
    if (mentions.length >= 1 && wordCount <= 2) continue;

    const hasThaiPlateLike = /[ก-ฮ]{1,3}[-\s]?\d{1,4}/.test(line);
    const hasVehicleSpecToken =
      /(REVO|FORTUNER|HILUX|VIGO|RANGER|D-MAX|2WD|4WD|AT|MT|DOUBLE[_\s-]?CAB|SILVER|BLACK|WHITE|GRAY|GREY|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/i.test(
        line
      );
    if (hasThaiPlateLike && hasVehicleSpecToken) continue;
    if (/^[0-9]{0,2}[ก-ฮ]{1,3}[-\s]?[0-9]{1,4}$/i.test(line)) continue;
    const hasChassisKeyword = /(chassis|vin|เลขถัง|ตัวถัง)/i.test(line);
    const hasLongVinToken = /[a-z0-9-]{10,}/i.test(line);
    if (hasChassisKeyword || hasLongVinToken) continue;

    if (/^[a-zA-Z][a-zA-Z0-9 _-]{0,22}$/.test(line)) continue;

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
