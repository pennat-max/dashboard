import type { SupabaseClient } from "@supabase/supabase-js";
import { splitLineTextForInbox } from "@/lib/line-inbox/split-line-text";
import type { LineInboxCarCandidate, LineInboxMatchedCarCandidate } from "@/lib/line-inbox/types";

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
  extractedCarCandidates?: LineInboxCarCandidate[];
  matchedCarCandidates?: LineInboxMatchedCarCandidate[];
  aiTargetCarReference?: string;
  aiTargetCarConfidence?: string;
  matchReason?: string;
};

export type CarMatchRow = {
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
const THAI_PLATE_RE = /(?<![\u0E00-\u0E7F])\d{0,2}[\u0E01-\u0E2E]{1,3}[-\s]?\d{2,4}/g;
const THAI_STOCK_IDENTITY_RE =
  /^(?:ทะเบียน|เลขทะเบียน|stock|สต็อก|สต๊อก|ref|reference)\s*[:#：-]?\s*(\d{4,6})\b/i;
const VEHICLE_TOKEN_RE =
  /\b(?:TOYOTA|NISSAN|NAVARA|ISUZU|MAZDA|MITSUBISHI|FORD|HONDA|REVO|FORTUNER|HILUX|VIGO|RANGER|D-?MAX|DMAX|TRITON|CAMRY|ALTIS|YARIS|VIOS|MU-?X|EVEREST|PAJERO|PRO-?4X|RAPTOR|TRAVO|COMMUTER|OVERLAND|4TREX|HIGHT|HIGH|D-?CAB|DOUBLE|SMART|CAB|VAN|DC|2WD|4WD|AT|MT|7AT|6AT|STANDARD|WHITE|BLACK|GRAY|GREY|SILVER|BLUE|RED|GREEN|ORANGE|BRONZE|BROWN|GOLD|PEARL)\b/gi;
const COMMON_TOKEN_RE = /^(?:THE|AND|FOR|WITH|CAR|AUTO|ป้ายแดง)$/i;

function safeString(value: unknown): string {
  return String(value ?? "").trim();
}

export function lineInboxPlateNumericSuffix(value: unknown): string {
  const clean = safeString(value).replace(/\s+/g, "");
  if (!clean) return "";
  const thaiPlate = clean.match(/\d{0,2}[\u0E01-\u0E2E]{1,3}[-\s]?(\d{2,4})$/);
  if (thaiPlate?.[1]) return thaiPlate[1];
  const dashParts = clean.split("-").map((part) => part.trim()).filter(Boolean);
  const lastPart = dashParts[dashParts.length - 1] ?? "";
  if (/^\d{2,6}$/.test(lastPart)) return lastPart;
  const trailingDigits = clean.match(/(\d{2,6})$/);
  return trailingDigits?.[1] ?? "";
}

function normalizeSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9ก-ฮ]+/g, "");
}

function likeToken(value: string): string {
  return value.replace(/[%*,()]/g, "").trim();
}

