export const LINE_ORDER_REVIEW_URL = "https://used-car-export-dashboard.vercel.app/m/orders";

export type LineApprovalAcknowledgementItem =
  | string
  | {
      name?: string | null;
      assignee?: string | null;
      assignee_staff?: string | null;
      status?: string | null;
      item_status?: string | null;
    };

const SYSTEM_ACK_PATTERNS = [
  /รับทราบค่ะ\s*✅?/i,
  /รับงานแล้วครับ\s*✅?/i,
  /ระบบบันทึกงานที่ตรวจสอบแล้วเรียบร้อย/i,
  /บันทึกงานเรียบร้อย/i,
  /ระบบจับงานจาก LINE แล้ว/i,
  /กรุณาตรวจสอบก่อนบันทึก/i,
  /กรุณาตรวจสอบงานที่ AI จับได้ก่อนบันทึก/i,
  /ตรวจสอบข้อมูลงานได้ที่:/i,
  /ตรวจสอบงานได้ที่:/i,
  /ดูงาน:/i,
  /used-car-export-dashboard\.vercel\.app\/m\/orders/i,
];

export function isLineInboxSystemAcknowledgementText(value: string): boolean {
  const text = String(value ?? "").trim();
  if (!text) return false;
  return SYSTEM_ACK_PATTERNS.some((pattern) => pattern.test(text));
}

function cleanLine(value: string): string {
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
}: {
  plate?: string | null;
  title?: string | null;
  fallback?: string | null;
}): string {
  const safePlate = cleanLine(plate ?? "");
  const safeTitle = collapseRepeatedPlatePrefix(title ?? "", safePlate);
  const safeFallback = cleanLine(fallback ?? "");
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
  const raw = cleanLine(value ?? "");
  const clean = raw.replace(/\s+/g, "");
  if (!clean || clean === "-") return "";
  const firstPlateLike = raw.match(/[0-9A-Z\u0E00-\u0E7F]+[-–—]\d{2,8}[A-Z]?/i)?.[0] ?? "";
  const firstStockLike = raw.match(/\d{4,8}/)?.[0] ?? "";
  const candidate = firstPlateLike || (/\s/.test(raw) ? firstStockLike : clean);
  if (!candidate) return "";
  const normalized = candidate.replace(/[–—]/g, "-").replace(/\s+/g, "");
  const parts = normalized.split("-").map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1]! : normalized;
}

export function buildLineOrderReviewUrl({
  carRowId,
  plate,
}: {
  carRowId?: string | null;
  plate?: string | null;
}): string {
  const url = new URL(LINE_ORDER_REVIEW_URL);
  const searchRef = buildLineOrderSearchRef(plate);
  url.searchParams.set("load", "full");
  const safeCarRowId = String(carRowId ?? "").trim();
  if (safeCarRowId) url.searchParams.set("aiLineCar", safeCarRowId);
  // Search stays as the stable fallback if card hydration cannot focus the row.
  if (searchRef) url.searchParams.set("search", searchRef);
  return url.toString();
}

function approvalItemParts(item: LineApprovalAcknowledgementItem): {
  name: string;
  assignee: string;
  status: string;
} {
  if (typeof item === "string") {
    return { name: cleanLine(item), assignee: "", status: "" };
  }
  return {
    name: cleanLine(item.name ?? ""),
    assignee: cleanLine(item.assignee ?? item.assignee_staff ?? ""),
    status: cleanLine(item.status ?? item.item_status ?? ""),
  };
}

function uniqueApprovalItems(items: LineApprovalAcknowledgementItem[]): Array<{
  name: string;
  assignee: string;
  status: string;
}> {
  const out: Array<{ name: string; assignee: string; status: string }> = [];
  for (const item of items.map(approvalItemParts).filter((line) => line.name)) {
    const key = `${item.name}|${item.assignee}|${item.status}`.toLowerCase();
    if (!out.some((existing) => `${existing.name}|${existing.assignee}|${existing.status}`.toLowerCase() === key)) {
      out.push(item);
    }
  }
  return out;
}

export function buildLineApprovalAcknowledgementText({
  carTitle,
  approvedItems,
  reviewUrl,
}: {
  carTitle?: string | null;
  approvedItems?: LineApprovalAcknowledgementItem[];
  reviewUrl?: string | null;
}): string {
  const car = cleanLine(carTitle ?? "");
  const items = uniqueApprovalItems(approvedItems ?? []);
  const safeReviewUrl = cleanLine(reviewUrl ?? "") || LINE_ORDER_REVIEW_URL;
  const lines = [
    "รับทราบค่ะ ✅",
    "",
    "บันทึกงานเรียบร้อย",
    "",
  ];

  if (car) {
    lines.push(`รถ: ${car}`, "");
  }

  if (items.length > 0) {
    lines.push("รายการ:");
    for (const [index, item] of items.entries()) {
      lines.push(`${index + 1}. ${item.name} : ${item.assignee || "ยังไม่ระบุ"}/${item.status || "ยังไม่ระบุ"}`);
    }
    lines.push("");
  }

  lines.push("ดูงาน:", safeReviewUrl);
  return lines.join("\n");
}

export function buildLineReviewLinkAcknowledgementText(carTitle?: string | null): string {
  const car = cleanLine(carTitle ?? "");
  return [
    "รับงานแล้วครับ ✅",
    "",
    car ? `รถ: ${car}` : "ระบบกำลังอ่านงานจาก LINE",
    "กรุณาตรวจสอบงานที่ AI จับได้ก่อนบันทึก:",
    LINE_ORDER_REVIEW_URL,
  ].join("\n");
}
