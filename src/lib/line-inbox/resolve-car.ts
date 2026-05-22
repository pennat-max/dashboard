import type { SupabaseClient } from "@supabase/supabase-js";
import type { LineInboxCarAiByModel, LineInboxCarAiModelPick } from "@/lib/line-inbox/types";

const CARS_TABLE = process.env.NEXT_PUBLIC_SUPABASE_CARS_TABLE ?? "cars";

/** ทะเบียนไทยแบบมีเลขนำข้างหน้าเขต เช่น 2ฒณ-4051 — สอดคล้องกับ ai-split / split-line-text */
const THAI_PLATE_WITH_PREFIX = /\d{0,2}[ก-ฮ]{1,3}[-\s]?\d{1,4}/g;
/** Fallback: เฉพาะส่วนตัวอักษรไทย+เลขท้าย เมื่อข้อความไม่มีเลขนำ */
const THAI_PLATE_CORE = /[ก-ฮ]{1,3}[-\s]?\d{1,4}/g;

type CarsPickRow = {
  row_id?: unknown;
  plate_number?: unknown;
  chassis_number?: unknown;
  spec?: unknown;
  brand?: unknown;
  model?: unknown;
};

export type ResolvedCar = {
  car_row_id: string;
  plate_text: string;
  chassis: string;
  spec: string;
  confidence: number;
  /** ช่วงสเปกจากบรรทัดแรกข้อความ (หลังตัดป้าย/VIN) — ฝั่งที่เอาไปเทียบกับ cars.spec */
  line_spec_snippet?: string;
  /** สเปกจากคอลัมน์ cars.spec ของคันที่จับคู่ (ก่อนโอเวอร์เลย์เพื่อโชว์ตามแชท) */
  db_spec?: string;
};

/** ให้ความชอบกับบรรทัดแรกที่มักเป็น header ป้าย+สเปก */
function headlineContext(raw: string): string {
  const firstLine = String(raw ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  return [firstLine, raw].filter(Boolean).join(" ");
}

export function normalizePlateKey(s: string): string {
  return s.replace(/[-\s\u00a0]+/g, "").toUpperCase();
}

/** บรรทัดหัวหลังตัดทะเบียนไทย + VIN — ส่วนที่มักเป็น “สเปก” ต่อท้ายป้าย */
function stripPlatesAndVinFromLine(line: string): string {
  let s = line;
  THAI_PLATE_WITH_PREFIX.lastIndex = 0;
  s = s.replace(THAI_PLATE_WITH_PREFIX, " ");
  THAI_PLATE_CORE.lastIndex = 0;
  s = s.replace(THAI_PLATE_CORE, " ");
  s = s.replace(/\b([A-HJ-NPR-Z0-9]{17})\b/gi, " ");
  return s.replace(/\s+/g, " ").trim();
}

function firstLineSpecSnippetAfterPlate(raw: string): string {
  const line =
    String(raw ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  const noMentions = line.replace(/@\S+/g, " ");
  return stripPlatesAndVinFromLine(noMentions);
}

/**
 * บรรทัดหัวอาจขึ้นต้นเป็นเลขตัวเดียวกับท้ายป้ายไทยในข้อความ (เช่น บรรทัด 1 = "363 VIGO..." บรรทัด 2 = "กน-363")
 * ตัดเลขนำห้างซ้ำออกจากช่วงสเปกเพื่อไม่ให้ซ้ำกับ plate_number ใน DB
 */
function stripLeadingDigitsIfDuplicateOfThaiPlateTail(specAfter: string, raw: string): string {
  const digitTails = new Set<string>();
  let m: RegExpExecArray | null;
  THAI_PLATE_WITH_PREFIX.lastIndex = 0;
  while ((m = THAI_PLATE_WITH_PREFIX.exec(raw)) !== null) {
    const d = m[0].replace(/[^\d]/g, "");
    if (d.length >= 2 && d.length <= 5) digitTails.add(d);
  }
  THAI_PLATE_CORE.lastIndex = 0;
  while ((m = THAI_PLATE_CORE.exec(raw)) !== null) {
    const d = m[0].replace(/[^\d]/g, "");
    if (d.length >= 2 && d.length <= 5) digitTails.add(d);
  }
  let s = specAfter.trimStart();
  for (const d of digitTails) {
    if (!s.startsWith(d)) continue;
    const next = s.charAt(d.length);
    if (s.length === d.length || next === "" || /\s|[_/|•,]/.test(next)) {
      s = s.slice(d.length).replace(/^\s+/, "").trim();
      break;
    }
  }
  return s;
}

/** ช่วงสเปกจากบรรทัดหัว (หลังตัดทะเบียน/VIN) — ใช้เทียบกับคอลัมน์ cars.spec และส่งให้ LLM อ้างอิง */
export function extractLineVehicleSpecSnippet(raw: string): string {
  let base = firstLineSpecSnippetAfterPlate(raw);
  const lines = String(raw ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  /** บรรทัดแรกสั้นมาก — ผนวกบรรทัดถัดไปที่ดูเหมือนต่อสเปกรถ (มีรหัสละติน/รุ่น) */
  if (lines.length >= 2 && base.length < 16) {
    const noM = lines[1].replace(/@\S+/g, " ");
    const second = stripPlatesAndVinFromLine(noM);
    if (second.length >= 6 && /[A-Za-z]{2,}/.test(second)) {
      base = `${base} ${second}`.replace(/\s+/g, " ").trim();
    }
  }
  base = stripLeadingDigitsIfDuplicateOfThaiPlateTail(base, raw);
  return base;
}

/**
 * สเปกบรรทัดแรกดูเหมือนรุ่น/รหัสรถ (มีหลายโทเค็นละติน/ตัวเลข) แต่ cars.spec ไม่มีโทเค็นใดจับคู่ได้
 * — มักเกิดจาก spec ในฐานเป็นโน้ตมิใช่รุ่น หรือ heuristic ผิดคัน
 */
export function specLineVsDbSpecLooksMismatched(lineSpec: string, dbSpec: string): boolean {
  const line = String(lineSpec ?? "").trim();
  const db = String(dbSpec ?? "").trim().toLowerCase();
  if (line.length < 5 || db.length < 3) return false;

  const normalizedLine = line.replace(/_/g, " ").toLowerCase();
  const parts = normalizedLine
    .split(/[^a-z0-9]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3);
  const latinish = parts.filter((p) => /[a-z]/i.test(p) || /^[0-9]{3,5}$/.test(p));
  if (latinish.length >= 2) {
    let hits = 0;
    for (const t of latinish) {
      if (db.includes(t.toLowerCase())) hits++;
    }
    if (hits > 0) return false;
    const thaiInDb = [...db].filter((c) => c >= "\u0E00" && c <= "\u0E7F").length;
    if (thaiInDb >= 6 && latinish.length >= 2) return true;
    return latinish.length >= 3;
  }

  const thaiParts = line.split(/[^\u0E00-\u0E7F]+/).filter((p) => p.trim().length >= 2);
  if (thaiParts.length < 3) return false;
  let thHits = 0;
  for (const t of thaiParts) {
    if (db.includes(t.trim())) thHits++;
  }
  return thHits === 0 && db.length > 20;
}

export function extractChassisCandidates(text: string): string[] {
  const out: string[] = [];
  const re = /\b([A-HJ-NPR-Z0-9]{17})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1].toUpperCase());
  }
  return Array.from(new Set(out));
}

