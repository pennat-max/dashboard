export type ExportGuestUiLang = "th" | "en";

export type ExportGuestCopy = {
  pageTitle: string;
  backToListings: string;
  langLabelTh: string;
  langLabelEn: string;
  exportOnlyBadge: string;
  termsTitle: string;
  termsIntro: string;
  termsBullets: string[];
  stepsTitle: string;
  steps: { title: string; body: string }[];
  faqTitle: string;
  faq: { q: string; a: string }[];
  disclaimer: string;
  whatsappCta: string;
  howItWorks: string;
  missingWhatsapp: string;
  listingSectionExport: string;
};

export function exportGuestCopy(lang: ExportGuestUiLang): ExportGuestCopy {
  if (lang === "en") {
    return {
      pageTitle: "Export — how it works",
      backToListings: "← Back to listings",
      langLabelTh: "ไทย",
      langLabelEn: "English",
      exportOnlyBadge: "Export only",
      termsTitle: "Pricing scope",
      termsIntro: "Figures on this page are for export. Final price, Incoterms, and charges depend on confirmation.",
      termsBullets: [
        "Listed price is indicative until confirmed against stock, payment, and shipping terms.",
        "Import rules, duties, and homologation are the buyer’s responsibility unless agreed otherwise in writing.",
        "We issue proforma / sales documents in line with the agreed Incoterm and payment structure.",
      ],
      stepsTitle: "Typical flow",
      steps: [
        { title: "Hold / deposit", body: "Agree vehicle, price basis, and payment milestones." },
        { title: "Payment", body: "Follow the agreed schedule (e.g. deposit + balance before documents / loading)." },
        { title: "Documents", body: "Commercial invoice, packing list, export docs, B/L as per deal." },
        { title: "Shipment", body: "Handover per FOB/CIF (or other) agreed with our team." },
      ],
      faqTitle: "FAQ",
      faq: [
        {
          q: "Do you sell domestically in Thailand?",
          a: "This channel is export-focused. Ask on WhatsApp if you have a special case.",
        },
        {
          q: "Is the online price final?",
          a: "It is the listed reference. We confirm final figures after destination, Incoterm, and payment terms.",
        },
        {
          q: "Which ports and Incoterms do you use?",
          a: "Most deals are quoted FOB Thailand or CIF to a named port. We’ll confirm what applies to you.",
        },
        {
          q: "How do we pay?",
          a: "Usually TT with agreed milestones; LC may be possible for qualified buyers — discuss on WhatsApp.",
        },
        {
          q: "Who handles import clearance overseas?",
          a: "Normally the consignee / buyer’s broker unless we explicitly agree different terms.",
        },
      ],
      disclaimer:
        "Information here is for convenience and may change with vessel schedules, forex, or stock updates. It is not legal or tax advice.",
      whatsappCta: "WhatsApp — export inquiry",
      howItWorks: "How export works",
      missingWhatsapp:
        "WhatsApp is not configured yet. Please use the external listing link if shown, or contact your sales channel.",
      listingSectionExport: "Export",
    };
  }
  return {
    pageTitle: "ส่งออก — วิธีซื้อ",
    backToListings: "← กลับหน้ารายการ",
    langLabelTh: "ไทย",
    langLabelEn: "English",
    exportOnlyBadge: "ขายส่งออกเท่านั้น",
    termsTitle: "ขอบเขตราคา",
    termsIntro: "ตัวเลขในหน้านี้ใช้สำหรับการส่งออก ราคาสุดท้าย Incoterm และค่าใช้จ่ายขึ้นกับการยืนยันจากทีมขาย",
    termsBullets: [
      "ราคาแสดงเป็นราคาอ้างอิงจนกว่าจะยืนยันสต็อก เงื่อนไขชำระ และการขนส่ง",
      "กฎนำเข้า ภาษี และมาตรฐานรถที่ปลายทางเป็นความรับผิดชอบของผู้ซื้อ เว้นแต่ตกลงเป็นลายลักษณ์อักษรอย่างอื่น",
      "ใบเสนอราคา/เอกสารขายออกตาม Incoterm และโครงสร้างการชำระที่ตกลงกัน",
    ],
    stepsTitle: "ขั้นตอนโดยย่อ",
    steps: [
      { title: "จอง / มัดจำ", body: "ตกลงคันรถ ฐานราคา และเหตุการณ์ชำระเงิน" },
      { title: "ชำระเงิน", body: "ตามกำหนดที่ตกลง (เช่น มัดจำ + ส่วนที่เหลือก่อนเอกสาร/โหลด)" },
      { title: "เอกสาร", body: "Invoice, packing list, เอกสารส่งออก, B/L ตามดีล" },
      { title: "ขนส่ง", body: "ส่งมอบตาม FOB/CIF หรือเงื่อนไขที่ตกลงกับทีม" },
    ],
    faqTitle: "คำถามที่พบบ่อย",
    faq: [
      { q: "ขายในประเทศไหม?", a: "ช่องทางนี้เน้นส่งออก กรณีพิเศษสอบถามทาง WhatsApp" },
      { q: "ราคาบนเว็บเป็นยอดสุดท้ายหรือไม่?", a: "เป็นราคาอ้างอิง ยืนยันหลังทราบปลายทาง Incoterm และการชำระ" },
      { q: "ใช้ท่าเรือและ Incoterm แบบไหน?", a: "ส่วนใหญ่เสนอ FOB ไทยหรือ CIF ถึงท่าที่ระบุ — ยืนยันกับทีมอีกครั้ง" },
      { q: "ชำระเงินอย่างไร?", a: "มักใช้ TT ตามเหตุการณ์ที่ตกลง กรณี LC อาจทำได้กับผู้ซื้อที่ผ่านการพิจารณา" },
      { q: "ใครดูแลพิธีการนำเข้าปลายทาง?", a: "โดยทั่วไปเป็นผู้รับปลายทาง/ตัวแทน เว้นแต่ตกลงเป็นลายลักษณ์อักษรอย่างอื่น" },
    ],
    disclaimer:
      "ข้อมูลในหน้านี้เพื่อความสะดวกในการติดต่อ อาจเปลี่ยนตามคิวเรือ อัตราแลกเปลี่ยน หรือสต็อก ไม่ถือเป็นคำปรึกษาทางกฎหมายหรือภาษี",
    whatsappCta: "WhatsApp — สอบถามส่งออก",
    howItWorks: "วิธีซื้อส่งออก",
    missingWhatsapp: "ยังไม่ได้ตั้งค่าเบอร์ WhatsApp สำหรับลูกค้า — ใช้ลิงก์รายการภายนอก (ถ้ามี) หรือช่องทางขายที่คุณใช้อยู่",
    listingSectionExport: "ส่งออก",
  };
}