export function lineInboxHasSafeNumericRefToken(value: unknown, ref: string): boolean {
  const token = normalizeSearch(ref);
  if (!/^\d{2,6}$/.test(token)) return false;
  const text = safeString(value);
  if (!text) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9A-Za-z\\u0E00-\\u0E7F])${escaped}($|[^0-9A-Za-z\\u0E00-\\u0E7F])`).test(text);
}

function isMileageNumberContext(text: string, index: number, token: string): boolean {
  const before = text.slice(Math.max(0, index - 24), index);
  const after = text.slice(index + token.length, index + token.length + 24);
  if (/(?:mileage|odo|odometer)\s*$/i.test(before)) return true;
  if (/(?:\u0e01\u0e23\u0e2d\s*\u0e44\u0e21\u0e25\u0e4c|\u0e40\u0e25\u0e02\s*\u0e44\u0e21\u0e25\u0e4c|\u0e44\u0e21\u0e25\u0e4c)\s*$/i.test(before)) {
    return true;
  }
  return /^\s*[\).,]*\s*(?:km|kms|\u0e01\u0e21\.?|\u0e01\u0e34\u0e42\u0e25(?:\u0e40\u0e21\u0e15\u0e23)?)/i.test(after);
}

export function extractLineInboxMileageCarReference(line: string): string {
  const clean = safeString(line).replace(/\s+/g, " ");
  const thaiPlate = clean.match(/^\s*(\d{0,2}[\u0E01-\u0E2E]{1,3}[-\s]?\d{2,4})\s*(?:[-\u2013\u2014:]|\s)\s*(?:\d{2,3}(?:,\d{3})|\d{4,6})\s*(?:km|kms|\u0e01\u0e21\.?|\u0e01\u0e34\u0e42\u0e25)/i);
  if (thaiPlate?.[1]) return safeString(thaiPlate[1]);
  const numeric = clean.match(/^\s*(\d{4,6})\s*(?:[-\u2013\u2014:]|\s)\s*(?:\d{2,3}(?:,\d{3})|\d{4,6})\s*(?:km|kms|\u0e01\u0e21\.?|\u0e01\u0e34\u0e42\u0e25)/i);
  return safeString(numeric?.[1]);
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

export function extractStockNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(STOCK_NUMBER_RE)) {
    const token = m[0];
    if (isMileageNumberContext(text, m.index ?? 0, token)) continue;
    if (/^(?:19|20)\d{2}$/.test(token)) continue;
    if (!out.includes(token)) out.push(token);
  }
  return out.slice(0, 5);
}

function extractThaiStockIdentity(line: string): string | null {
  const m = String(line ?? "").trim().match(THAI_STOCK_IDENTITY_RE);
  return m?.[1] ?? null;
}

function extractThaiPlateSearchVariants(text: string): Array<{ compact: string; raw: string }> {
  const out: Array<{ compact: string; raw: string }> = [];
  for (const match of String(text ?? "").matchAll(THAI_PLATE_RE)) {
    const raw = safeString(match[0]).replace(/\s+/g, " ");
    const compact = raw.replace(/\s+/g, "");
    if (!compact || out.some((item) => item.compact === compact && item.raw === raw)) continue;
    out.push({ compact, raw });
  }
  THAI_PLATE_RE.lastIndex = 0;
  return out.slice(0, 5);
}

export function extractThaiPlateCandidates(text: string): string[] {
  const out: string[] = [];
  for (const item of extractThaiPlateSearchVariants(text)) {
    if (item.compact && !out.includes(item.compact)) out.push(item.compact);
  }
  return out;
}

function uniqueContextLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean)) {
    const key = line.toLowerCase();
    if (!out.some((existing) => existing.toLowerCase() === key)) out.push(line);
  }
  return out;
}

function prioritizeIdentityContextLines(raw: string, contextLines: string[]): string[] {
  const explicitIdentityLines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => Boolean(extractThaiStockIdentity(line)));
  return uniqueContextLines([...explicitIdentityLines, ...contextLines]);
}

function candidateKey(value: string): string {
  return normalizeSearch(value);
}

function addCarCandidate(
  target: LineInboxCarCandidate[],
  candidate: LineInboxCarCandidate
): void {
  const text = safeString(candidate.text);
  if (!text) return;
  const key = candidateKey(`${candidate.kind ?? ""}:${text}:${candidate.line ?? ""}`);
  if (!key || target.some((item) => candidateKey(`${item.kind ?? ""}:${item.text}:${item.line ?? ""}`) === key)) {
    return;
  }
  target.push({
    ...candidate,
    text,
    line: safeString(candidate.line) || undefined,
  });
}

function hasThaiPlateCandidate(line: string): boolean {
  return extractThaiPlateCandidates(line).length > 0;
}

function vehicleSignalScoreForCandidate(line: string): number {
  let score = 0;
  if (extractThaiStockIdentity(line)) score += 5;
  if (hasThaiPlateCandidate(line)) score += 4;
  if (extractChassisCandidates(line).length > 0) score += 5;
  if (extractStockNumbers(line).length > 0) score += 2;
  if (extractVehicleTokens(line).length > 0) score += 2;
  if (/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\d{2}\b/i.test(line)) score += 1;
  return score;
}

function isWorkItemLine(line: string, split: ReturnType<typeof splitLineTextForInbox>): boolean {
  const key = candidateKey(line);
  if (!key) return false;
  const workLines = [
    ...split.items,
    ...(split.grouped_items ?? []).map((item) => item.text),
  ];
  return workLines.some((work) => {
    const workKey = candidateKey(work);
    return Boolean(workKey) && (workKey === key || workKey.includes(key) || key.includes(workKey));
  });
}

function collectCarCandidates(
  raw: string,
  opts: {
    aiTargetCarReference?: string | null;
    aiTargetCarConfidence?: string | null;
    aiTargetCarReason?: string | null;
    aiCandidateCars?: Array<{ text?: string; confidence?: number | string; reason?: string }> | null;
    carIdentityLines?: string[] | null;
  }
): LineInboxCarCandidate[] {
  const split = splitLineTextForInbox(raw);
  const out: LineInboxCarCandidate[] = [];

  const aiTarget = safeString(opts.aiTargetCarReference);
  if (aiTarget) {
    addCarCandidate(out, {
      text: aiTarget,
      source: "ai",
      kind: "target_reference",
      confidence: safeString(opts.aiTargetCarConfidence) || undefined,
      reason: safeString(opts.aiTargetCarReason) || "AI target car reference",
    });
  }

  for (const line of opts.carIdentityLines ?? []) {
    addCarCandidate(out, {
      text: line,
      source: "ai",
      kind: "identity_line",
      confidence: safeString(opts.aiTargetCarConfidence) || undefined,
      reason: "AI car identity line",
      line,
    });
  }

  for (const candidate of opts.aiCandidateCars ?? []) {
    if (!candidate?.text) continue;
    addCarCandidate(out, {
      text: candidate.text,
      source: "ai",
      kind: "candidate_car",
      confidence: candidate.confidence,
      reason: candidate.reason || "AI candidate car",
      line: candidate.text,
    });
  }

  const allLines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const explicitIdentityLines = allLines.filter(
    (line) => Boolean(extractThaiStockIdentity(line)) || hasThaiPlateCandidate(line) || extractChassisCandidates(line).length > 0
  );
  const contextLines = uniqueContextLines([
    ...split.ignored_vehicle_spec_lines,
    ...explicitIdentityLines,
  ]);

  for (const line of allLines) {
    const mileageRef = extractLineInboxMileageCarReference(line);
    if (!mileageRef) continue;
    addCarCandidate(out, {
      text: mileageRef,
      source: "rule",
      kind: "stock_or_plate",
      confidence: "high",
      reason: "plate/ref + mileage context",
      line,
    });
  }

  for (const line of contextLines) {
    if (vehicleSignalScoreForCandidate(line) < 2) continue;
    addCarCandidate(out, {
      text: extractThaiStockIdentity(line) || line,
      source: "rule",
      kind: extractThaiStockIdentity(line) ? "stock_or_plate" : "vehicle_context",
      confidence: "high",
      reason: "vehicle context line",
      line,
    });
  }

  // Fallback only when no stronger car-context line exists. This prevents numbers
  // inside real work items (for example 31440/41252 part-source references) from
  // overriding the main target car.
  if (out.length === 0) {
    for (const line of allLines) {
      if (isWorkItemLine(line, split)) continue;
      if (vehicleSignalScoreForCandidate(line) < 3) continue;
      addCarCandidate(out, {
        text: extractThaiStockIdentity(line) || line,
        source: "rule",
        kind: "fallback_vehicle_context",
        confidence: "medium",
        reason: "fallback vehicle signal",
        line,
      });
    }
  }

  return out.slice(0, 20);
}

function candidateMatchLines(raw: string, candidates: LineInboxCarCandidate[]): string[] {
  const lines = uniqueContextLines(
    candidates.flatMap((candidate) => [
      safeString(candidate.text),
      safeString(candidate.line),
    ])
  );
  if (lines.length > 0) return lines.slice(0, 10);
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 8);
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

export function scoreLineInboxStockMatch(row: CarMatchRow, stock: string): number {
  const normalizedStock = normalizeSearch(stock);
  if (!normalizedStock) return 0;

  const id = normalizeSearch(safeString(row.id));
  const rowId = normalizeSearch(safeString(row.row_id));
  const plate = normalizeSearch(safeString(row.plate_number));
  const spec = normalizeSearch(safeString(row.spec));
  const plateSuffix = normalizeSearch(lineInboxPlateNumericSuffix(row.plate_number));

  let score = 0;
  if (plateSuffix && plateSuffix === normalizedStock) score += 10;
  else if (plate === normalizedStock) score += 9;
  else if (plate.endsWith(normalizedStock)) score += 8;
  else if (plate.includes(normalizedStock)) score += 6;

  if (/^\d{2,6}$/.test(normalizedStock)) {
    if (lineInboxHasSafeNumericRefToken(row.spec, normalizedStock)) score += 4;
  } else if (spec.includes(normalizedStock)) {
    score += 4;
  }

  // row_id is usually a UUID. Only exact row/id matches are treated as car refs.
  if (rowId === normalizedStock) score += 5;
  if (id === normalizedStock) score += 5;

  return score;
}

function scoreCandidate(row: CarMatchRow, contextLine: string): number {
  const haystack = normalizeSearch(carHaystack(row));
  const rawHaystack = carHaystack(row).toLowerCase();
  let score = 0;

  for (const stock of extractStockNumbers(contextLine)) {
    score += scoreLineInboxStockMatch(row, stock);
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

  const contextPlate = extractThaiPlateCandidates(contextLine)[0] ?? "";
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

async function resolveUniquePlateSuffixCandidate(
  supabase: SupabaseClient,
  stock: string
): Promise<ResolvedCar | null> {
  const normalizedStock = normalizeSearch(stock);
  if (!/^\d{2,6}$/.test(normalizedStock)) return null;

  const token = likeToken(stock);
  const rows = await queryCarCandidates(supabase, [`plate_number.ilike.%${token}`, `spec.ilike.%${token}%`], 30);
  return resolveSafeShortRefCandidateRows(rows, stock);
}

function matchedCarCandidateFromRow(row: CarMatchRow, reason = ""): LineInboxMatchedCarCandidate {
  return {
    car_row_id: safeString(row.row_id),
    plate_text: safeString(row.plate_number),
    spec_text: safeString(row.spec),
    chassis: safeString(row.chassis_number),
    sale: safeString(row.sale_support),
    reason: reason || undefined,
  };
}

export function resolvePlateSuffixCandidateRows(rows: CarMatchRow[], stock: string): ResolvedCar | null {
  const normalizedStock = normalizeSearch(stock);
  if (!/^\d{2,6}$/.test(normalizedStock)) return null;
  const suffixMatches = rows.filter(
    (row) => normalizeSearch(lineInboxPlateNumericSuffix(row.plate_number)) === normalizedStock
  );
  const candidates = suffixMatches
    .map((row) => matchedCarCandidateFromRow(row, `plate suffix ${stock}`))
    .filter((candidate) => candidate.car_row_id);
  if (suffixMatches.length === 0) return null;
  if (suffixMatches.length === 1) {
    return {
      ...resolvedFromRow(suffixMatches[0], 0.86, 1),
      matchedCarCandidates: candidates,
    };
  }
  return {
    car_row_id: "",
    plate_text: "",
    chassis: "",
    confidence: 0.45,
    candidate_count: suffixMatches.length,
    matchedCarCandidates: candidates,
  };
}

function safeShortRefMatchReason(row: CarMatchRow, stock: string): string {
  const normalizedStock = normalizeSearch(stock);
  const plate = normalizeSearch(safeString(row.plate_number));
  if (plate === normalizedStock) return `exact plate ${stock}`;
  if (normalizeSearch(lineInboxPlateNumericSuffix(row.plate_number)) === normalizedStock) return `plate suffix ${stock}`;
  if (lineInboxHasSafeNumericRefToken(row.spec, normalizedStock)) return `spec token ${stock}`;
  const rowId = normalizeSearch(safeString(row.row_id));
  const id = normalizeSearch(safeString(row.id));
  if (rowId === normalizedStock || id === normalizedStock) return `stock/ref ${stock}`;
  return `short ref ${stock}`;
}

function isSafeShortRefCandidateRow(row: CarMatchRow, stock: string): boolean {
  const normalizedStock = normalizeSearch(stock);
  if (!/^\d{2,6}$/.test(normalizedStock)) return false;
  const plate = normalizeSearch(safeString(row.plate_number));
  if (plate === normalizedStock) return true;
  if (normalizeSearch(lineInboxPlateNumericSuffix(row.plate_number)) === normalizedStock) return true;
  if (lineInboxHasSafeNumericRefToken(row.spec, normalizedStock)) return true;
  const rowId = normalizeSearch(safeString(row.row_id));
  const id = normalizeSearch(safeString(row.id));
  return rowId === normalizedStock || id === normalizedStock;
}

export function resolveSafeShortRefCandidateRows(rows: CarMatchRow[], stock: string): ResolvedCar | null {
  const normalizedStock = normalizeSearch(stock);
  if (!/^\d{2,6}$/.test(normalizedStock)) return null;
  const seen = new Set<string>();
  const matches = rows.filter((row) => {
    const rowKey = safeString(row.row_id) || safeString(row.id) || `${safeString(row.plate_number)}:${safeString(row.spec)}`;
    if (!rowKey || seen.has(rowKey)) return false;
    if (!isSafeShortRefCandidateRow(row, normalizedStock)) return false;
    seen.add(rowKey);
    return true;
  });
  const candidates = matches
    .map((row) => matchedCarCandidateFromRow(row, safeShortRefMatchReason(row, stock)))
    .filter((candidate) => candidate.car_row_id);
  if (matches.length === 0) return null;
  if (matches.length === 1) {
    return {
      ...resolvedFromRow(matches[0], 0.86, 1),
      matchedCarCandidates: candidates,
    };
  }
  return {
    car_row_id: "",
    plate_text: "",
    chassis: "",
    confidence: 0.45,
    candidate_count: matches.length,
    matchedCarCandidates: candidates,
  };
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
    matchedCarCandidates: [matchedCarCandidateFromRow(row)],
  };
}

function withResolveMeta(
  result: ResolvedCar,
  meta: {
    extractedCarCandidates: LineInboxCarCandidate[];
    aiTargetCarReference?: string;
    aiTargetCarConfidence?: string;
    matchReason?: string;
  }
): ResolvedCar {
  return {
    ...result,
    extractedCarCandidates: meta.extractedCarCandidates,
    matchedCarCandidates: result.matchedCarCandidates ?? [],
    aiTargetCarReference: meta.aiTargetCarReference,
    aiTargetCarConfidence: meta.aiTargetCarConfidence,
    matchReason: meta.matchReason,
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
    aiTargetCarReference?: string | null;
    aiTargetCarReason?: string | null;
    aiTargetCarConfidence?: string | null;
    aiCandidateCars?: Array<{ text?: string; confidence?: number | string; reason?: string }> | null;
    carIdentityLines?: string[] | null;
  }
): Promise<ResolvedCar> {
  const raw = String(opts.raw_text ?? "");
  const extractedCarCandidates = collectCarCandidates(raw, {
    aiTargetCarReference: opts.aiTargetCarReference,
    aiTargetCarReason: opts.aiTargetCarReason,
    aiTargetCarConfidence: opts.aiTargetCarConfidence,
    aiCandidateCars: opts.aiCandidateCars,
    carIdentityLines: opts.carIdentityLines,
  });
  const meta = {
    extractedCarCandidates,
    aiTargetCarReference: safeString(opts.aiTargetCarReference),
    aiTargetCarConfidence: safeString(opts.aiTargetCarConfidence),
  };
  const empty: ResolvedCar = withResolveMeta(
    { car_row_id: "", plate_text: "", chassis: "", confidence: 0 },
    { ...meta, matchReason: extractedCarCandidates.length ? "No confident car match" : "No car candidates found" }
  );

  const rowIdIn = String(opts.car_row_id ?? "").trim();
  if (rowIdIn) {
    const { data } = await supabase
      .from(CARS_TABLE)
      .select(CAR_MATCH_SELECT)
      .eq("row_id", rowIdIn)
      .maybeSingle();
    const row = data as CarMatchRow | null;
    if (row?.row_id) {
      return withResolveMeta(resolvedFromRow(row, 1), { ...meta, matchReason: "Explicit car_row_id" });
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
      return withResolveMeta(resolvedFromRow(row, 0.95), { ...meta, matchReason: "Explicit car id" });
    }
  }

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
      return withResolveMeta(resolvedFromRow(row, 0.85), { ...meta, matchReason: `Matched chassis ${ch}` });
    }
  }

  for (const plateCandidate of extractThaiPlateSearchVariants(raw)) {
    const variants = Array.from(new Set([plateCandidate.compact, plateCandidate.raw].filter(Boolean)));
    let exactData: CarMatchRow[] = [];
    for (const variant of variants) {
      const { data } = await supabase
        .from(CARS_TABLE)
        .select(CAR_MATCH_SELECT)
        .eq("plate_number", variant)
        .limit(2);
      if ((data ?? []).length > 0) {
        exactData = (data ?? []) as CarMatchRow[];
        break;
      }
    }
    const exactRows = exactData ?? [];
    const exactRow = exactRows[0] as CarMatchRow | undefined;
    if (exactRows.length === 1 && exactRow?.row_id) {
      return withResolveMeta(resolvedFromRow(exactRow, 0.93), {
        ...meta,
        matchReason: `Matched exact Thai plate ${plateCandidate.compact}`,
      });
    }

    const { data } = await supabase
      .from(CARS_TABLE)
      .select(CAR_MATCH_SELECT)
      .or(variants.map((variant) => `plate_number.ilike.%${variant}%`).join(","))
      .limit(5);
    const rows = data ?? [];
    const row = rows[0] as CarMatchRow | undefined;
    if (rows.length === 1 && row?.row_id) {
      return withResolveMeta(resolvedFromRow(row, 0.55), {
        ...meta,
        matchReason: `Matched Thai plate ${plateCandidate.compact}`,
      });
    }
  }

  for (const line of prioritizeIdentityContextLines(raw, candidateMatchLines(raw, extractedCarCandidates)).slice(0, 10)) {
    const identityStock = extractThaiStockIdentity(line);
    if (identityStock) {
      const { data } = await supabase
        .from(CARS_TABLE)
        .select(CAR_MATCH_SELECT)
        .eq("plate_number", identityStock)
        .limit(2);
      const rows = data ?? [];
      const row = rows[0] as CarMatchRow | undefined;
      if (rows.length === 1 && row?.row_id) {
        return withResolveMeta(resolvedFromRow(row, 0.93, 1), {
          ...meta,
          matchReason: `Matched explicit stock/plate ${identityStock}`,
        });
      }
    }

    const stocks = extractStockNumbers(line);
    for (const stock of stocks) {
      const plateSuffixMatch = await resolveUniquePlateSuffixCandidate(supabase, stock);
      if (plateSuffixMatch && (plateSuffixMatch.car_row_id || (plateSuffixMatch.candidate_count ?? 0) > 1)) {
        return withResolveMeta(plateSuffixMatch, {
          ...meta,
          matchReason: plateSuffixMatch.car_row_id
            ? `Matched safe short ref ${stock}`
            : `Multiple safe short ref candidates for ${stock}`,
        });
      }
    }

    const stockOrParts = stocks.flatMap((stock) => [
      `spec.ilike.%${likeToken(stock)}%`,
      `row_id.ilike.%${likeToken(stock)}%`,
      `plate_number.ilike.%${likeToken(stock)}%`,
      `chassis_number.ilike.%${likeToken(stock)}%`,
    ]);
    const byStock = await queryCarCandidates(supabase, stockOrParts, 20);
    const stockMatch = chooseScoredCandidate(byStock, line);
    if (stockMatch && (stockMatch.car_row_id || (stockMatch.candidate_count ?? 0) > 1)) {
      return withResolveMeta(stockMatch, {
        ...meta,
        matchReason: stockMatch.car_row_id
          ? `Matched stock/ref candidate from "${line.slice(0, 80)}"`
          : `Multiple stock/ref candidates from "${line.slice(0, 80)}"`,
      });
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
      return withResolveMeta(specMatch, {
        ...meta,
        matchReason: specMatch.car_row_id
          ? `Matched spec/model candidate from "${line.slice(0, 80)}"`
          : `Multiple spec/model candidates from "${line.slice(0, 80)}"`,
      });
    }
  }

  return empty;
}