/**
 * นิยามทุกช่องที่เอาไปค้น/ตัดคะแนนเลขถัง: VIN เต็ม + ท้าย 8–12 หลัก + ช่วง 9–16 ที่ไม่ใช่ 17 (พิมพ์ไม่ครบ)
 */
export function extractChassisSearchTokens(raw: string): string[] {
  const seen = new Set<string>();
  const addNorm = (u: string) => {
    const t = u.replace(/[-\s]/g, "").toUpperCase();
    if (t.length < 8) return;
    seen.add(t);
    if (t.length >= 17) {
      seen.add(t.slice(-12));
      seen.add(t.slice(-8));
    } else if (t.length >= 12) {
      seen.add(t.slice(-8));
    }
  };

  for (const v of extractChassisCandidates(raw)) {
    addNorm(v);
  }

  const loose = /\b[A-HJ-NPR-Z0-9-]{9,16}\b/gi;
  let lm: RegExpExecArray | null;
  while ((lm = loose.exec(raw)) !== null) {
    const flat = lm[0].replace(/[-\s]/g, "").toUpperCase();
    if (flat.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(flat)) continue;
    addNorm(lm[0]);
  }

  /** หลังคำว่า เลขตัวถัง / ตัวถัง / chassis / VIN — มักพิมพ์แยกบรรทัด */
  const labelRe =
    /(?:เลข\s*ตัวถัง|ตัว\s*ถัง|เลขถัง|chassis|frame\s*no|\bvin\b)[\s:：]*([A-HJ-NPR-Z0-9-]{8,24})/gi;
  let lm2: RegExpExecArray | null;
  while ((lm2 = labelRe.exec(raw)) !== null) {
    addNorm(lm2[1]);
  }

  return [...seen].sort((a, b) => b.replace(/-/g, "").length - a.replace(/-/g, "").length);
}

