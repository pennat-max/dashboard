import type { Locale } from "@/lib/locale-constants";
import { LOCALE_COOKIE, isSupportedLocale } from "@/lib/locale-constants";
import { cookies } from "next/headers";

export type { Locale } from "@/lib/locale-constants";

export async function getLocale(): Promise<Locale> {
  const jar = await cookies();
  const fromCookie = jar.get(LOCALE_COOKIE)?.value?.toLowerCase() ?? "";
  if (isSupportedLocale(fromCookie)) return fromCookie;
  return "th";
}

export function numberFormatLocale(locale: Locale): string {
  if (locale === "en") return "en-US";
  return "th-TH";
}

/** For Intl.DateTimeFormat */
export function dateTimeFormatLocale(locale: Locale): string {
  if (locale === "en") return "en-GB";
  return "th-TH";
}
