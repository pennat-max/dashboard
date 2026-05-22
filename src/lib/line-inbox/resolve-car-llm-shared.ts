import type { SupabaseClient } from "@supabase/supabase-js";
import {
  carsMatchingQuery,
  parseUrgentLinePaste,
  suggestSearchQueryFromVehicleLine,
} from "@/lib/orders/urgent-line-intake";
import type { Car } from "@/types/car";
import {
  extractChassisSearchTokens,
  extractLineVehicleSpecSnippet,
  extractThaiPlateSearchStrings,
  scoreLineAgainstCarTriple,
  specLineVsDbSpecLooksMismatched,
  type ResolvedCar,
} from "@/lib/line-inbox/resolve-car";

export const LINE_INBOX_CARS_TABLE = process.env.NEXT_PUBLIC_SUPABASE_CARS_TABLE ?? "cars";

export function parseCandidateFetchLimit(): number {
  const raw = process.env.LINE_INBOX_AI_CANDIDATE_FETCH_LIMIT?.trim();
  const n = raw ? parseInt(raw, 10) : 2000;
  if (!Number.isFinite(n) || n < 100) return 2000;
  return Math.min(5000, n);
}

function rowToLeanCar(r: Record<string, unknown>): Car {
  const idRaw = r.id;
  const id =
    typeof idRaw === "number" && Number.isFinite(idRaw)
      ? idRaw
      : Number.isFinite(Number(idRaw))
        ? Number(idRaw)
        : idRaw;
  return {
    id,
    row_id: r.row_id != null ? String(r.row_id) : null,
    plate_number: String(r.plate_number ?? ""),
    chassis_number: String(r.chassis_number ?? ""),
    spec: String(r.spec ?? ""),
    brand: String(r.brand ?? ""),
    model: String(r.model ?? ""),
  } as Car;
}

export async function fetchLeanCarsForLlmCandidates(supabase: SupabaseClient): Promise<Car[]> {
  const max = parseCandidateFetchLimit();
  const select = "id,row_id,plate_number,chassis_number,spec,brand,model,updated_at";
  const all: Car[] = [];
  for (let from = 0; from < max; from += 1000) {
    const pageSize = Math.min(1000, max - from);
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from(LINE_INBOX_CARS_TABLE)
      .select(select)
      .order("updated_at", { ascending: false })
      .range(from, to);
    if (error || !data?.length) break;
    for (const row of data as Record<string, unknown>[]) {
      all.push(rowToLeanCar(row));
    }
    if ((data as unknown[]).length < pageSize) break;
  }
  return all;
}

export function expandLineInboxLlmCandidates(allCars: Car[], raw: string): Car[] {
  const slice = raw.slice(0, 12_000);
  const qs: string[] = [];
  qs.push(...extractThaiPlateSearchStrings(slice));
  for (const ch of extractChassisSearchTokens(slice).slice(0, 5)) {
    qs.push(ch.slice(-14));
  }
  const specSnip = extractLineVehicleSpecSnippet(slice);
  for (const w of specSnip
    .split(/[\s,/|•]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 4)) {
    qs.push(w.slice(0, 80));
  }
  const parsed = parseUrgentLinePaste(slice);
  qs.push(suggestSearchQueryFromVehicleLine(parsed.vehicleLine));
  const vl = parsed.vehicleLine.trim();
  if (vl) qs.push(vl.slice(0, 96));
  const firstLine = slice.split(/\r?\n/).find((l) => l.trim())?.trim();
  if (firstLine) qs.push(firstLine.slice(0, 96));

  const seen = new Set<string>();
  const bucket: Car[] = [];
  const push = (c: Car) => {
    const k = String(c.row_id ?? c.id ?? "");
    if (!k || seen.has(k)) return;
    seen.add(k);
    bucket.push(c);
  };

  for (const q of qs) {
    const qn = q.trim();
    if (!qn) continue;
    for (const c of carsMatchingQuery(allCars, qn)) {
      push(c);
      if (bucket.length >= 48) break;
    }
    if (bucket.length >= 48) break;
  }

  if (bucket.length < 48) {
    for (const c of carsMatchingQuery(allCars, slice.slice(0, 200))) {
      push(c);
      if (bucket.length >= 48) break;
    }
  }

  if (bucket.length === 0 && allCars.length > 0) {
    const ranked = [...allCars].sort(
      (a, b) => scoreLineAgainstCarTriple(slice, b) - scoreLineAgainstCarTriple(slice, a)
    );
    for (const c of ranked.slice(0, 28)) {
      push(c);
    }
  }

  /** จัดคิวผู้สมัคร: ให้คันที่ป้าย/สเปกบนบรรทัดแรก/เลขตัวถังตรงกับใน DB — อยู่ก่อนในรายการ */
  bucket.sort((a, b) => scoreLineAgainstCarTriple(slice, b) - scoreLineAgainstCarTriple(slice, a));
  return bucket.slice(0, 18);
}

export type CarLlmPickRaw = {
  chosen_car_row_id?: unknown;
  match_confidence?: unknown;
};

