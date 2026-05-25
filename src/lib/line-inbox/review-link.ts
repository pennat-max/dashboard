export const LINE_ORDER_REVIEW_URL = "https://used-car-export-dashboard.vercel.app/m/orders";

export type LineReviewCarLabelInput = {
  plate?: string | null;
  title?: string | null;
  fallback?: string | null;
};

export type LineReviewUrlInput = {
  carRowId?: string | null;
  plate?: string | null;
};

function cleanLine(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeCarLabelCompare(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[\s-]+/g, "")
    .replace(/[^0-9A-Z\u0E00-\u0E7F]/gi, "")
    .toUpperCase();
}

function isCarLabelSeparator(ch: string): boolean {
  return /[\s-]/.test(ch);
}

function consumeFlexiblePrefix(source: string, prefix: string): number | null {
  let i = 0;
  let j = 0;
  while (i < source.length && isCarLabelSeparator(source[i]!)) i += 1;
  while (j < prefix.length && isCarLabelSeparator(prefix[j]!)) j += 1;
  const start = i;
  while (j < prefix.length) {
    while (i < source.length && isCarLabelSeparator(source[i]!)) i += 1;
    while (j < prefix.length && isCarLabelSeparator(prefix[j]!)) j += 1;
    if (j >= prefix.length) break;
    if (i >= source.length) return null;
    if (source[i]!.toLocaleUpperCase() !== prefix[j]!.toLocaleUpperCase()) return null;
    i += 1;
    j += 1;
  }
  while (j < prefix.length && isCarLabelSeparator(prefix[j]!)) j += 1;
  if (j < prefix.length || i === start) return null;
  if (i < source.length && !isCarLabelSeparator(source[i]!)) return null;
  return i;
}

function collapseRepeatedPlatePrefix(title: string, plate: string): string {
  const cleanTitle = cleanLine(title);
  const cleanPlate = cleanLine(plate);
  if (!cleanTitle || !cleanPlate || cleanPlate === "-") return cleanTitle;
  const firstEnd = consumeFlexiblePrefix(cleanTitle, cleanPlate);
  if (firstEnd == null) return cleanTitle;
  const afterFirst = cleanTitle.slice(firstEnd).trimStart();
  const secondEnd = consumeFlexiblePrefix(afterFirst, cleanPlate);
  if (secondEnd == null) return cleanTitle;
  const afterSecond = afterFirst.slice(secondEnd).trimStart();
  return [cleanTitle.slice(0, firstEnd).trim(), afterSecond].filter(Boolean).join(" ").trim();
}

export function buildLineCarDisplayLabel({
  plate,
  title,
  fallback,
}: LineReviewCarLabelInput): string {
  const safePlate = cleanLine(plate);
  const safeTitle = collapseRepeatedPlatePrefix(title ?? "", safePlate);
  const safeFallback = cleanLine(fallback);
  const titleKey = normalizeCarLabelCompare(safeTitle);
  const plateKey = normalizeCarLabelCompare(safePlate);
  if (safeTitle && safeTitle !== "-") {
    if (safePlate && safePlate !== "-" && (!titleKey || !plateKey || !titleKey.startsWith(plateKey))) {
      return `${safePlate} ${safeTitle}`.trim();
    }
    return safeTitle;
  }
  if (safePlate && safePlate !== "-") return safePlate;
  if (safeFallback && safeFallback !== "-") return safeFallback;
  return "";
}

export function buildLineOrderSearchRef(value?: string | null): string {
  const raw = cleanLine(value);
  const clean = raw.replace(/\s+/g, "");
  if (!clean || clean === "-") return "";
  const firstPlateLike = raw.match(/[0-9A-Z\u0E00-\u0E7F]+[-\u2013\u2014]\d{2,8}[A-Z]?/i)?.[0] ?? "";
  const firstStockLike = raw.match(/\d{4,8}/)?.[0] ?? "";
  const candidate = firstPlateLike || (/\s/.test(raw) ? firstStockLike : clean);
  if (!candidate) return "";
  const normalized = candidate.replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, "");
  const parts = normalized.split("-").map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1]! : normalized;
}

export function buildLineOrderReviewUrl({ carRowId, plate }: LineReviewUrlInput): string {
  const url = new URL(LINE_ORDER_REVIEW_URL);
  const searchRef = buildLineOrderSearchRef(plate);
  url.searchParams.set("load", "full");
  const safeCarRowId = String(carRowId ?? "").trim();
  if (safeCarRowId) url.searchParams.set("focusCarRowId", safeCarRowId);
  // Search stays as the stable fallback if card hydration cannot focus the row.
  if (searchRef) url.searchParams.set("search", searchRef);
  return url.toString();
}
