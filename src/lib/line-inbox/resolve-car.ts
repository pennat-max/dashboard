import type { SupabaseClient } from "@supabase/supabase-js";
import { splitLineTextForInbox } from "@/lib/line-inbox/split-line-text";

const CARS_TABLE = process.env.NEXT_PUBLIC_SUPABASE_CARS_TABLE ?? "cars";
const CAR_MATCH_SELECT = [
  "id",
  "row_id",
  "plate_number",
  "chassis_number",
  "spec",
  "brand",
  "model",
  "model_year",
  "c_year",
  "color",
  "sale_support",
].join(",");

export type ResolvedCar = {
  car_row_id: string;
  plate_text: string;
  chassis: string;
  confidence: number;
  spec_text?: string;
  sale?: string;
  candidate_count?: number;
};

type CarMatchRow = {
  id?: unknown;
  row_id?: unknown;
  plate_number?: unknown;
  chassis_number?: unknown;
  spec?: unknown;
  brand?: unknown;
  model?: unknown;
  model_year?: unknown;
  c_year?: unknown;
  color?: unknown;
  sale_support?: unknown;
};

const STOCK_NUMBER_RE = /\b\d{4,6}\b/g;
const THAI_PLATE_RE = /\d{0,2}[ก-ฮ]{1,3}[-\s]?\d{2,4}/g;
const VEHICLE_TOKEN_RE =
  /\b(?:TOYOTA|NISSAN|NAVARA|ISUZU|MAZDA|MITSUBISHI|FORD|HONDA|REVO|FORTUNER|HILUX|VIGO|RANGER|D-?MAX|DMAX|TRITON|CAMRY|ALTIS|YARIS|VIOS|MU-?X|EVEREST|PAJERO|PRO-?4X|RAPTOR|D-?CAB|DOUBLE|SMART|CAB|DC|2WD|4WD|AT|MT|7AT|6AT|STANDARD|WHITE|BLACK|GRAY|GREY|SILVER|BLUE|RED|GREEN|ORANGE|BRONZE|BROWN|GOLD|PEARL)\b/gi;
const COMMON_TOKEN_RE = /^(?:THE|AND|FOR|WITH|CAR|AUTO|ป้ายแดง)$/i;

function safeString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9ก-ฮ]+/g, "");
}

function likeToken(value: string): string {
  return value.replace(/[%*,()]/g, "").trim();
}

function carHaystack(row: CarMatchRow): string {
  return [
    row.id,
    row.row_id,
    row.plate_number,
    row.chassis_number,
    row.spec,
    row.brand,
    row.model,
    row.model_year,
    row.c_year,
    row.color,
    row.sale_support,
  ]
    .map(safeString)
    .filter(Boolean)
    .join(" ");
}

function extractStockNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(STOCK_NUMBER_RE)) {
    const token = m[0];
    if (/^(?:19|20)\d{2}$/.test(token)) continue;
    if (!out.includes(token)) out.push(token);
  }
  return out.slice(0, 5);
}

function extractVehicleTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(VEHICLE_TOKEN_RE)) {
    const token = likeToken(m[0]).toUpperCase();
    if (!token || COMMON_TOKEN_RE.test(token) || out.includes(token)) continue;
    out.push(token);
  }
  for (const m of text.matchAll(/\b[123]\.\d\b/g)) {
    const token = m[0];
    if (!out.includes(token)) out.push(token);
  }
  for (const m of text.matchAll(/\b(?:19|20)\d{2}\b/g)) {
    const token = m[0];
    if (!out.includes(token)) out.push(token);
  }
  return out.slice(0, 10);
}

function scoreCandidate(row: CarMatchRow, contextLine: string): number {
  const haystack = normalizeSearch(carHaystack(row));
  const rawHaystack = carHaystack(row).toLowerCase();
  let score = 0;

  for (const stock of extractStockNumbers(contextLine)) {
    if (haystack.includes(normalizeSearch(stock))) score += 5;
  }

  for (const token of extractVehicleTokens(contextLine)) {
    const normalized = normalizeSearch(token);
    if (!normalized) continue;
    if (!haystack.includes(normalized)) continue;
    VEHICLE_TOKEN_RE.lastIndex = 0;
    const isVehicleToken = VEHICLE_TOKEN_RE.test(token);
    VEHICLE_TOKEN_RE.lastIndex = 0;
    score += isVehicleToken ? 1.4 : 1;
  }

  const contextPlate = contextLine.match(THAI_PLATE_RE)?.[0]?.replace(/\s+/g, "") ?? "";
  THAI_PLATE_RE.lastIndex = 0;
  if (contextPlate && haystack.includes(normalizeSearch(contextPlate))) score += 4;

  for (const chassis of extractChassisCandidates(contextLine)) {
    if (haystack.includes(normalizeSearch(chassis))) score += 5;
  }

  if (/ป้ายแดง/i.test(contextLine) && /(ป้ายแดง|red\s*plate)/i.test(rawHaystack)) score += 1;
  return Math.round(score * 10) / 10;
}

async function queryCarCandidates(
  supabase: SupabaseClient,
  orParts: string[],
  limit = 40
): Promise<CarMatchRow[]> {
  if (orParts.length === 0) return [];
  const { data, error } = await supabase
    .from(CARS_TABLE)
    .select(CAR_MATCH_SELECT)
    .or(orParts.join(","))
    .limit(limit);
  if (error) return [];
  return (data ?? []) as CarMatchRow[];
}

