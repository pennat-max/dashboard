export type ExportInquiryOrderBits = {
  orderId: string;
  vehicleTitle: string;
  /** ข้อความราคาที่แสดงบน UI แล้ว เช่น $45,200 */
  listedPriceLabel: string;
  fullPlate?: string;
  chassis?: string;
  saleCode?: string;
};

function line(label: string, value: string | undefined): string {
  const v = String(value ?? "").trim();
  if (!v || v === "-") return "";
  return `${label}: ${v}`;
}

/** ข้อความตั้งต้นภาษาอังกฤษสำหรับลูกค้าต่างประเทศ — ต่อท้ายช่องว่างให้ลูกค้ากรอก */
export function buildExportInquiryPrefill(input: ExportInquiryOrderBits): string {
  const incoterm =
    typeof process !== "undefined"
      ? (process.env.NEXT_PUBLIC_EXPORT_INCOTERMS_LINE?.trim() ||
          "FOB Thailand (confirm port & terms with sales)")
      : "FOB Thailand (confirm port & terms with sales)";

  const blocks: string[] = [
    `Export inquiry — STOCK_REF: ${input.orderId}`,
    line("Vehicle", input.vehicleTitle),
    line("Listed price", `${input.listedPriceLabel} (${incoterm})`),
    line("Chassis", input.chassis),
    line("Plate / ref", input.fullPlate),
    line("Internal sale code", input.saleCode),
    "",
    "Destination country:",
    "Preferred Incoterm:",
    "Quantity (units):",
    "Payment preference (TT / LC / other):",
    "Target port / routing notes:",
  ];
  return blocks.filter((x) => x.length > 0).join("\n");
}
