import type { Locale } from "@/lib/locale-constants";
import { cookies } from "next/headers";
import { LOCALE_COOKIE } from "@/lib/locale-constants";

export type { Locale } from "@/lib/locale-constants";

export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(LOCALE_COOKIE)?.value;
  if (raw === "th" || raw === "en") return raw;
  return "en";
}

export function numberFormatLocale(locale: Locale): string {
  return locale === "en" ? "en-US" : "th-TH";
}