function chooseScoredCandidate(rows: CarMatchRow[], contextLine: string): ResolvedCar | null {
  const scored = rows
    .map((row) => ({ row, score: scoreCandidate(row, contextLine) }))
    .filter((entry) => entry.score >= 4)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  const top = scored[0];
  const next = scored[1];
  const uniqueEnough = !next || top.score - next.score >= 1.5;
  if (!uniqueEnough) {
    return {
      car_row_id: "",
      plate_text: "",
      chassis: "",
      confidence: 0.45,
      candidate_count: scored.length,
    };
  }

  const row = top.row;
  const confidence = Math.min(0.88, 0.5 + top.score / 12);
  return resolvedFromRow(row, confidence, scored.length);
}

function resolvedFromRow(row: CarMatchRow, confidence: number, candidateCount?: number): ResolvedCar {
  return {
    car_row_id: safeString(row.row_id),
    plate_text: safeString(row.plate_number),
    chassis: safeString(row.chassis_number),
    confidence,
    spec_text: safeString(row.spec),
    sale: safeString(row.sale_support),
    candidate_count: candidateCount,
  };
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

export async function resolveCarFromContext(
  supabase: SupabaseClient,
  opts: {
    car_row_id?: string | null;
    car_id?: number | null;
    raw_text: string;
  }
): Promise<ResolvedCar> {
  const empty: ResolvedCar = { car_row_id: "", plate_text: "", chassis: "", confidence: 0 };

  const rowIdIn = String(opts.car_row_id ?? "").trim();
  if (rowIdIn) {
    const { data } = await supabase
      .from(CARS_TABLE)
      .select(CAR_MATCH_SELECT)
      .eq("row_id", rowIdIn)
      .maybeSingle();
    const row = data as CarMatchRow | null;
    if (row?.row_id) {
      return resolvedFromRow(row, 1);
    }
  }

  const cid = opts.car_id;
  if (cid != null && Number.isFinite(Number(cid))) {
    const { data } = await supabase
      .from(CARS_TABLE)
      .select(CAR_MATCH_SELECT)
      .eq("id", cid)
      .maybeSingle();
    const row = data as CarMatchRow | null;
    if (row?.row_id) {
      return resolvedFromRow(row, 0.95);
    }
  }

  const raw = String(opts.raw_text ?? "");
  const chassisList = extractChassisCandidates(raw);
  for (const ch of chassisList) {
    const { data } = await supabase
      .from(CARS_TABLE)
      .select(CAR_MATCH_SELECT)
      .ilike("chassis_number", `%${ch}%`)
      .limit(2);
    const rows = data ?? [];
    const row = rows[0] as CarMatchRow | undefined;
    if (rows.length === 1 && row?.row_id) {
      return resolvedFromRow(row, 0.85);
    }
  }

  const plateMatch = raw.match(/[ก-ฮ]{1,3}[-\s]?\d{1,4}/);
  if (plateMatch) {
    const compact = plateMatch[0].replace(/\s+/g, "");
    const { data } = await supabase
      .from(CARS_TABLE)
      .select(CAR_MATCH_SELECT)
      .or(`plate_number.ilike.%${compact}%,plate_number.ilike.%${plateMatch[0]}%`)
      .limit(5);
    const rows = data ?? [];
    const row = rows[0] as CarMatchRow | undefined;
    if (rows.length === 1 && row?.row_id) {
      return resolvedFromRow(row, 0.55);
    }
  }

  const split = splitLineTextForInbox(raw);
  const contextLines = split.ignored_vehicle_spec_lines.length
    ? split.ignored_vehicle_spec_lines
    : raw
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);

  for (const line of contextLines.slice(0, 8)) {
    const stocks = extractStockNumbers(line);
    const stockOrParts = stocks.flatMap((stock) => [
      `spec.ilike.%${likeToken(stock)}%`,
      `row_id.ilike.%${likeToken(stock)}%`,
      `plate_number.ilike.%${likeToken(stock)}%`,
      `chassis_number.ilike.%${likeToken(stock)}%`,
    ]);
    const byStock = await queryCarCandidates(supabase, stockOrParts, 20);
    const stockMatch = chooseScoredCandidate(byStock, line);
    if (stockMatch && (stockMatch.car_row_id || (stockMatch.candidate_count ?? 0) > 1)) {
      return stockMatch;
    }

    const tokens = extractVehicleTokens(line).map(likeToken).filter(Boolean);
    const tokenOrParts = tokens.slice(0, 8).flatMap((token) => {
      const expanded = token.toUpperCase() === "GREY" ? [token, "GRAY"] : token.toUpperCase() === "GRAY" ? [token, "GREY"] : [token];
      return expanded.flatMap((t) => [
        `spec.ilike.%${t}%`,
        `brand.ilike.%${t}%`,
        `model.ilike.%${t}%`,
        `model_year.ilike.%${t}%`,
        `c_year.ilike.%${t}%`,
        `color.ilike.%${t}%`,
      ]);
    });
    const bySpec = await queryCarCandidates(supabase, tokenOrParts, 50);
    const specMatch = chooseScoredCandidate(bySpec, line);
    if (specMatch && (specMatch.car_row_id || (specMatch.candidate_count ?? 0) > 1)) {
      return specMatch;
    }
  }

  return empty;
}
