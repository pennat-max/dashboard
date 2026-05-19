import type { SupabaseClient } from "@supabase/supabase-js";

const CARS_TABLE = process.env.NEXT_PUBLIC_SUPABASE_CARS_TABLE ?? "cars";

type CarLookupRow = {
  row_id?: unknown;
  id?: unknown;
  plate_number?: unknown;
  chassis_number?: unknown;
};

export type ResolvedCarCandidate = {
  car_row_id: string;
  plate_text: string;
  chassis: string;
  confidence: number;
  reason: string;
};

export type ResolvedCar = {
  car_row_id: string;
  plate_text: string;
  chassis: string;
  confidence: number;
  candidate_cars?: ResolvedCarCandidate[];
};

export function extractChassisCandidates(text: string): string[] {
  const out: string[] = [];
  const re = /\b([A-HJ-NPR-Z0-9]{17})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(normalizeChassis(m[1]));
  }
  return Array.from(new Set(out));
}

function normalizeChassis(value: string): string {
  return String(value ?? "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
}

function normalizePlate(value: string): string {
  return String(value ?? "")
    .replace(/[^0-9A-Za-zก-ฮ]/g, "")
    .toUpperCase();
}

function plateDigits(value: string): string {
  return String(value ?? "").replace(/\D/g, "");
}

function extractRowIdCandidates(text: string): string[] {
  const out = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi) ?? [];
  return Array.from(new Set(out.map((v) => v.toLowerCase())));
}

function extractPlateCandidates(text: string): string[] {
  const out: string[] = [];
  const re = /(?:\d{0,2}\s*)?[ก-ฮ]{1,3}[-\s]?\d{1,4}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0].replace(/\s+/g, "").trim();
    if (raw) out.push(raw);
  }
  return Array.from(new Set(out));
}

function toCandidate(row: CarLookupRow, confidence: number, reason: string): ResolvedCarCandidate | null {
  const carRowId = String(row.row_id ?? "").trim();
  if (!carRowId) return null;
  return {
    car_row_id: carRowId,
    plate_text: String(row.plate_number ?? "").trim(),
    chassis: String(row.chassis_number ?? "").trim(),
    confidence,
    reason,
  };
}

function resolveFromCandidate(candidate: ResolvedCarCandidate): ResolvedCar {
  return {
    car_row_id: candidate.car_row_id,
    plate_text: candidate.plate_text,
    chassis: candidate.chassis,
    confidence: candidate.confidence,
  };
}

function emptyWithCandidates(candidate_cars: ResolvedCarCandidate[] = []): ResolvedCar {
  return {
    car_row_id: "",
    plate_text: "",
    chassis: "",
    confidence: candidate_cars.length > 0 ? Math.max(...candidate_cars.map((c) => c.confidence), 0) : 0,
    candidate_cars,
  };
}

function dedupeCandidates(candidates: ResolvedCarCandidate[]): ResolvedCarCandidate[] {
  const seen = new Set<string>();
  const out: ResolvedCarCandidate[] = [];
  for (const c of candidates) {
    const key = c.car_row_id || `${normalizePlate(c.plate_text)}:${normalizeChassis(c.chassis)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

async function fetchByRowId(supabase: SupabaseClient, rowId: string): Promise<ResolvedCar | null> {
  const { data } = await supabase
    .from(CARS_TABLE)
    .select("row_id,plate_number,chassis_number")
    .eq("row_id", rowId)
    .maybeSingle();

  const candidate = data ? toCandidate(data as CarLookupRow, 1, "row_id exact match") : null;
  return candidate ? resolveFromCandidate(candidate) : null;
}

export async function resolveCarFromContext(
  supabase: SupabaseClient,
  opts: {
    car_row_id?: string | null;
    car_id?: number | null;
    raw_text: string;
  }
): Promise<ResolvedCar> {
  const raw = String(opts.raw_text ?? "");

  const rowIdIn = String(opts.car_row_id ?? "").trim();
  if (rowIdIn) {
    const byHint = await fetchByRowId(supabase, rowIdIn);
    if (byHint) return byHint;
  }

  for (const rowId of extractRowIdCandidates(raw)) {
    const byRaw = await fetchByRowId(supabase, rowId);
    if (byRaw) return byRaw;
  }

  const cid = opts.car_id;
  if (cid != null && Number.isFinite(Number(cid))) {
    const { data } = await supabase
      .from(CARS_TABLE)
      .select("row_id,plate_number,chassis_number")
      .eq("id", cid)
      .maybeSingle();
    const candidate = data ? toCandidate(data as CarLookupRow, 0.95, "car id exact match") : null;
    if (candidate) return resolveFromCandidate(candidate);
  }

  const chassisList = extractChassisCandidates(raw);
  for (const ch of chassisList) {
    const { data } = await supabase
      .from(CARS_TABLE)
      .select("row_id,plate_number,chassis_number")
      .ilike("chassis_number", `%${ch}%`)
      .limit(5);
    const rows = (data ?? []) as CarLookupRow[];
    const exact = rows.filter((r) => normalizeChassis(String(r.chassis_number ?? "")) === ch);
    const exactCandidates = dedupeCandidates(
      exact.map((r) => toCandidate(r, 0.98, "chassis exact match")).filter(Boolean) as ResolvedCarCandidate[]
    );
    if (exactCandidates.length === 1) return resolveFromCandidate(exactCandidates[0]);
    if (exactCandidates.length > 1) return emptyWithCandidates(exactCandidates);

    const nearCandidates = dedupeCandidates(
      rows.map((r) => toCandidate(r, 0.88, "chassis partial match")).filter(Boolean) as ResolvedCarCandidate[]
    );
    if (nearCandidates.length === 1) return resolveFromCandidate(nearCandidates[0]);
    if (nearCandidates.length > 1) return emptyWithCandidates(nearCandidates);
  }

  const plateCandidates = extractPlateCandidates(raw);
  for (const plate of plateCandidates) {
    const normalizedInput = normalizePlate(plate);
    const digits = plateDigits(plate);
    if (!normalizedInput || !digits) continue;

    const { data } = await supabase
      .from(CARS_TABLE)
      .select("row_id,plate_number,chassis_number")
      .or(`plate_number.ilike.%${plate}%,plate_number.ilike.%${normalizedInput}%,plate_number.ilike.%${digits}%`)
      .limit(12);
    const rows = (data ?? []) as CarLookupRow[];

    const exact = rows.filter((r) => normalizePlate(String(r.plate_number ?? "")) === normalizedInput);
    const exactCandidates = dedupeCandidates(
      exact.map((r) => toCandidate(r, 0.92, "plate exact normalized match")).filter(Boolean) as ResolvedCarCandidate[]
    );
    if (exactCandidates.length === 1) return resolveFromCandidate(exactCandidates[0]);
    if (exactCandidates.length > 1) return emptyWithCandidates(exactCandidates);

    const digitMatches = rows.filter((r) => {
      const rowDigits = plateDigits(String(r.plate_number ?? ""));
      return rowDigits.length >= 3 && rowDigits === digits;
    });
    const digitCandidates = dedupeCandidates(
      digitMatches.map((r) => toCandidate(r, 0.72, "plate digits match")).filter(Boolean) as ResolvedCarCandidate[]
    );
    if (digitCandidates.length === 1) return resolveFromCandidate(digitCandidates[0]);
    if (digitCandidates.length > 1) return emptyWithCandidates(digitCandidates);
  }

  return emptyWithCandidates();
}
