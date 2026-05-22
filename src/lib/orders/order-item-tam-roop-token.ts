/** ในชื่องาน — ถ้ามีคำนี้จะแสดงเป็นลิงก์รูป และผูก order_tracking_photos (target_type=item) */
export const ORDER_ITEM_TAM_ROOP_TOKEN = "ตามรูป";
export const ORDER_ITEM_REF_PIC_EN = "see photo";

/** เก็บใน label_en / note_en — UI แยกแล้วทำเป็นลิงก์รูป (ข้อความในรูปคือคำแปลจริง) */
export const ORDER_ITEM_PHOTO_REF_START = "[[ref]]";
export const ORDER_ITEM_PHOTO_REF_END = "[[/ref]]";

export type EnglishPhotoRefSegment =
  | { kind: "text"; text: string }
  | { kind: "photo"; label: string };

/** แยกข้อความ EN ที่มี [[ref]]…[[/ref]] — ถ้าไม่มี marker คืน [{ kind: "text", text: en }] */
export function parseEnglishPhotoRefMarkers(en: string): EnglishPhotoRefSegment[] {
  const s = String(en ?? "");
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${esc(ORDER_ITEM_PHOTO_REF_START)}([\\s\\S]*?)${esc(ORDER_ITEM_PHOTO_REF_END)}`, "gi");
  const out: EnglishPhotoRefSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) {
      out.push({ kind: "text", text: s.slice(last, m.index) });
    }
    const label = String(m[1] ?? "").trim() || ORDER_ITEM_REF_PIC_EN;
    out.push({ kind: "photo", label });
    last = re.lastIndex;
  }
  if (last < s.length) {
    out.push({ kind: "text", text: s.slice(last) });
  }
  if (out.length === 0) {
    out.push({ kind: "text", text: s });
  }
  return out;
}

/** สำหรับที่ไม่มีลิงก์ (เช่น Cost Summary) — ตัด marker เหลือแค่ข้อความที่แปล */
export function stripEnglishPhotoRefMarkers(en: string): string {
  const s = String(en ?? "");
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${esc(ORDER_ITEM_PHOTO_REF_START)}([\\s\\S]*?)${esc(ORDER_ITEM_PHOTO_REF_END)}`, "gi");
  return s.replace(re, "$1");
}
export const ORDER_ITEM_TAM_ROOP_ALIASES = [
  ORDER_ITEM_TAM_ROOP_TOKEN,
  "ตามภาพ",
  "ref pic",
  "as photo",
  "see photo",
] as const;

export function orderItemLabelContainsTamRoop(label: string | null | undefined): boolean {
  const text = String(label ?? "").toLowerCase();
  return ORDER_ITEM_TAM_ROOP_ALIASES.some((token) => text.includes(String(token).toLowerCase()));
}
