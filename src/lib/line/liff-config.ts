/**
 * LINE LIFF (LINE Front-end Framework) — browser-side config only.
 * Never put secrets here; use NEXT_PUBLIC_* for the LIFF app ID only.
 */

export function getLineLiffId(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_LINE_LIFF_ID;
  const id = typeof raw === "string" ? raw.trim() : "";
  return id.length > 0 ? id : undefined;
}

export function isLineLiffIdConfigured(): boolean {
  return Boolean(getLineLiffId());
}
