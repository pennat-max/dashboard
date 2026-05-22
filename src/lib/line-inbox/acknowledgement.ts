export const LINE_ORDER_REVIEW_URL = "https://used-car-export-dashboard.vercel.app/m/orders";

const SYSTEM_ACK_PATTERNS = [
  /รับทราบค่ะ\s*✅?/i,
  /รับงานแล้วครับ\s*✅?/i,
  /ระบบบันทึกงานที่ตรวจสอบแล้วเรียบร้อย/i,
  /ระบบจับงานจาก LINE แล้ว/i,
  /กรุณาตรวจสอบก่อนบันทึก/i,
  /กรุณาตรวจสอบงานที่ AI จับได้ก่อนบันทึก/i,
  /ตรวจสอบข้อมูลงานได้ที่:/i,
  /ตรวจสอบงานได้ที่:/i,
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

function uniqueLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines.map(cleanLine).filter(Boolean)) {
    const key = line.toLowerCase();
    if (!out.some((existing) => existing.toLowerCase() === key)) out.push(line);
  }
  return out;
}

export function buildLineApprovalAcknowledgementText({
  carTitle,
  approvedItems,
}: {
  carTitle?: string | null;
  approvedItems?: string[];
}): string {
  const car = cleanLine(carTitle ?? "");
  const items = uniqueLines(approvedItems ?? []);
  const lines = [
    "รับทราบค่ะ ✅",
    "",
    "ระบบบันทึกงานที่ตรวจสอบแล้วเรียบร้อย",
    "",
  ];

  if (car) {
    lines.push(`รถ: ${car}`, "");
  }

  if (items.length > 0) {
    lines.push("รายการที่รับงาน:");
    for (const [index, item] of items.entries()) {
      lines.push(`${index + 1}. ${item}`);
    }
    lines.push("");
  }

  lines.push("ตรวจสอบข้อมูลงานได้ที่:", LINE_ORDER_REVIEW_URL);
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
