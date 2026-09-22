/** ชื่อที่ไม่เก็บใน roster / ไม่แสดงในดรอปดาวน์ order tracking */
export const STAFF_ROSTER_EXCLUDED_NAMES = new Set<string>(["ตูน"]);

export const STAFF_ROSTER_MAX_NAMES = 120;
export const STAFF_ROSTER_MAX_NAME_LEN = 48;

export function isStaffRosterNameExcluded(raw: string): boolean {
  return STAFF_ROSTER_EXCLUDED_NAMES.has(String(raw ?? "").trim());
}

/** ใช้ทั้ง API และ client — trim, dedupe, จำกัดความยาว/จำนวน, ตัดชื่อต้องห้าม */
export function normalizeStaffRosterNames(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of input) {
    const t = String(x ?? "")
      .trim()
      .slice(0, STAFF_ROSTER_MAX_NAME_LEN);
    if (!t || isStaffRosterNameExcluded(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= STAFF_ROSTER_MAX_NAMES) break;
  }
  return out;
}