function normSpecCompact(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * คะแนนเทียบข้อความ LINE กับแถวรถ — ทะเบียน · สเปค · เลขตัวถัง พร้อมกัน
 * ใช้ทุกอย่างที่ดึงได้จากข้อความไปเทียบกับ DB แม้ผู้ใช้จะใส่มาแค่ 1–2 อย่าง
 */
export function scoreLineAgainstCarTriple(
  raw: string,
  row: { plate_number?: unknown; chassis_number?: unknown; spec?: unknown; brand?: unknown; model?: unknown }
): number {
  const plateDb = normalizePlateKey(String(row.plate_number ?? ""));
  const chassisDb = String(row.chassis_number ?? "")
    .toUpperCase()
    .replace(/\s+/g, "");
  const specDb = normSpecCompact(String(row.spec ?? ""));
  const specFlat = specDb.replace(/\s/g, "");

  let platePts = 0;
  const plateTokens = Array.from(
    new Set([...extractThaiPlateSearchStrings(headlineContext(raw)), ...extractThaiPlateSearchStrings(raw)])
  );
  for (const pl of plateTokens.length ? plateTokens : extractThaiPlateSearchStrings(raw)) {
    const pk = normalizePlateKey(pl);
    if (!pk || !plateDb) continue;
    if (plateDb === pk) platePts = Math.max(platePts, 45);
    else if (plateDb.includes(pk) || pk.includes(plateDb)) platePts = Math.max(platePts, 32);
  }

  let chassisPts = 0;
  for (const ch of extractChassisSearchTokens(raw)) {
    const c = ch.replace(/\s/g, "").toUpperCase();
    if (!c || !chassisDb) continue;
    if (chassisDb.includes(c)) {
      chassisPts = Math.max(chassisPts, c.length >= 17 ? 55 : c.length >= 12 ? 48 : c.length >= 8 ? 34 : 26);
      continue;
    }
    /** ผู้ใช้วางเฉพาะท้ายเลขถัง — เทียบกับ DB */
    if (c.length >= 8 && c.length < 17 && chassisDb.endsWith(c)) {
      chassisPts = Math.max(chassisPts, 38);
    }
  }

  /** ใช้ช่วงสเปกเดียวกับ extractLineVehicleSpecSnippet (รวมบรรทัดสองเมื่อบรรทัดแรกสั้น) */
  const snippet = normSpecCompact(extractLineVehicleSpecSnippet(raw));
  let specPts = 0;
  if (snippet.length >= 3 && specDb.length > 0) {
    const take = Math.min(140, snippet.length);
    const pref = snippet.slice(0, take);
    const prefFlat = pref.replace(/\s/g, "");
    if (pref.length >= 12 && specDb.includes(pref)) specPts += 44;
    else if (pref.length >= 6 && specDb.includes(snippet.slice(0, 56))) specPts += 30;
    else if (prefFlat.length >= 8 && specFlat.includes(prefFlat)) specPts += 36;
    /** สเปกใน DB อยู่ในบรรทัดหัวที่ผู้ใช้พิมพ์ */
    if (specDb.length >= 6 && snippet.includes(specDb.slice(0, Math.min(48, specDb.length)))) specPts += 32;
    const tokens = pref
      .split(/[\s,/|•]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && !/^@/.test(t));
    let hits = 0;
    for (const tok of tokens.slice(0, 36)) {
      if (tok.length < 2) continue;
      if (tok.length === 2 && !/^(mt|at|g|xl|gl|dx|wd|mr|le)$/i.test(tok)) continue;
      const tflat = tok.replace(/\s/g, "");
      if (specDb.includes(tok) || (tflat.length >= 3 && specFlat.includes(tflat))) hits += 1;
    }
    specPts += Math.min(40, Math.min(22, hits) * 5);
  }

  /** โทเค็นรุ่นที่ปรากฏในยี่ห้อ/รุ่นในฐาน แม้ spec จะเป็นโน้ต */
  const brandM = normSpecCompact(String(row.brand ?? ""));
  const modelM = normSpecCompact(String(row.model ?? ""));
  if ((brandM.length >= 2 || modelM.length >= 2) && snippet.length >= 3) {
    const bm = `${brandM} ${modelM}`.replace(/\s+/g, " ");
    const tokenized = snippet.split(/[\s,/|•_]+/).map((t) => t.trim().toLowerCase());
    for (const t of tokenized) {
      if (t.length < 3) continue;
      if (bm.includes(t)) specPts += 6;
    }
  }

  let score = platePts + chassisPts + specPts;

  /** ชนะชัดเมื่อหลายสัญญาณชี้คันเดียวกัน (ผู้ใช้บอกทะเบียน+สเปค / ป้าย+ท้ายถัง / กลุ่มสเปค+ถัง ฯลฯ) */
  if (platePts >= 32 && chassisPts >= 26 && specPts >= 12) score += 24;
  else if (platePts >= 32 && chassisPts >= 26) score += 18;
  else if (platePts >= 32 && specPts >= 20) score += 16;
  else if (chassisPts >= 30 && specPts >= 18) score += 18;
  else if (platePts >= 32 && specPts >= 15) score += 14;
  else if (chassisPts >= 34 && specPts >= 15) score += 14;

  return score;
}

function rowHaystackTokenHay(row: CarsPickRow): string {
  return [
    normalizePlateKey(String(row.plate_number ?? "")),
    String(row.chassis_number ?? "").replace(/\s/g, "").toUpperCase(),
    normSpecCompact(String(row.spec ?? "")),
    String(row.brand ?? "").toLowerCase(),
    String(row.model ?? "").toLowerCase(),
  ]
    .join(" ")
    .toLowerCase();
}

function extractMessageTokensForCoverage(raw: string): string[] {
  const snip = normSpecCompact(extractLineVehicleSpecSnippet(raw));
  const head = normSpecCompact(headlineContext(raw).slice(0, 560));
  const parts = new Set<string>();
  for (const chunk of [snip, head]) {
    for (const p of chunk.split(/[^a-z0-9\u0E00-\u0E7F_]+/)) {
      const x = p.trim().toLowerCase();
      if (x.length < 2 || x.startsWith("@")) continue;
      parts.add(x);
      for (const sub of x.split("_")) {
        if (sub.length >= 2) parts.add(sub);
      }
    }
  }
  return [...parts]
    .filter((t) => {
      if (t.length >= 3) return true;
      if (t.length === 2)
        return /^(mt|at|g|xl|gl|dx|wd|le|se|mr|cab)$/i.test(t) || /^[a-z0-9]{2}$/i.test(t);
      return false;
    })
    .slice(0, 48);
}

/** สัดส่วนโทเค็นที่พบในป้าย+ตัวถัง+สเปก+ยี่ห้อรุ่น — ~0.8 = ใกล้เคียงตามที่ผู้ใช้ต้องการ */
export function tokenCoverage01AgainstCar(raw: string, row: CarsPickRow): number {
  const hay = rowHaystackTokenHay(row);
  const tokens = extractMessageTokensForCoverage(raw);
  if (tokens.length === 0) return 0;
  let hit = 0;
  for (const tok of tokens) {
    if (hay.includes(tok)) hit++;
  }
  return hit / tokens.length;
}

export function extractThaiPlateSearchStrings(raw: string): string[] {
  const seen = new Set<string>();
  const push = (x: string) => {
    const t = x.replace(/\s+/g, "").trim();
    if (t.length >= 3) seen.add(t);
  };

  let m: RegExpExecArray | null;
  THAI_PLATE_WITH_PREFIX.lastIndex = 0;
  while ((m = THAI_PLATE_WITH_PREFIX.exec(raw)) !== null) {
    push(m[0]);
  }

  if (seen.size === 0) {
    THAI_PLATE_CORE.lastIndex = 0;
    while ((m = THAI_PLATE_CORE.exec(raw)) !== null) {
      push(m[0]);
    }
  }

  return [...seen].sort((a, b) => b.length - a.length);
}

function plateOrFilters(plate: string): string | null {
  const variants = new Set<string>();
  const c = plate.replace(/\s+/g, "").trim();
  if (!c) return null;
  variants.add(c);
  variants.add(c.replace(/-/g, ""));
  /** ให้จับคู่เมื่อใน DB มีขีด/ช่องว่างคั่น แต่ข้อความติดกัน — เช่น %2ฒณ%4051% */
  const split = /^(\d{0,2}[ก-ฮ]{1,3})[-\s]?(\d{1,4})$/.exec(c);
  if (split) {
    variants.add(`${split[1]}%${split[2]}`);
  }
  return [...variants].map((v) => `plate_number.ilike.%${v}%`).join(",");
}

function extractSpecHints(raw: string): string[] {
  const hints = new Set<string>();
  const hay = headlineContext(raw);
  const parts = hay.split(/\s+/);
  for (let p of parts) {
    const t = p.trim();
    if (!t || t.startsWith("@")) continue;
    p = t.replace(/^#+/, "");
    if (p.length < 2) continue;
    if (/^\d{5,}$/.test(p)) continue;
    if (/^[+\d().-]{8,}$/.test(p)) continue;
    hints.add(p.toUpperCase());
  }
  return [...hints];
}

function hintScore(specUpper: string, hints: string[]): number {
  let s = 0;
  for (const h of hints) {
    if (h.length < 2) continue;
    if (specUpper.includes(h)) s += 2;
  }
  return s;
}

function pickCarFromPlateRows(
  rows: CarsPickRow[],
  plateCandidate: string,
  contextRaw: string
): { row: CarsPickRow; confidence: number } | null {
  const valid = rows.filter((r) => r?.row_id);
  if (valid.length === 0) return null;
  if (valid.length === 1) {
    const triple = scoreLineAgainstCarTriple(contextRaw, valid[0]);
    const conf = triple >= 14 ? 0.64 : triple >= 6 ? 0.6 : triple >= 1 ? 0.57 : 0.54;
    return { row: valid[0], confidence: conf };
  }

  const targetKey = normalizePlateKey(plateCandidate);
  const exact = valid.filter((r) => normalizePlateKey(String(r.plate_number ?? "")) === targetKey);
  if (exact.length === 1) {
    const triple = scoreLineAgainstCarTriple(contextRaw, exact[0]);
    const conf = triple >= 14 ? 0.62 : triple >= 6 ? 0.59 : triple >= 1 ? 0.56 : 0.54;
    return { row: exact[0], confidence: conf };
  }

  const hints = extractSpecHints(contextRaw);
  const pool = exact.length > 0 ? exact : valid;
  const scored = pool.map((r) => {
    const triple = scoreLineAgainstCarTriple(contextRaw, r);
    const hint = hintScore(String(r.spec ?? "").toUpperCase(), hints);
    return { r, triple, score: triple * 2 + hint };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.triple - a.triple;
  });
  const delta = scored[0].score - scored[1].score;
  const tripleDelta = scored[0].triple - scored[1].triple;
  if (delta <= 0 && tripleDelta <= 0) {
    if (scored[0].triple > 0) return { row: scored[0].r, confidence: 0.51 };
    return null;
  }

  /** ผู้ใช้เทียบสามอย่าง: ทะเบียน ↔ plate · ช่วงบรรทัดแรก ↔ spec · VIN ↔ chassis */
  const t0 = scored[0].triple;
  const t1 = scored[1].triple;
  if (t0 >= 32 && delta >= 14) return { row: scored[0].r, confidence: 0.61 };
  if (t0 >= 18 && delta >= 10) return { row: scored[0].r, confidence: 0.58 };
  if (t0 >= 10 && delta >= 6) return { row: scored[0].r, confidence: 0.55 };
  if (t0 > 0 && t1 === 0 && delta >= 8) return { row: scored[0].r, confidence: 0.54 };

  const hintOnly = pool.map((r) => ({
    r,
    score: hintScore(String(r.spec ?? "").toUpperCase(), hints),
  }));
  hintOnly.sort((a, b) => b.score - a.score);
  if (hintOnly[0].score >= 2 && hintOnly[0].score > hintOnly[1].score) {
    return { row: hintOnly[0].r, confidence: 0.52 };
  }
  return null;
}

/**
 * เลือกคันจากหลายแถวเมื่อค้นด้วยเลขถังท้ายหรือ spec — ใช้คะแนน ทะเบียน+สเปค+ตัวถัง ร่วมกัน
 */
function pickCarFromCandidatesByTriple(
  rows: CarsPickRow[],
  contextRaw: string
): { row: CarsPickRow; confidence: number } | null {
  const valid = rows.filter((r) => r?.row_id);
  if (valid.length === 0) return null;

  const scored = valid.map((r) => ({
    r,
    triple: scoreLineAgainstCarTriple(contextRaw, r),
  }));
  scored.sort((a, b) => b.triple - a.triple);
  const best = scored[0];
  const second = scored[1];
  const t0 = best.triple;
  const t1 = second?.triple ?? 0;
  const delta = t0 - t1;

  if (valid.length === 1) {
    if (t0 >= 12) return { row: best.r, confidence: 0.66 };
    if (t0 >= 6) return { row: best.r, confidence: 0.6 };
    if (t0 >= 1) return { row: best.r, confidence: 0.54 };
    return null;
  }

  if (t0 >= 45 && delta >= 16) return { row: best.r, confidence: 0.74 };
  if (t0 >= 32 && delta >= 12) return { row: best.r, confidence: 0.68 };
  if (t0 >= 22 && delta >= 10) return { row: best.r, confidence: 0.64 };
  if (t0 >= 14 && delta >= 8) return { row: best.r, confidence: 0.6 };
  if (t0 > 0 && t1 === 0 && delta >= 6) return { row: best.r, confidence: 0.56 };
  if (t0 >= 8 && delta >= 4) return { row: best.r, confidence: 0.57 };
  if (t0 >= 6 && delta >= 2 && valid.length <= 12) return { row: best.r, confidence: 0.54 };
  if (t0 >= 4 && delta >= 1 && valid.length <= 6) return { row: best.r, confidence: 0.51 };
  if (t0 >= 3 && delta >= 1 && valid.length === 2) return { row: best.r, confidence: 0.5 };
  if (t0 >= 1 && delta >= 1 && valid.length === 2) return { row: best.r, confidence: 0.48 };
  return null;
}

function sanitizeIlikeToken(s: string): string {
  return s.replace(/[%_\\]/g, "").trim().slice(0, 56);
}

function parseNearestScoreFetchLimit(): number {
  const raw = process.env.LINE_INBOX_NEAREST_SCORE_FETCH_LIMIT?.trim();
  const n = raw ? parseInt(raw, 10) : 1200;
  if (!Number.isFinite(n)) return 1200;
  return Math.min(4000, Math.max(0, n));
}

/** มีป้าย / เลขถังที่ดึงได้ / หรือสเปกบรรทัดหัวยาวพอ — ถึงจะยอมรันการเทียบคะแนนทั้งคลัง */
function messageHasVehicleLookupSignals(raw: string): boolean {
  if (extractThaiPlateSearchStrings(raw).length > 0) return true;
  if (extractChassisSearchTokens(raw).length > 0) return true;
  const sn = extractLineVehicleSpecSnippet(raw).replace(/\s+/g, " ").trim();
  return sn.length >= 5;
}

/**
 * เมื่อค้นแบบ ilike/แถวเจาะจงไม่ได้ — ดึงรถในคลังตาม LIMIT แล้วให้คะแนน triple + ความครอบคลุมโทเค็น (~80% ใน DB)
 */
async function pickNearestCarByGlobalTripleScore(
  supabase: SupabaseClient,
  raw: string
): Promise<ResolvedCar | null> {
  const maxRows = parseNearestScoreFetchLimit();
  if (maxRows === 0 || !messageHasVehicleLookupSignals(raw)) return null;

  const collected: CarsPickRow[] = [];
  const page = 400;
  for (let from = 0; from < maxRows; from += page) {
    const to = Math.min(from + page - 1, maxRows - 1);
    if (from > to) break;
    const { data, error } = await supabase
      .from(CARS_TABLE)
      .select("row_id,plate_number,chassis_number,spec,brand,model")
      .order("updated_at", { ascending: false })
      .range(from, to);
    if (error || !data?.length) break;
    collected.push(...((data ?? []) as CarsPickRow[]).filter((r) => r?.row_id));
    if ((data as unknown[]).length < page) break;
  }
  if (collected.length === 0) return null;

  const scored = collected.map((r) => {
    const triple = scoreLineAgainstCarTriple(raw, r);
    const cov = tokenCoverage01AgainstCar(raw, r);
    const combined = triple + Math.round(cov * 78);
    return { r, triple, cov, combined };
  });
  scored.sort((a, b) => {
    if (b.combined !== a.combined) return b.combined - a.combined;
    return b.cov - a.cov;
  });

  const lineSnip = extractLineVehicleSpecSnippet(raw);

  for (let i = 0; i < scored.length; i++) {
    const best = scored[i];
    const second = scored[i + 1];
    const t0 = best.triple;
    const t1 = second?.triple ?? 0;
    const dTriple = t0 - t1;
    const c0 = best.cov;
    const c1 = second?.cov ?? 0;
    const dCov = c0 - c1;
    const dComb = best.combined - (second?.combined ?? 0);
    const dbSpec = String(best.r.spec ?? "").trim();

    /** ข้ามแถวที่ spec เป็นโน้ต — ยกเว้นมีคะแนน/ครอบคลุมสูง (ป้าย/ถัง/brand จับได้) */
    if (
      specLineVsDbSpecLooksMismatched(lineSnip, dbSpec) &&
      c0 < 0.46 &&
      t0 < 32
    ) {
      continue;
    }

    let accept = false;
    if (c0 >= 0.8 && dComb >= 2) accept = true;
    else if (c0 >= 0.55 && best.combined >= 28 && dComb >= 5) accept = true;
    else if (c0 >= 0.45 && best.combined >= 24 && dComb >= 6) accept = true;
    else if (t0 >= 14 && dTriple >= 5 && c0 >= 0.18) accept = true;
    else if (t0 >= 18 && dTriple >= 4) accept = true;
    else if (c0 >= 0.72 && dCov >= 0.08 && dComb >= 3) accept = true;

    if (!accept) continue;

    const conf = Math.min(
      0.56,
      Math.max(
        0.4,
        0.32 + best.combined / 130 + c0 * 0.14 + (t0 >= 25 ? 0.04 : 0)
      )
    );
    const row = best.r;
    return {
      car_row_id: String(row.row_id),
      plate_text: String(row.plate_number ?? "").trim(),
      chassis: String(row.chassis_number ?? "").trim(),
      spec: String(row.spec ?? "").trim(),
      confidence: Math.round(conf * 100) / 100,
    };
  }

  return null;
}

/**
 * แถว cars บางแถวไม่กรอก plate_number / chassis_number — UI จะโชว์ "—" ทั้งที่ข้อความ LINE มีป้าย/VIN
 * เติมจากข้อความต้นทางสำหรับการแสดงผลเท่านั้น (ไม่เปลี่ยน car_row_id)
 */
function enrichResolvedCarDisplayFromRaw(r: ResolvedCar, rawText: string): ResolvedCar {
  const raw = String(rawText ?? "");
  const lineSpecSnippet = extractLineVehicleSpecSnippet(raw).replace(/\s+/g, " ").trim().slice(0, 420);
  const dbSpecOriginal = String(r.spec ?? "").trim();

  const meta = { line_spec_snippet: lineSpecSnippet, db_spec: dbSpecOriginal } satisfies Partial<ResolvedCar>;

  const rowId = String(r.car_row_id ?? "").trim();
  if (!rowId) return { ...r, ...meta };

  const plates = extractThaiPlateSearchStrings(raw);
  const vins = extractChassisCandidates(raw);
  const plateOut = String(r.plate_text ?? "").trim() || plates[0] || "";
  const chassisOut = String(r.chassis ?? "").trim() || vins[0] || "";

  /** ช่วงสเปกหลังป้ายบนบรรทัดแรก — โชว์ตามแชท ไม่ให้เห็นแต่โน้ตภายใน DB ที่ไม่ตรงกับข้อความหัวข้อข้อความ LINE */
  let specOut = dbSpecOriginal;
  const lineSpec = lineSpecSnippet;
  if (lineSpec.length >= 8) {
    const snippetHead = lineSpec.slice(0, 40).toLowerCase().replace(/\s+/g, " ").trim();
    const dbFlat = specOut.toLowerCase().replace(/\s+/g, " ");
    const headCmp = snippetHead.slice(0, Math.min(20, snippetHead.length));
    if (!specOut) specOut = lineSpec;
    else if (headCmp.length >= 4 && !dbFlat.includes(headCmp)) specOut = lineSpec;
  } else if (!specOut && lineSpec.length >= 3) {
    specOut = lineSpec;
  }

  if (plateOut === r.plate_text && chassisOut === r.chassis && specOut === r.spec) return { ...r, ...meta };
  return { ...r, plate_text: plateOut, chassis: chassisOut, spec: specOut, ...meta };
}

/** จับคู่รถแบบ rule-based (ป้าย / เลขถัง / คำใบ้จาก spec) — ไม่เรียก LLM */
export async function resolveCarFromContextHeuristic(
  supabase: SupabaseClient,
  opts: {
    car_row_id?: string | null;
    car_id?: number | null;
    raw_text: string;
  }
): Promise<ResolvedCar> {
  const empty: ResolvedCar = { car_row_id: "", plate_text: "", chassis: "", spec: "", confidence: 0 };

  const rowIdIn = String(opts.car_row_id ?? "").trim();
  if (rowIdIn) {
    const { data } = await supabase
      .from(CARS_TABLE)
      .select("row_id,plate_number,chassis_number,spec")
      .eq("row_id", rowIdIn)
      .maybeSingle();
    if (data?.row_id) {
      return {
        car_row_id: String(data.row_id),
        plate_text: String(data.plate_number ?? "").trim(),
        chassis: String(data.chassis_number ?? "").trim(),
        spec: String((data as { spec?: unknown }).spec ?? "").trim(),
        confidence: 1,
      };
    }
  }

  const cid = opts.car_id;
  if (cid != null && Number.isFinite(Number(cid))) {
    const { data } = await supabase
      .from(CARS_TABLE)
      .select("row_id,plate_number,chassis_number,spec")
      .eq("id", cid)
      .maybeSingle();
    if (data?.row_id) {
      return {
        car_row_id: String(data.row_id),
        plate_text: String(data.plate_number ?? "").trim(),
        chassis: String(data.chassis_number ?? "").trim(),
        spec: String((data as { spec?: unknown }).spec ?? "").trim(),
        confidence: 0.95,
      };
    }
  }

  const raw = String(opts.raw_text ?? "");

  /** เลขถัง: VIN เต็ม / ท้ายถัง / ช่วงสั้น — ค้นหลายแถวแล้วตัดด้วยคะแนน ทะเบียน+สเปค+ตัวถัง */
  const chassisTokSeen = new Set<string>();
  for (const ch of extractChassisSearchTokens(raw)) {
    const flatNorm = ch.replace(/[-\s]/g, "").toUpperCase();
    if (flatNorm.length < 8) continue;
    if (chassisTokSeen.has(flatNorm)) continue;
    chassisTokSeen.add(flatNorm);

    const { data } = await supabase
      .from(CARS_TABLE)
      .select("row_id,plate_number,chassis_number,spec")
      .ilike("chassis_number", `%${flatNorm}%`)
      .limit(14);
    const rows = ((data ?? []) as CarsPickRow[]).filter((r) => r?.row_id);
    if (rows.length === 0) continue;

    if (rows.length === 1) {
      const t = scoreLineAgainstCarTriple(raw, rows[0]);
      if (t >= 1) {
        const r = rows[0];
        return {
          car_row_id: String(r.row_id),
          plate_text: String(r.plate_number ?? "").trim(),
          chassis: String(r.chassis_number ?? "").trim(),
          spec: String(r.spec ?? "").trim(),
          confidence:
            flatNorm.length >= 17 ? 0.87 : t >= 28 ? 0.82 : t >= 16 ? 0.76 : t >= 8 ? 0.7 : 0.64,
        };
      }
    }

    const picked = pickCarFromCandidatesByTriple(rows, raw);
    if (picked?.row?.row_id) {
      const r = picked.row;
      return {
        car_row_id: String(r.row_id),
        plate_text: String(r.plate_number ?? "").trim(),
        chassis: String(r.chassis_number ?? "").trim(),
        spec: String(r.spec ?? "").trim(),
        confidence: picked.confidence,
      };
    }
  }

  const plateCandidates = extractThaiPlateSearchStrings(raw);
  for (const cand of plateCandidates) {
    const orFilters = plateOrFilters(cand);
    if (!orFilters) continue;
    const { data } = await supabase
      .from(CARS_TABLE)
      .select("row_id,plate_number,chassis_number,spec")
      .or(orFilters)
      .limit(15);
    const rows = (data ?? []) as CarsPickRow[];
    const picked = pickCarFromPlateRows(rows, cand, raw);
    if (!picked?.row?.row_id) continue;
    const r = picked.row;
    return {
      car_row_id: String(r.row_id),
      plate_text: String(r.plate_number ?? "").trim(),
      chassis: String(r.chassis_number ?? "").trim(),
      spec: String(r.spec ?? "").trim(),
      confidence: picked.confidence,
    };
  }

  /** จับจากสเปคบรรทัดแรกเทียบ cars.spec (มีหรือไม่มีป้ายในข้อความก็ลองได้) */
  const headSpec = extractLineVehicleSpecSnippet(raw).replace(/\s+/g, " ").trim();
  if (headSpec.length >= 4) {
    const tryTokens = new Set<string>();
    for (const p of headSpec.split(/[\s,/|•]+/)) {
      const x = p.trim();
      if (x.length >= 4 && !/^[\d-]+$/.test(x)) tryTokens.add(sanitizeIlikeToken(x));
    }
    if (headSpec.length >= 8) tryTokens.add(sanitizeIlikeToken(headSpec.slice(0, 44)));
    for (const tok of tryTokens) {
      if (tok.length < 4) continue;
      const { data } = await supabase
        .from(CARS_TABLE)
        .select("row_id,plate_number,chassis_number,spec")
        .ilike("spec", `%${tok}%`)
        .limit(22);
      const rows = ((data ?? []) as CarsPickRow[]).filter((r) => r?.row_id);
      const picked = pickCarFromCandidatesByTriple(rows, raw);
      if (picked?.row?.row_id) {
        const r = picked.row;
        const lineSnip = extractLineVehicleSpecSnippet(raw);
        const dbs = String(r.spec ?? "").trim();
        const trip = scoreLineAgainstCarTriple(raw, r);
        const tcov = tokenCoverage01AgainstCar(raw, r);
        if (
          specLineVsDbSpecLooksMismatched(lineSnip, dbs) &&
          tcov < 0.44 &&
          trip < 30
        ) {
          continue;
        }
        return {
          car_row_id: String(r.row_id),
          plate_text: String(r.plate_number ?? "").trim(),
          chassis: String(r.chassis_number ?? "").trim(),
          spec: String(r.spec ?? "").trim(),
          confidence: Math.min(0.64, picked.confidence),
        };
      }
    }
  }

  const nearest = await pickNearestCarByGlobalTripleScore(supabase, raw);
  if (nearest?.car_row_id) return nearest;

  return empty;
}

function lineInboxLlmCarDisabled(): boolean {
  const a = process.env.LINE_INBOX_USE_LLM_FOR_CAR ?? process.env.LINE_INBOX_USE_GEMINI_FOR_CAR;
  return String(a ?? "").trim().toLowerCase() === "false";
}

function lineInboxCarLlmOrderRaw(): string {
  return String(process.env.LINE_INBOX_CAR_LLM_ORDER ?? "").trim().toLowerCase();
}

/** gemini_first = เรียก Gemini ก่อน แล้ว Groq fallback · groq_first = Groq ก่อน · *_only = ใช้ตัวนั้นตามชื่อเมื่อมี key */
function lineInboxCarLlmOrder(): "gemini_first" | "groq_first" {
  const raw = lineInboxCarLlmOrderRaw();
  if (
    raw === "groq_first" ||
    raw === "groq,gemini" ||
    raw === "groq" ||
    raw === "groq_only"
  ) {
    return "groq_first";
  }
  return "gemini_first";
}

function lineInboxCarLlmGroqOnly(): boolean {
  return lineInboxCarLlmOrderRaw() === "groq_only";
}

function lineInboxCarLlmGeminiOnly(): boolean {
  return lineInboxCarLlmOrderRaw() === "gemini_only";
}

function lineInboxBackoff(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** เมื่อ heuristic ชี้คันที่ cars.spec ไม่ใช่รุ่น/ไม่ตรงบรรทัดหัว — ล้าง car_row_id (ใช้ทั้งตอนไม่มี LLM) */
function clearIfHeuristicSpecMismatch(raw: string, base: ResolvedCar): ResolvedCar {
  const lineHeader = extractLineVehicleSpecSnippet(raw);
  const mis =
    String(base.car_row_id ?? "").trim().length > 0 &&
    specLineVsDbSpecLooksMismatched(lineHeader, String(base.spec ?? "").trim());
  if (!mis) return base;
  return {
    car_row_id: "",
    plate_text: "",
    chassis: "",
    spec: "",
    confidence: 0,
  };
}

/** ตัดผล LLM ที่เลือกคันที่ spec ใน DB ยังไม่สอดคล้องกับสเปกบรรทัดหัวในข้อความ */
function filterLlmPickByLineVsDbSpec(raw: string, pick: ResolvedCar | null): ResolvedCar | null {
  if (!pick?.car_row_id) return null;
  const line = extractLineVehicleSpecSnippet(raw);
  if (specLineVsDbSpecLooksMismatched(line, String(pick.spec ?? "").trim())) return null;
  return pick;
}

function carAiPayloadFromResolved(c: ResolvedCar | null): LineInboxCarAiModelPick {
  if (!c || !String(c.car_row_id ?? "").trim()) return null;
  return {
    car_row_id: String(c.car_row_id).trim(),
    plate_text: c.plate_text,
    chassis: c.chassis,
    spec: c.spec,
    confidence: Math.round((c.confidence ?? 0) * 100) / 100,
    ...(c.line_spec_snippet != null ? { line_spec_snippet: c.line_spec_snippet } : {}),
    ...(c.db_spec != null ? { db_spec: c.db_spec } : {}),
  };
}

/** เลือกคันที่ LLM เสนอ ตามลำดับ preferGroq เมื่อสองข้างตอบกลับมาแล้ว */
function choosePreferredLlmCar(
  dual: { groq: ResolvedCar | null; gemini: ResolvedCar | null },
  preferGroq: boolean
): ResolvedCar | null {
  const ok = (x: ResolvedCar | null): ResolvedCar | null =>
    x && String(x.car_row_id ?? "").trim() ? x : null;
  const gq = ok(dual.groq);
  const gm = ok(dual.gemini);
  if (preferGroq) return gq ?? gm;
  return gm ?? gq;
}

export type ResolveCarForAnalyzeResult = {
  resolved: ResolvedCar;
  /** มีเมื่อเข้าโหมดเลือกรถด้วย LLM และเรีย Groq/Gemini ได้อย่างน้อยครั้งหนึ่ง */
  car_ai_by_model?: LineInboxCarAiByModel;
};

/**
 * heuristic แล้ว (ถ้าไม่ได้ล็อกรถจาก row_id/car_id แน่ชัด) เสริมด้วย LLM (Gemini / Groq) — ลองสลับลำดับรุ่นหลายรอบก่อนยอมแพ้
 * · ปิด: LINE_INBOX_USE_LLM_FOR_CAR=false (หรือ LINE_INBOX_USE_GEMINI_FOR_CAR=false แบบเดิม)
 * · ลำดับ: LINE_INBOX_CAR_LLM_ORDER=gemini_first | groq_first (ค่าเริ่ม gemini_first)
 * · candidate pool: LINE_INBOX_AI_CANDIDATE_FETCH_LIMIT — ใช้ GROQ_API_KEY / GEMINI_API_KEY เหมือน flow แปล
 */
/** ผลจากวิเคราะห์ LINE inbox พร้อมผลเลือกรถของ Groq / Gemini （แค่รอบล่าสุดในแต่ละรุ่น） */
export async function resolveCarFromContextForAnalyze(
  supabase: SupabaseClient,
  opts: {
    car_row_id?: string | null;
    car_id?: number | null;
    raw_text: string;
  }
): Promise<ResolveCarForAnalyzeResult> {
  const raw = String(opts.raw_text ?? "");
  const base = await resolveCarFromContextHeuristic(supabase, opts);

  /* ผู้ใช้ระบุ row_id / car_id จาก UI ถูกเป้าในฐานแล้ว */
  if (base.confidence >= 0.95)
    return { resolved: enrichResolvedCarDisplayFromRaw(base, raw) };
  if (lineInboxLlmCarDisabled()) {
    return { resolved: enrichResolvedCarDisplayFromRaw(clearIfHeuristicSpecMismatch(raw, base), raw) };
  }

  const geminiKey = String(process.env.GEMINI_API_KEY ?? "").trim();
  const groqKey = String(process.env.GROQ_API_KEY ?? "").trim();
  if (!geminiKey && !groqKey) {
    return { resolved: enrichResolvedCarDisplayFromRaw(clearIfHeuristicSpecMismatch(raw, base), raw) };
  }

  const order = lineInboxCarLlmOrder();
  const groqOnly = lineInboxCarLlmGroqOnly();
  const geminiOnly = lineInboxCarLlmGeminiOnly();

  const tryGemini = async (): Promise<ResolvedCar | null> => {
    if (!geminiKey || groqOnly) return null;
    try {
      const { pickCarWithGemini } = await import("@/lib/line-inbox/resolve-car-gemini");
      return pickCarWithGemini(supabase, raw, geminiKey, base);
    } catch (e) {
      console.error("[line-inbox] Gemini car pick:", e instanceof Error ? e.message : e);
      return null;
    }
  };

  const tryGroq = async (): Promise<ResolvedCar | null> => {
    if (!groqKey || geminiOnly) return null;
    try {
      const { pickCarWithGroq } = await import("@/lib/line-inbox/resolve-car-groq");
      return pickCarWithGroq(supabase, raw, groqKey, base);
    } catch (e) {
      console.error("[line-inbox] Groq car pick:", e instanceof Error ? e.message : e);
      return null;
    }
  };

  const primaryGroqFirst = order === "groq_first";
  let pick: ResolvedCar | null = null;
  let dualLast = { groq: null as ResolvedCar | null, gemini: null as ResolvedCar | null };
  const maxRounds = 3;

  for (let round = 0; round < maxRounds; round++) {
    const preferGroq = round % 2 === 0 ? primaryGroqFirst : !primaryGroqFirst;
    const [gq, gm] = await Promise.all([tryGroq(), tryGemini()]);
    dualLast = {
      groq: filterLlmPickByLineVsDbSpec(raw, gq ?? null),
      gemini: filterLlmPickByLineVsDbSpec(raw, gm ?? null),
    };
    pick = choosePreferredLlmCar(dualLast, preferGroq);
    if (pick?.car_row_id) break;
    if (round < maxRounds - 1) await lineInboxBackoff(380 + round * 160);
  }

  const car_ai_by_model: LineInboxCarAiByModel = {
    groq: carAiPayloadFromResolved(
      dualLast.groq ? enrichResolvedCarDisplayFromRaw(dualLast.groq, raw) : null
    ),
    gemini: carAiPayloadFromResolved(
      dualLast.gemini ? enrichResolvedCarDisplayFromRaw(dualLast.gemini, raw) : null
    ),
  };

  const lineHeader = extractLineVehicleSpecSnippet(raw);
  const heuristicRuleMismatch =
    String(base.car_row_id ?? "").trim().length > 0 &&
    specLineVsDbSpecLooksMismatched(lineHeader, String(base.spec ?? "").trim());

  if (pick?.car_row_id) {
    return {
      resolved: enrichResolvedCarDisplayFromRaw(pick, raw),
      car_ai_by_model,
    };
  }
  if (heuristicRuleMismatch) {
    const cleared: ResolvedCar = {
      car_row_id: "",
      plate_text: "",
      chassis: "",
      spec: "",
      confidence: 0,
    };
    return {
      resolved: enrichResolvedCarDisplayFromRaw(cleared, raw),
      car_ai_by_model,
    };
  }
  return {
    resolved: enrichResolvedCarDisplayFromRaw(base, raw),
    car_ai_by_model,
  };
}

export async function resolveCarFromContext(
  supabase: SupabaseClient,
  opts: {
    car_row_id?: string | null;
    car_id?: number | null;
    raw_text: string;
  }
): Promise<ResolvedCar> {
  const x = await resolveCarFromContextForAnalyze(supabase, opts);
  return x.resolved;
}
