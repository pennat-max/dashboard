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

export type LineApprovalUpdatedAcknowledgementItem = {
  name?: string | null;
  beforeName?: string | null;
  beforeAssignee?: string | null;
  beforeStatus?: string | null;
  afterAssignee?: string | null;
  afterStatus?: string | null;
  assignee?: string | null;
  assignee_staff?: string | null;
  status?: string | null;
  item_status?: string | null;
};

const UNKNOWN_LINE_VALUE = "ยังไม่ระบุ";
const DEFAULT_EXISTING_ITEM_LIMIT = 10;

const SYSTEM_ACK_PATTERNS = [
  /รับข้อความแล้วค่ะ\s*✅?/i,
  /ระบบกำลังตรวจและจัดเข้าคิวงาน/i,
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

function updatedItemParts(item: LineApprovalUpdatedAcknowledgementItem): {
  name: string;
  beforeAssignee: string;
  beforeStatus: string;
  afterAssignee: string;
  afterStatus: string;
} {
  return {
    name: cleanLine(item.name ?? item.beforeName ?? ""),
    beforeAssignee: cleanLine(item.beforeAssignee ?? ""),
    beforeStatus: cleanLine(item.beforeStatus ?? ""),
    afterAssignee: cleanLine(item.afterAssignee ?? item.assignee ?? item.assignee_staff ?? ""),
    afterStatus: cleanLine(item.afterStatus ?? item.status ?? item.item_status ?? ""),
  };
}

function uniqueUpdatedItems(items: LineApprovalUpdatedAcknowledgementItem[]): Array<{
  name: string;
  beforeAssignee: string;
  beforeStatus: string;
  afterAssignee: string;
  afterStatus: string;
}> {
  const out: Array<{
    name: string;
    beforeAssignee: string;
    beforeStatus: string;
    afterAssignee: string;
    afterStatus: string;
  }> = [];
  for (const item of items.map(updatedItemParts).filter((line) => line.name)) {
    const key = `${item.name}|${item.beforeAssignee}|${item.beforeStatus}|${item.afterAssignee}|${item.afterStatus}`.toLowerCase();
    if (
      !out.some(
        (existing) =>
          `${existing.name}|${existing.beforeAssignee}|${existing.beforeStatus}|${existing.afterAssignee}|${existing.afterStatus}`.toLowerCase() ===
          key
      )
    ) {
      out.push(item);
    }
  }
  return out;
}

function formatCompactItemLine(
  index: number,
  item: { name: string; assignee: string; status: string }
): string {
  return `${index + 1}. ${item.name} : ${item.assignee || UNKNOWN_LINE_VALUE}/${item.status || UNKNOWN_LINE_VALUE}`;
}

function formatUpdatedItemLine(
  index: number,
  item: {
    name: string;
    beforeAssignee: string;
    beforeStatus: string;
    afterAssignee: string;
    afterStatus: string;
  }
): string {
  const before = `${item.beforeAssignee || UNKNOWN_LINE_VALUE}/${item.beforeStatus || UNKNOWN_LINE_VALUE}`;
  const after = `${item.afterAssignee || UNKNOWN_LINE_VALUE}/${item.afterStatus || UNKNOWN_LINE_VALUE}`;
  return `${index + 1}. ${item.name} : ${before} → ${after}`;
}

function appendApprovalItemSection(
  lines: string[],
  title: string,
  items: Array<{ name: string; assignee: string; status: string }>
): void {
  if (items.length === 0) return;
  lines.push(title);
  for (const [index, item] of items.entries()) {
    lines.push(formatCompactItemLine(index, item));
  }
  lines.push("");
}

function appendUpdatedItemSection(
  lines: string[],
  title: string,
  items: Array<{
    name: string;
    beforeAssignee: string;
    beforeStatus: string;
    afterAssignee: string;
    afterStatus: string;
  }>
): void {
  if (items.length === 0) return;
  lines.push(title);
  for (const [index, item] of items.entries()) {
    lines.push(formatUpdatedItemLine(index, item));
  }
  lines.push("");
}

function appendExistingItemSection(
  lines: string[],
  title: string,
  items: Array<{ name: string; assignee: string; status: string }>,
  limit: number
): void {
  if (items.length === 0) return;
  const safeLimit = Math.max(1, Math.floor(limit || DEFAULT_EXISTING_ITEM_LIMIT));
  const visible = items.slice(0, safeLimit);
  lines.push(title);
  for (const [index, item] of visible.entries()) {
    lines.push(formatCompactItemLine(index, item));
  }
  const remaining = items.length - visible.length;
  if (remaining > 0) {
    lines.push(`...และอีก ${remaining} รายการ`);
  }
  lines.push("");
}

export function buildLineApprovalAcknowledgementText({
  carTitle,
  approvedItems,
  createdItems,
  updatedItems,
  existingItems,
  existingItemLimit = DEFAULT_EXISTING_ITEM_LIMIT,
  reviewUrl,
}: {
  carTitle?: string | null;
  approvedItems?: LineApprovalAcknowledgementItem[];
  createdItems?: LineApprovalAcknowledgementItem[];
  updatedItems?: LineApprovalUpdatedAcknowledgementItem[];
  existingItems?: LineApprovalAcknowledgementItem[];
  existingItemLimit?: number;
  reviewUrl?: string | null;
}): string {
  const car = cleanLine(carTitle ?? "");
  const items = uniqueApprovalItems(approvedItems ?? []);
  const created = uniqueApprovalItems(createdItems ?? []);
  const updated = uniqueUpdatedItems(updatedItems ?? []);
  const existing = uniqueApprovalItems(existingItems ?? []);
  const usesSectionedItems = created.length > 0 || updated.length > 0 || existing.length > 0;
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

  if (usesSectionedItems) {
    appendApprovalItemSection(lines, "งานใหม่ที่เพิ่ม:", created);
    appendUpdatedItemSection(lines, "งานที่แก้ไข/อัปเดต:", updated);
    appendExistingItemSection(lines, "งานเดิมในรถคันนี้:", existing, existingItemLimit);
  } else if (items.length > 0) {
    lines.push("รายการ:");
    for (const [index, item] of items.entries()) {
      lines.push(formatCompactItemLine(index, item));
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

export function buildLineWebhookReceiptAcknowledgementText(): string {
  return ["รับข้อความแล้วค่ะ ✅", "ระบบกำลังตรวจและจัดเข้าคิวงาน"].join("\n");
}
