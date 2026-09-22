import type { LineInboxCarCandidate } from "@/lib/line-inbox/types";

export type LineInboxMatchStatus =
  | "matched"
  | "waiting_for_car_record"
  | "ambiguous_vehicle"
  | "no_vehicle_context"
  | "unresolved";

export type LineInboxUnmatchedReason =
  | ""
  | "pending_car_record"
  | "multiple_candidates"
  | "no_car_candidate";

const THAI_PLATE_RE = /(?<![\u0E00-\u0E7F])\d{0,2}[\u0E01-\u0E2E]{1,3}[-\s]?\d{2,4}/;
const CHASSIS_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/i;
const STOCK_REF_RE = /\b\d{4,6}\b/g;
const VEHICLE_TOKEN_RE =
  /\b(?:TOYOTA|NISSAN|NAVARA|ISUZU|MAZDA|MITSUBISHI|FORD|HONDA|REVO|FORTUNER|HILUX|VIGO|RANGER|D-?MAX|DMAX|TRITON|CAMRY|ALTIS|YARIS|VIOS|MU-?X|EVEREST|PAJERO|PRO-?4X|RAPTOR|TRAVO|COMMUTER|OVERLAND|4TREX|HIGHT|HIGH|D-?CAB|DOUBLE|SMART|CAB|VAN|DC|2WD|4WD|AT|MT|7AT|6AT|STANDARD|WHITE|BLACK|GRAY|GREY|SILVER|BLUE|RED|GREEN|ORANGE|BRONZE|BROWN|GOLD|PEARL)\b|\u0E1B\u0E49\u0E32\u0E22\u0E41\u0E14\u0E07/i;

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stockRefTokens(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(STOCK_REF_RE)) {
    const token = match[0];
    if (/^(?:19|20)\d{2}$/.test(token)) continue;
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

function hasVehicleSignal(text: string): boolean {
  return VEHICLE_TOKEN_RE.test(text);
}

function hasLikelyCarIdentity(text: string): boolean {
  return THAI_PLATE_RE.test(text) || CHASSIS_RE.test(text);
}

function looksLikePendingCarRecord(text: string): boolean {
  const value = clean(text);
  if (!value) return false;
  if (hasLikelyCarIdentity(value)) return true;
  return stockRefTokens(value).length > 0 && hasVehicleSignal(value);
}

export function deriveLineInboxMatchStatus(input: {
  carRowId?: unknown;
  rawText?: unknown;
  extractedCarCandidates?: LineInboxCarCandidate[] | null;
  matchReason?: unknown;
}): { matchStatus: LineInboxMatchStatus; unmatchedReason: LineInboxUnmatchedReason } {
  if (clean(input.carRowId)) return { matchStatus: "matched", unmatchedReason: "" };

  const candidates = input.extractedCarCandidates ?? [];
  const candidateText = candidates
    .flatMap((candidate) => [candidate.text, candidate.line])
    .map(clean)
    .filter(Boolean);
  const rawText = clean(input.rawText);
  const matchReason = clean(input.matchReason);
  const searchable = [rawText, ...candidateText].join(" ");

  if (candidateText.some(looksLikePendingCarRecord) || looksLikePendingCarRecord(searchable)) {
    return { matchStatus: "waiting_for_car_record", unmatchedReason: "pending_car_record" };
  }

  if (candidates.length > 0 || /multiple|spec\/model|stock\/ref/i.test(matchReason) || hasVehicleSignal(searchable)) {
    return { matchStatus: "ambiguous_vehicle", unmatchedReason: "multiple_candidates" };
  }

  return { matchStatus: "no_vehicle_context", unmatchedReason: "no_car_candidate" };
}
