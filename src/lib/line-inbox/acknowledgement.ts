import {
  LINE_ORDER_REVIEW_URL,
  buildLineOrderReviewUrl as buildSharedLineOrderReviewUrl,
  buildLineOrderSearchRef as buildSharedLineOrderSearchRef,
} from "./review-link";

export {
  LINE_ORDER_REVIEW_URL,
  buildLineCarDisplayLabel,
} from "./review-link";

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

export function buildLineOrderSearchRef(value?: string | null): string {
  return buildSharedLineOrderSearchRef(value);
}

export function buildLineOrderReviewUrl({
  carRowId,
  plate,
}: {
  carRowId?: string | null;
  plate?: string | null;
}): string {
  return buildSharedLineOrderReviewUrl({ carRowId, plate });
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
