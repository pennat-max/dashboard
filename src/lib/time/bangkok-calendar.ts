/** ปฏิทิน yyyy-mm-dd ใน Asia/Bangkok — ใช้เทียบ income_date กับ ops ไทย */
export function bangkokCalendarTodayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

export function addCalendarDaysToYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  const utcMs = Date.UTC(y, m - 1, d + deltaDays);
  const dt = new Date(utcMs);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