export function parseCarLlmPickJson(text: string): { chosen_car_row_id: string | null; match_confidence: number } | null {
  try {
    const o = JSON.parse(text.trim()) as CarLlmPickRaw;
    if (!o || typeof o !== "object") return null;
    const id = String(o.chosen_car_row_id ?? "").trim();
    const c = Number(o.match_confidence);
    const match_confidence = Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0.55;
    return { chosen_car_row_id: id || null, match_confidence };
  } catch {
    return null;
  }
}

export function candidatesToLlmPayload(candidates: Car[]) {
  return candidates.map((c) => ({
    row_id: String(c.row_id ?? "").trim(),
    plate: String(c.plate_number ?? "").trim(),
    chassis_tail: String(c.chassis_number ?? "")
      .trim()
      .slice(-8),
    spec: String(c.spec ?? "")
      .trim()
      .slice(0, 160),
    brand_model: `${String(c.brand ?? "").trim()} ${String(c.model ?? "").trim()}`.trim().slice(0, 80),
  }));
}

export const CAR_LLM_SYSTEM_PROMPT_TH = `คุณจับคู่ข้อความ LINE (งานซ่อม/แต่งรถในไทย) กับรถคันหนึ่งใน candidates เท่านั้น

กติกา:
- เลือก chosen_car_row_id จากฟิลด์ row_id ในรายการ candidates เท่านั้น — ห้ามเดารหัสนอกจากนี้
- ถ้าไม่มั่นใจว่าเป็นคันไหนจริง ให้เลือก null
- ข้อความในกลุ่มปกติผู้ใช้เทียบ ๓ อย่างกับรถในฐาน: (1) ทะเบียน ↔ plate_number (2) สเปก/รุ่น ↔ spec (3) เลขตัวถัง/VIN ↔ chassis_number — ให้ชั่งน้ำหนักทั้งสามพร้อมกัน แม้ผู้ใช้จะใส่มาแค่ป้าย แค่สเปค หรือแค่ท้ายเลขถัง (หามาตรงกับทุกช่องที่มีในข้อความ)
- ถ้า heuristic_spec_vs_line_mismatch ใน JSON ผู้ใช้เป็น true แปลว่ารถที่ rule เดามาก่อนอาจผิด — ฟิลด์ spec ใน cars อาจเป็นโน้ตภายใน ไม่ใช่รุ่นรถ; อย่ายึด heuristic_guess (อาจถูกปิดเป็น null แล้ว) ต้องดู vehicle_header_spec_snippet / ป้าย / VIN ว่าตรงกับ plate_number / spec / chassis_number ของ candidate ใดจริง ถ้าไม่มีคันที่สมเหตุสมผลให้ chosen_car_row_id เป็น null
- candidates เรียงเบื้องต้นให้คันที่เข้ากับการเทียบสามอย่างมากอยู่ก่อนแล้ว แต่ยังต้องตัดสินใจจากข้อความเต็ม
- focus ที่บรรทัดที่มีป้าย+สเปกรถ; อย่างอื่นปะปนเช่น @mention — อย่านำไปเดาว่ารถอย่างอื่น

ตอบเป็น JSON เดียว: {"chosen_car_row_id": string|null, "match_confidence": number ระหว่าง 0 และ 1}`;

export function buildCarLlmUserPayload(raw: string, heuristicGuess: ResolvedCar, candidates: Car[]) {
  const trimmed = raw.slice(0, 8000);
  const vehicleHeader = extractLineVehicleSpecSnippet(trimmed).slice(0, 280);
  const dbSpecFromHeuristic = String(heuristicGuess.spec ?? "").trim();
  const heuristicMismatch = specLineVsDbSpecLooksMismatched(vehicleHeader, dbSpecFromHeuristic);

  return {
    noisy_line_message: trimmed,
    vehicle_header_spec_snippet: vehicleHeader,
    heuristic_spec_db_from_rule_pick: dbSpecFromHeuristic.slice(0, 200),
    heuristic_spec_vs_line_mismatch: heuristicMismatch,
    heuristic_guess:
      !heuristicMismatch && heuristicGuess.car_row_id.trim().length > 0
        ? {
            car_row_id: heuristicGuess.car_row_id,
            plate_text: heuristicGuess.plate_text,
            confidence: heuristicGuess.confidence,
          }
        : null,
    candidates: candidatesToLlmPayload(candidates),
  };
}

export async function hydrateCarPickFromRowId(
  supabase: SupabaseClient,
  rowId: string,
  allowed: Set<string>,
  matchConfidence: number
): Promise<ResolvedCar | null> {
  if (!rowId || !allowed.has(rowId)) return null;
  const { data } = await supabase
    .from(LINE_INBOX_CARS_TABLE)
    .select("row_id,plate_number,chassis_number,spec")
    .eq("row_id", rowId)
    .maybeSingle();
  if (!data?.row_id) return null;
  const blended = Math.min(0.92, Math.max(0.44, matchConfidence * 0.88 + 0.08));
  return {
    car_row_id: String(data.row_id),
    plate_text: String(data.plate_number ?? "").trim(),
    chassis: String(data.chassis_number ?? "").trim(),
    spec: String((data as { spec?: unknown }).spec ?? "").trim(),
    confidence: Math.round(blended * 100) / 100,
  };
}
