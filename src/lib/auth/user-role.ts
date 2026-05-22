export const USER_ROLES = [1, 2, 3, 4] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(n: unknown): n is UserRole {
  return typeof n === "number" && USER_ROLES.includes(n as UserRole);
}

export function normalizeRole(n: unknown): UserRole {
  if (isUserRole(n)) return n;
  return 1;
}

/** ดูกราฟ + KPI ทั้งหมด (ระดับ 2+) */
export function canViewDashboardInsights(role: UserRole): boolean {
  return role >= 2;
}

/** ลิงก์ KPI ครบทุกใบ (ระดับ 3+) */
export function canUseFullKpiLinks(role: UserRole): boolean {
  return role >= 3;
}

/** ลิงก์ KPI เฉพาะรถ / exported / booked / available (ระดับ 1+) เมื่อล็อกอินแล้ว */
export function canUseSubsetKpiLinks(role: UserRole): boolean {
  return role >= 1;
}

/** แก้ไขข้อมูล API / ฟอร์ม (ระดับ 3+) */
export function canMutate(role: UserRole): boolean {
  return role >= 3;
}

/** สร้าง/จัดการผู้ใช้ (ระดับ 4) */
export function canManageUsers(role: UserRole): boolean {
  return role >= 4;
}
